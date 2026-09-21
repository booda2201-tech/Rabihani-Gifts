import { Injectable } from '@angular/core';

export interface UsedInvoiceRecord {
  invoiceNumber: string;
  imageAddedAt: string;
  uploadedAt: string;
  total: number | null;
  points: number;
}

@Injectable({
  providedIn: 'root'
})
export class UsedInvoicesService {
  private readonly storageKey = 'rabihani.usedInvoices.v2';

  findDuplicate(invoiceNumber: string | null | undefined): UsedInvoiceRecord | null {
    if (!invoiceNumber) {
      return null;
    }

    return this.read()[normalizeInvoiceNumber(invoiceNumber)] || null;
  }

  markUsed(record: UsedInvoiceRecord): void {
    if (!record.invoiceNumber) {
      return;
    }

    const all = this.read();
    all[normalizeInvoiceNumber(record.invoiceNumber)] = record;
    localStorage.setItem(this.storageKey, JSON.stringify(all));
  }

  private read(): Record<string, UsedInvoiceRecord> {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
}

export function formatDateTimeToSecond(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  ].join(' ');
}

function normalizeInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber.trim().toUpperCase();
}
