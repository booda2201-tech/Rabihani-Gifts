import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { parseCustomerQr, type CustomerQrProfile } from '../../services/customer-qr';
import { fingerprintImage, reviewCapture, reviewInvoiceReading } from '../../services/invoice-guard';
import { calculateInvoicePoints } from '../../services/invoice-parser';
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
  @ViewChild('cameraInput') cameraInput!: ElementRef<HTMLInputElement>;

  isScanning = false;
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
    private usedInvoices: UsedInvoicesService
  ) {
    this.invoiceAi.warmup();
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
    this.currentCode = '';
    this.customer = null;
    this.resetInvoice();
    this.startScanning();
  }

  openCamera() {
    this.cameraInput?.nativeElement.click();
  }

  async onInvoiceSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

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
      this.analysis = await this.invoiceAi.analyzeInvoice(this.invoicePreview, (progress) => {
        this.analyzeStatus = progress.status;
        this.analyzeProgress = progress.progress;
      });

      const review = reviewInvoiceReading({
        analysis: this.analysis,
        duplicateInvoice: this.usedInvoices.findDuplicate(this.analysis.invoiceNumber),
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
      duplicateInvoice: this.usedInvoices.findDuplicate(analysis.invoiceNumber),
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

        if (res && res.success === true) {
          this.usedInvoices.markUsed({
            invoiceNumber,
            imageAddedAt,
            uploadedAt,
            total: invoiceTotal,
            points: pointsToAdd,
            imageHash
          });

          this.resetAll();
          Swal.fire({
            title: 'نجاح',
            text: res.message || `تم إضافة ${pointsToAdd} نقطة من فاتورة ${invoiceTotal} ج.م ✅`,
            icon: 'success'
          });
        } else {
          this.isSubmitting = false;
          Swal.fire({
            title: 'فشل الإضافة',
            text: res.message || 'عفواً، هذا الكود غير صالح أو تم استخدامه ❌',
            icon: 'error'
          });
        }
      },
      error: (err) => {
        Swal.close();
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

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('تعذر قراءة صورة الفاتورة'));
      reader.readAsDataURL(file);
    });
  }
}
