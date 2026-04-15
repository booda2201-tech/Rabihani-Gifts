import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  // التحديث الجديد للرابط الأساسي (Production URL)
  private baseUrl = 'https://api.rabahni.com/api';

  constructor(private http: HttpClient) { }

  /**
   * 1. تسجيل الدخول - Admin Scanner
   */
  login(payload: any): Observable<any> {
    const url = `${this.baseUrl}/Auth/adminScannerLogin`;
    return this.http.post(url, payload);
  }

  /**
   * 2. مسح كود الـ QR وإضافة نقاط للمستخدم
   * @param publicCode الكود اللي الكاميرا قرأته
   * @param points عدد النقاط اللي كتبتها في الـ Modal
   */
  scanQr(publicCode: string, points: number): Observable<any> {
    const url = `${this.baseUrl}/UserQr/scan`;
    // إرسال البيانات كـ Body Object
    const body = {
      publicCode: publicCode,
      pointsToAdd: points
    };
    return this.http.post(url, body);
  }

  /**
   * 3. التحقق من الهدايا (نظام المطالبة بالجوائز)
   */
  validateGift(phone: string, code: string): Observable<any> {
    const url = `${this.baseUrl}/WinnerRedemption/validate`;
    const params = new HttpParams()
      .set('phoneNumber', phone)
      .set('code', code);

    return this.http.get(url, { params });
  }
}
