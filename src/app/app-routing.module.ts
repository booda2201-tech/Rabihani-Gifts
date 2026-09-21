import { NgModule } from '@angular/core';
import { authGuard } from './guards/auth.guard';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { LoginComponent } from './components/login/login.component';
import { QrComponent } from './components/qr/qr.component';
import { GiftsComponent } from './components/gifts/gifts.component';

// src/app/app-routing.module.ts
const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: 'home',
    component: HomeComponent,
    canActivate: [authGuard], // لو مفعل الجارد
    children: [
      { path: 'invoices', component: QrComponent },
      { path: 'qr-scanner', redirectTo: 'invoices', pathMatch: 'full' },
      { path: 'gifts', component: GiftsComponent },
      { path: '', redirectTo: 'invoices', pathMatch: 'full' }
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
