import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-qr',
  templateUrl: './qr.component.html',
  styleUrls: ['./qr.component.scss']
})
export class QrComponent {
  isScanning = false;
  showModal = false;
  currentCode = '';
  pointsToAdd: number | null = null;

  constructor(private apiService: ApiService) {}

  // 1. الوظيفة اللي بتشغل الكاميرا (كانت ناقصة في الكود اللي فات)
  startScanning() {
    this.isScanning = true;
    // هنا ممكن تضيف Logic مكتبة الـ Scanner لو حابب
  }

  // 2. الوظيفة اللي بتستلم نتيجة المسح
  onCodeResult(result: string) {
    this.currentCode = result;
    this.isScanning = false;
    this.showModal = true;
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
