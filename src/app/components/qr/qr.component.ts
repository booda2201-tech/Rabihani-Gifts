import { Component, ViewChild, ElementRef } from '@angular/core';
import { ApiService } from '../../services/api.service';
import Swal from 'sweetalert2';
import jsQR from 'jsqr';

@Component({
  selector: 'app-qr',
  templateUrl: './qr.component.html',
  styleUrls: ['./qr.component.scss']
})
export class QrComponent {
  @ViewChild('video') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;


isScanning = false;
  showModal = false;
  currentCode = '';
  pointsToAdd: number | null = null;
  stream: MediaStream | null = null;
  animationId: any;

  constructor(private apiService: ApiService) {}

  // 1. الوظيفة اللي بتشغل الكاميرا (كانت ناقصة في الكود اللي فات)
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

        // نبدأ عملية الفحص (Scan Loop)
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

      // بنحتاج Canvas وهمي في الذاكرة عشان نحلل الصورة
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // هنا المكتبة بتحاول تلاقي QR Code
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          this.onCodeResult(code.data); // لو لقت كود، تبعته للـ Function اللي عندك
          return; // نوقف اللوب
        }
      }
    }

    if (this.isScanning) {
      this.animationId = requestAnimationFrame(() => this.scanLoop());
    }
  }

  // 2. الوظيفة اللي بتستلم نتيجة المسح
  onCodeResult(result: string) {
    this.currentCode = result;
    this.stopCamera(); // نقفل الكاميرا أول ما نلاقي نتيجة
    this.isScanning = false;
    this.showModal = true;
  }

stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    cancelAnimationFrame(this.animationId);
  }


  // 3. الوظيفة اللي بتبعت النقاط (غيرت اسمها لـ sendPoints عشان تطابق الـ HTML)
  sendPoints() {
    if (this.pointsToAdd && this.pointsToAdd > 0) {
      this.apiService.scanQr(this.currentCode, this.pointsToAdd).subscribe({
        next: (res) => {
          this.showModal = false;
          Swal.fire('نجاح', 'تم إضافة النقاط بنجاح ✅', 'success');
          this.pointsToAdd = null;
        },
        error: (err) => {
          Swal.fire('خطأ', 'فشلت عملية إضافة النقاط ❌', 'error');
        }
      });
    } else {
      Swal.fire('تنبيه', 'يرجى إدخال عدد نقاط صحيح', 'warning');
    }
  }
}
