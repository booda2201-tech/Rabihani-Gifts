import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  // الحقول مطابقة للـ Postman (emailOrPhone, password)
  loginData = { emailOrPhone: '', password: '' };
  isLoggingIn = false;

  constructor(private apiService: ApiService, private router: Router) {}

  onLogin() {
    // التحقق من إدخال البيانات أولاً
    if (!this.loginData.emailOrPhone || !this.loginData.password) {
      Swal.fire('تنبيه', 'يرجى إدخال اسم المستخدم وكلمة المرور', 'warning');
      return;
    }

    this.isLoggingIn = true;

    // --- وضع التجربة (اختياري) ---
    if (this.loginData.emailOrPhone === 'admin' && this.loginData.password === 'admin') {
      this.handleSuccess('dummy-token', 'أدمن (تجربة)');
      return;
    }

    // --- الدخول الفعلي عبر الـ API الحقيقي ---
    this.apiService.login(this.loginData).subscribe({
      next: (data) => {
        // الـ Response الحقيقي بيحتوي على token و fullName
        this.handleSuccess(data.token, data.fullName);
      },
      error: (err) => {
        this.isLoggingIn = false;
        console.error('Login Error:', err);
        // إظهار رسالة خطأ بناءً على رد السيرفر
        const errMsg = err.error?.message || 'بيانات الدخول غير صحيحة';
        Swal.fire('فشل الدخول', errMsg, 'error');
      }
    });
  }

  // وظيفة موحدة لمعالجة النجاح
  private handleSuccess(token: string, name: string) {
    localStorage.setItem('adminToken', token);

    Swal.fire({
      title: `أهلاً بك يا ${name}`,
      text: 'تم تسجيل الدخول بنجاح',
      icon: 'success',
      timer: 1500,
      showConfirmButton: false
    }).then(() => {
      this.router.navigate(['/home']);
    });
  }
}
