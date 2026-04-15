import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms'; // عشان نستخدم ngModel في الفورم
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './interceptors/auth.interceptor';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LoginComponent } from './components/login/login.component';
import { GiftsComponent } from './components/gifts/gifts.component';
import { QrComponent } from './components/qr/qr.component';
import { HomeComponent } from './components/home/home.component';

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    GiftsComponent,
    QrComponent,
    HomeComponent
  ],
imports: [
  BrowserModule,
  AppRoutingModule,
  HttpClientModule,
  FormsModule // عشان الـ ngModel يشتغل
],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true // مهمة جداً عشان تسمح بأكتر من Interceptor لو حبيت تضيف مستقبلاً
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
