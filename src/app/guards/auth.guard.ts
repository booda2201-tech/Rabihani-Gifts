import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const authGuard = () => {
  const router = inject(Router);
  const token = localStorage.getItem('adminToken');

  if (token) {
    return true; // التوكن موجود، ادخل عادي
  } else {
    // مفيش توكن، يرجعه للوجن ويمنعه من دخول الصفحة
    router.navigate(['/login']);
    return false;
  }
};
