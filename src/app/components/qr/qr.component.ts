import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { parseCustomerQr, type CustomerQrProfile } from '../../services/customer-qr';
import { fingerprintImage, reviewCapture, reviewInvoiceReading } from '../../services/invoice-guard';
import { calculateInvoicePoints, parseInvoiceText } from '../../services/invoice-parser';
import { InvoiceAiService, type InvoiceAnalysis } from '../../services/invoice-ai.service';
import { formatDateTimeToSecond, UsedInvoicesService } from '../../services/used-invoices.service';
import Swal from 'sweetalert2';
import jsQR from 'jsqr';

@Component({
  selector: 'app-qr',
  templateUrl: './qr.component.html',
  styleUrls: ['./qr.component.scss']
})
export class QrComponent implements OnDestroy {
  @ViewChild('video') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('invoiceVideo') invoiceVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('phoneCamera') phoneCamera?: ElementRef<HTMLInputElement>;

  readonly frameWidth = 86;
  readonly frameHeight = 90;

  isScanning = false;
  isCapturingInvoice = false;
  cameraReady = false;
  torchAvailable = false;
  torchOn = false;
  currentCode = '';
  customer: CustomerQrProfile | null = null;
  stream: MediaStream | null = null;
  animationId: any;

  invoicePreview: string | null = null;
  analysis: InvoiceAnalysis | null = null;
  isAnalyzing = false;
  analyzeStatus = '';
  analyzeProgress = 0;
  analyzeError: string | null = null;
  imageAddedAt: string | null = null;
  uploadedAt: string | null = null;
  imageHash: string | null = null;
  isSubmitting = false;

  constructor(
    private apiService: ApiService,
    private invoiceAi: InvoiceAiService,
    private usedInvoices: UsedInvoicesService,
    private changeDetector: ChangeDetectorRef
  ) {
    this.invoiceAi.warmup();
  }

  get phoneCameraPreferred(): boolean {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  get customerScanned(): boolean {
    return !!this.currentCode;
  }

  get canSubmitPoints(): boolean {
    return this.customerScanned
      && !!this.analysis?.invoiceNumber
      && !!this.analysis.invoiceTotal
      && this.analysis.points > 0
      && !!this.imageAddedAt
      && !!this.uploadedAt
      && !this.isAnalyzing
      && !this.isSubmitting
      && !this.analyzeError;
  }

  async startScanning() {
    this.isScanning = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      if (this.videoElement) {
        this.videoElement.nativeElement.srcObject = this.stream;
        this.videoElement.nativeElement.setAttribute('playsinline', 'true');
        this.videoElement.nativeElement.play();
        requestAnimationFrame(() => this.scanLoop());
      }
    } catch (err) {
      this.isScanning = false;
      Swal.fire('خطأ', 'تعذر الوصول للكاميرا', 'error');
    }
  }

