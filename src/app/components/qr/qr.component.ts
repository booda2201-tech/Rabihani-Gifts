import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';
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
  @ViewChild('canvas', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('cameraInput') cameraInput!: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') galleryInput!: ElementRef<HTMLInputElement>;

  isScanning = false;
  showModal = false;
  currentCode = '';
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

  constructor(
    private apiService: ApiService,
    private invoiceAi: InvoiceAiService,
    private usedInvoices: UsedInvoicesService
  ) {}

  get canSubmitPoints(): boolean {
    return !!this.analysis?.invoiceNumber
      && !!this.analysis.invoiceTotal
      && this.analysis.points > 0
      && !!this.imageAddedAt
      && !!this.uploadedAt
      && !this.isAnalyzing
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
    this.currentCode = result;
    this.stopCamera();
    this.isScanning = false;
    this.resetInvoice();
    this.showModal = true;
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    cancelAnimationFrame(this.animationId);
  }

  openCamera() {
    this.cameraInput?.nativeElement.click();
  }

  openGallery() {
    this.galleryInput?.nativeElement.click();
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

    this.imageAddedAt = formatDateTimeToSecond(file.lastModified || Date.now());
    this.uploadedAt = formatDateTimeToSecond(Date.now());
    this.invoicePreview = await this.readFileAsDataUrl(file);
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

      if (!this.analysis.invoiceNumber) {
        this.analyzeError = 'تعذر قراءة رقم الفاتورة. صوّرها مرة أخرى بوضوح مع ظهور رقم الفاتورة.';
        return;
      }

      if (this.analysis.points <= 0) {
        this.analyzeError = 'المبلغ المستخرج صغير جداً لإضافة نقاط. تأكد من وضوح الإجمالي.';
        return;
      }

      const previous = this.usedInvoices.findDuplicate(this.analysis.invoiceNumber);
      if (previous) {
        this.analyzeError =
          `الفاتورة رقم ${this.analysis.invoiceNumber} اترفعت قبل كده في ${previous.uploadedAt}، ومش هيتضاف عليها نقاط تاني.`;
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
  }

  closeModal() {
    this.showModal = false;
    this.resetInvoice();
  }

  sendPoints() {
    if (!this.canSubmitPoints || !this.analysis || !this.imageAddedAt || !this.uploadedAt) {
      Swal.fire('تنبيه', 'صوّر الفاتورة أولاً حتى يتم استخراج النقاط', 'warning');
      return;
    }

    const analysis = this.analysis;
    const pointsToAdd = analysis.points;
    const invoiceTotal = analysis.invoiceTotal;
    const imageAddedAt = this.imageAddedAt;
    const uploadedAt = this.uploadedAt;

    Swal.fire({
      title: 'جاري حفظ النقاط...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.apiService.scanQr(this.currentCode, pointsToAdd).subscribe({
      next: (res) => {
        Swal.close();

        if (res && res.success === true) {
          this.usedInvoices.markUsed({
            invoiceNumber: analysis.invoiceNumber as string,
            imageAddedAt,
            uploadedAt,
            total: invoiceTotal,
            points: pointsToAdd
          });

          this.closeModal();
          Swal.fire({
            title: 'نجاح',
            text: res.message || `تم إضافة ${pointsToAdd} نقطة من فاتورة ${invoiceTotal} ج.م ✅`,
            icon: 'success'
          });
        } else {
          Swal.fire({
            title: 'فشل الإضافة',
            text: res.message || 'عفواً، هذا الكود غير صالح أو تم استخدامه ❌',
            icon: 'error'
          });
        }
      },
      error: (err) => {
        Swal.close();
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
