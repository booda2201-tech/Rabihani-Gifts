import { Injectable } from '@angular/core';

export interface UsedInvoiceRecord {
  invoiceNumber: string;
  imageAddedAt: string;
  uploadedAt: string;
  total: number | null;
  points: number;
  imageHash?: string;
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

  findDuplicateImage(imageHash: string | null | undefined): UsedInvoiceRecord | null {
    if (!imageHash) {
      return null;
    }

    return Object.values(this.read()).find((record) => record.imageHash === imageHash) || null;
  }

  markUsed(record: UsedInvoiceRecord): void {
    if (!record.invoiceNumber) {
      return;
    }

    const all = this.read();
    all[normalizeInvoiceNumber(record.invoiceNumber)] = record;
    localStorage.setItem(this.storageKey, JSON.stringify(pruneOldest(all)));
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

function pruneOldest(records: Record<string, UsedInvoiceRecord>): Record<string, UsedInvoiceRecord> {
  const entries = Object.entries(records);
  if (entries.length <= 2000) {
    return records;
  }

  return Object.fromEntries(
    entries
      .sort((left, right) => right[1].uploadedAt.localeCompare(left[1].uploadedAt))
      .slice(0, 2000)
  );
}
