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
   * 2. إضافة نقاط من فاتورة المشتريات
   */
  addInvoicePoints(payload: {
    phoneNumber: string;
    pointsToAdd: number;
    invoiceNumber: string;
    invoiceTotal: number | null;
    uploadedAt: string;
  }): Observable<any> {
    const url = `${this.baseUrl}/UserInvoice/scan`;
    return this.http.post(url, payload);
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