  scanLoop() {
    if (this.videoElement && this.videoElement.nativeElement.readyState === this.videoElement.nativeElement.HAVE_ENOUGH_DATA) {
      const video = this.videoElement.nativeElement;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          this.onCodeResult(code.data);
          return;
        }
      }
    }

    if (this.isScanning) {
      this.animationId = requestAnimationFrame(() => this.scanLoop());
    }
  }

  onCodeResult(result: string) {
    const code = result.trim();
    this.currentCode = code;
    this.customer = parseCustomerQr(code);
    this.stopCamera();
    this.isScanning = false;
    this.resetInvoice();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    cancelAnimationFrame(this.animationId);
  }

  rescanCustomer() {
    this.stopCamera();
    this.isCapturingInvoice = false;
    this.currentCode = '';
    this.customer = null;
    this.resetInvoice();
    this.startScanning();
  }

  async startInvoiceCamera() {
    if (this.isAnalyzing || this.isSubmitting) {
      return;
    }

    this.stopCamera();
    this.analyzeError = null;
    this.cameraReady = false;
    this.torchOn = false;
    this.torchAvailable = false;
    this.isCapturingInvoice = true;
    this.changeDetector.detectChanges();

    const video = this.invoiceVideo?.nativeElement;
    if (!video) {
      await this.failInvoiceCamera();
      return;
    }

    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    try {
      this.stream = await this.openCameraStream();
      video.srcObject = this.stream;
      const playback = video.play();
      if (playback) {
        await playback.catch(() => undefined);
      }
      await this.waitForFrame(video);
      await this.tuneCamera(this.stream);
      this.cameraReady = true;
    } catch {
      await this.failInvoiceCamera();
    }
  }

  async captureInvoicePhoto() {
    const video = this.invoiceVideo?.nativeElement;
    if (!this.cameraReady || !video?.videoWidth) {
      this.analyzeError = 'استنى لحد ما صورة الفاتورة توضح في الإطار، وبعدين صور.';
      return;
    }

    const canvas = framedSnapshot(video, this.frameWidth / 100, this.frameHeight / 100);
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width) {
      this.analyzeError = 'تعذر التقاط صورة الفاتورة. حاول تاني.';
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      this.analyzeError = 'تعذر التقاط صورة الفاتورة. حاول تاني.';
      return;
    }

    this.stopCamera();
    this.isCapturingInvoice = false;
    this.cameraReady = false;

    const file = new File([blob], `invoice-${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
    await this.onInvoiceSelected(file);
  }

  photographInvoice() {
    if (this.phoneCameraPreferred) {
      this.openPhoneCamera();
      return;
    }

    void this.startInvoiceCamera();
  }

  openPhoneCamera() {
    if (this.isAnalyzing || this.isSubmitting) {
      return;
    }

    this.stopCamera();
    this.isCapturingInvoice = false;
    this.cameraReady = false;
    this.phoneCamera?.nativeElement.click();
  }

  async onPhoneCameraPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    const photo = new File([file], file.name || `invoice-${Date.now()}.jpg`, {
      type: file.type.startsWith('image/') ? file.type : 'image/jpeg',
      lastModified: file.lastModified || Date.now()
    });
    await this.onInvoiceSelected(photo);
  }

  async toggleTorch() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) {
      return;
    }

    const next = !this.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      this.torchOn = next;
    } catch {
      this.torchOn = false;
    }
  }

  async focusInvoice(event: MouseEvent) {
    const video = this.invoiceVideo?.nativeElement;
    const track = this.stream?.getVideoTracks()[0];
    if (!video || !track || !this.cameraReady) {
      return;
    }

    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    try {
      await track.applyConstraints({
        advanced: [{ pointsOfInterest: [{ x, y }] } as MediaTrackConstraintSet]
      });
    } catch {
      return;
    }
  }

  cancelInvoiceCamera() {
    this.stopCamera();
    this.isCapturingInvoice = false;
    this.cameraReady = false;
    this.torchOn = false;
  }

  retakeInvoice() {
    this.resetInvoice();
    this.photographInvoice();
  }

  async onInvoiceSelected(file: File) {
    if (!file.type.startsWith('image/')) {
      this.analyzeError = 'يرجى اختيار صورة واضحة للفاتورة';
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      this.analyzeError = 'حجم الصورة كبير جداً. صوّر الفاتورة مرة أخرى.';
      return;
    }

    const capturedAt = Date.now();
    this.analysis = null;
    this.analyzeError = null;
    this.imageHash = null;
    this.imageAddedAt = formatDateTimeToSecond(file.lastModified || capturedAt);
    this.uploadedAt = formatDateTimeToSecond(capturedAt);

    const captureReview = reviewCapture(file.lastModified, capturedAt);
    const [preview, imageHash] = await Promise.all([
      this.readFileAsDataUrl(file),
      fingerprintImage(file)
    ]);
    this.invoicePreview = preview;
    this.imageHash = imageHash;
    if (!captureReview.allowed) {
      this.analyzeError = captureReview.reason;
      return;
    }

    const duplicateImage = this.usedInvoices.findDuplicateImage(this.imageHash);
    if (duplicateImage) {
      this.analyzeError = `الصورة دي اتسجلت قبل كده في ${duplicateImage.uploadedAt}، ومش هيتضاف عليها نقاط تاني.`;
      return;
    }

    await this.analyzeInvoice();
  }

  async analyzeInvoice() {
    if (!this.invoicePreview) {
      return;
    }

    this.isAnalyzing = true;
    this.analysis = null;
    this.analyzeError = null;
    this.analyzeStatus = 'جاري تحليل الفاتورة...';
    this.analyzeProgress = 0;

    try {
      const text = await this.invoiceAi.recognizeText(this.invoicePreview, (progress) => {
        this.analyzeStatus = progress.status;
        this.analyzeProgress = progress.progress;
      });
      this.analysis = parseInvoiceText(text);
      const review = reviewInvoiceReading({
        analysis: this.analysis,
        duplicateInvoice: this.usedInvoices.findDuplicate(this.analysis.invoiceNumber, this.analysis.invoiceTotal),
        duplicateImage: this.usedInvoices.findDuplicateImage(this.imageHash),
        now: new Date()
      });
      if (!review.allowed) {
        this.analyzeError = review.reason;
      }
    } catch (error: any) {
      this.analysis = null;
      this.analyzeError = error?.message || 'تعذر قراءة الفاتورة. حاول تصويرها مرة أخرى.';
    } finally {
      this.isAnalyzing = false;
    }
  }

  resetInvoice() {
    this.cancelInvoiceCamera();
    this.invoicePreview = null;
    this.analysis = null;
    this.isAnalyzing = false;
    this.analyzeStatus = '';
    this.analyzeProgress = 0;
    this.analyzeError = null;
    this.imageAddedAt = null;
    this.uploadedAt = null;
    this.imageHash = null;
  }

  resetAll() {
    this.currentCode = '';
    this.customer = null;
    this.isSubmitting = false;
    this.resetInvoice();
  }

  sendPoints() {
    if (!this.canSubmitPoints || !this.analysis || !this.imageAddedAt || !this.uploadedAt) {
      Swal.fire('تنبيه', 'امسح كود العميل وصوّر الفاتورة أولاً', 'warning');
      return;
    }

    const analysis = this.analysis;
    const review = reviewInvoiceReading({
      analysis,
      duplicateInvoice: this.usedInvoices.findDuplicate(analysis.invoiceNumber, analysis.invoiceTotal),
      duplicateImage: this.usedInvoices.findDuplicateImage(this.imageHash),
      now: new Date()
    });
    if (!review.allowed || !analysis.invoiceTotal || !analysis.invoiceNumber) {
      this.analyzeError = review.reason || 'الفاتورة غير مقبولة';
      return;
    }

    const invoiceTotal = analysis.invoiceTotal;
    const pointsToAdd = calculateInvoicePoints(invoiceTotal);
    const invoiceNumber = analysis.invoiceNumber;
    const imageAddedAt = this.imageAddedAt;
    const uploadedAt = this.uploadedAt;
    const publicCode = this.currentCode;
    const imageHash = this.imageHash || undefined;
    this.isSubmitting = true;
    this.usedInvoices.reserve({
      invoiceNumber,
      imageAddedAt,
      uploadedAt,
      total: invoiceTotal,
      points: pointsToAdd,
      newBalance: null,
      imageHash
    });

    Swal.fire({
      title: 'جاري حفظ النقاط...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.apiService.addInvoicePoints({
      publicCode,
      pointsToAdd,
      invoiceNumber,
      invoiceTotal,
      uploadedAt
    }).subscribe({
      next: (res) => {
        Swal.close();

        const added = finiteNumber(res?.pointsAdded);
        const balance = finiteNumber(res?.newBalance);
        const credited = res?.success === true
          && added != null
          && added > 0
          && balance != null;

        if (credited) {
          this.usedInvoices.markUsed({
            invoiceNumber,
            imageAddedAt,
            uploadedAt,
            total: invoiceTotal,
            points: added,
            newBalance: balance,
            imageHash
          });

          this.resetAll();
          Swal.fire({
            title: 'النقاط اتضافت',
            text: `اتضاف ${added} نقطة. رصيد العميل بقى ${balance} نقطة.`,
            icon: 'success'
          });
        } else {
          this.usedInvoices.releasePending(invoiceNumber);
          this.isSubmitting = false;
          Swal.fire({
            title: res?.success === true ? 'الرصيد مرجعش' : 'فشل الإضافة',
            text: res?.success === true
              ? 'السيرفر موافقش يرجع النقاط المضافة والرصيد الجديد، فالفاتورة متسجلتش كمقروءة. لو رصيد العميل متغيرش، اضغط تأكيد تاني.'
              : (res?.message || 'عفواً، هذا الكود غير صالح أو تم استخدامه ❌'),
            icon: 'error'
          });
        }
      },
      error: (err) => {
        Swal.close();
        this.usedInvoices.releasePending(invoiceNumber);
        this.isSubmitting = false;
        console.error('API Error:', err);
        Swal.fire({
          title: 'خطأ في الاتصال',
          text: err.error?.message || 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً ❌',
          icon: 'error'
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  private async openCameraStream(): Promise<MediaStream> {
    const attempts: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: 2160 },
          height: { ideal: 3840 }
        }
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 2560 }
        }
      },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true }
    ];

    let lastError: unknown;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('تعذر فتح الكاميرا');
  }

  private waitForFrame(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          resolve();
          return;
        }
        if (Date.now() - started > 6000) {
          reject(new Error('الكاميرا فتحت بس الصورة مش ظاهرة'));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  private async tuneCamera(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0];
    if (!track?.getCapabilities) {
      return;
    }

    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      torch?: boolean;
      focusMode?: string[];
    };
    this.torchAvailable = !!capabilities.torch;
    if (!capabilities.focusMode?.includes('continuous')) {
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet]
      });
    } catch {
      return;
    }
  }

  private async failInvoiceCamera(): Promise<void> {
    this.stopCamera();
    this.isCapturingInvoice = false;
    this.cameraReady = false;
    const result = await Swal.fire({
      title: 'الكاميرا متفتحتش',
      text: 'افتح كاميرا الموبايل وصوّر الفاتورة من قريب، والورقة كلها ظاهرة.',
      icon: 'warning',
      confirmButtonText: 'فتح كاميرا الموبايل',
      showCancelButton: true,
      cancelButtonText: 'إلغاء'
    });
    if (result.isConfirmed) {
      this.openPhoneCamera();
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('تعذر قراءة صورة الفاتورة'));
      reader.readAsDataURL(file);
    });
  }
}

function framedSnapshot(video: HTMLVideoElement, frameWidth: number, frameHeight: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    return canvas;
  }

  const boxWidth = video.clientWidth || sourceWidth;
  const boxHeight = video.clientHeight || sourceHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  const boxRatio = boxWidth / boxHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > boxRatio) {
    sw = sourceHeight * boxRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / boxRatio;
    sy = (sourceHeight - sh) / 2;
  }

  const cropWidth = sw * frameWidth;
  const cropHeight = sh * frameHeight;
  sx += (sw - cropWidth) / 2;
  sy += (sh - cropHeight) / 2;

  const maxEdge = 2400;
  const scale = Math.min(1, maxEdge / Math.max(cropWidth, cropHeight));
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  canvas.getContext('2d')?.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
