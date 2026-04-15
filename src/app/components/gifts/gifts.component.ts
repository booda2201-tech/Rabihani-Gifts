import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-gifts',
  templateUrl: './gifts.component.html',
  styleUrls: ['./gifts.component.scss']
})
export class GiftsComponent {
  giftForm = {
    phone: '',
    code: ''
  };

  isLoading = false;
  statusMessage = '';
  isSuccess = false;
  isError = false;

  constructor(private apiService: ApiService) {}

  submitGift() {
    if (!this.giftForm.phone || !this.giftForm.code) return;

    this.isLoading = true;
    this.isSuccess = false;
    this.isError = false;

    this.apiService.validateGift(this.giftForm.phone, this.giftForm.code).subscribe({
      next: (res) => {
        this.isLoading = false;

        // فحص الرد الفعلي من السيرفر
        if (res && res.valid === true) {
          this.isSuccess = true;
          // عرض رسالة الباك إند أو رسالة افتراضية للنجاح
          this.statusMessage = res.message || 'تم التحقق من بياناتك بنجاح! 🎉';

        } else if (res && res.valid === false) {
          this.isError = true;
          // عرض الرسالة اللي راجعة من السيرفر زي "الكود غير صحيح أو لا يطابق رقم التليفون"
          this.statusMessage = res.message || 'عفواً، بيانات الهدية غير صحيحة ❌';
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.isError = true;
        // ده في حالة إن السيرفر واقع أو فيه مشكلة في الإنترنت
        this.statusMessage = 'حدث خطأ في الاتصال بالسيرفر، يرجى المحاولة لاحقاً.';
      }
    });
  }
}
