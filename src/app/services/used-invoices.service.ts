import { Injectable } from '@angular/core';

export interface UsedInvoiceRecord {
  invoiceNumber: string;
  imageAddedAt: string;
  uploadedAt: string;
  total: number | null;
  points: number;
  newBalance: number | null;
  imageHash?: string;
  imageHashes?: string[];
  pending?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UsedInvoicesService {
  private readonly storageKey = 'rabihani.usedInvoices.v2';

  findDuplicate(invoiceNumber: string | null | undefined, total?: number | null): UsedInvoiceRecord | null {
    if (!invoiceNumber) {
      return null;
    }

    const today = formatDateTimeToSecond(new Date()).slice(0, 10);
    return Object.values(this.read()).find((record) => (
      isBlocking(record) && (
        invoicesMatch(record.invoiceNumber, invoiceNumber, record.total, total)
        || sameAmountToday(record, total, today)
      )
    )) || null;
  }

  findDuplicateImage(imageHash: string | null | undefined): UsedInvoiceRecord | null {
    if (!imageHash) {
      return null;
    }

    return blockingImage(Object.values(this.read()).find((record) => (
      record.imageHash === imageHash || record.imageHashes?.includes(imageHash)
    )));
  }

  reserve(record: UsedInvoiceRecord): void {
    this.write({ ...record, pending: true });
  }

  releasePending(invoiceNumber: string): void {
    const all = this.read();
    const key = Object.keys(all).find((stored) => all[stored].pending && invoicesMatch(
      all[stored].invoiceNumber,
      invoiceNumber,
      all[stored].total,
      all[stored].total
    ));
    if (!key) {
      return;
    }

    delete all[key];
    localStorage.setItem(this.storageKey, JSON.stringify(all));
  }

  markUsed(record: UsedInvoiceRecord): void {
    this.write({ ...record, pending: false });
  }

  private write(record: UsedInvoiceRecord): void {
    if (!record.invoiceNumber) {
      return;
    }

    const all = this.read();
    all[canonicalizeInvoiceNumber(record.invoiceNumber)] = record;
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

export function canonicalizeInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6');
}

export function invoicesMatch(
  leftNumber: string,
  rightNumber: string,
  leftTotal?: number | null,
  rightTotal?: number | null
): boolean {
  const left = canonicalizeInvoiceNumber(leftNumber);
  const right = canonicalizeInvoiceNumber(rightNumber);
  if (!left || !right) {
    return false;
  }
  if (left === right || samePortoNumber(left, right)) {
    return true;
  }

  const totalsClose = leftTotal != null && rightTotal != null
    && Number.isFinite(leftTotal)
    && Number.isFinite(rightTotal)
    && Math.abs(leftTotal - rightTotal) <= 1;
  if (!totalsClose || left.length < 8 || right.length < 8 || Math.abs(left.length - right.length) > 2) {
    return false;
  }

  if (levenshtein(left, right) <= 2) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return longer.includes(shorter) && longer.length - shorter.length <= 3;
}

function samePortoNumber(left: string, right: string): boolean {
  const leftDigits = left.replace(/\D/g, '');
  const rightDigits = right.replace(/\D/g, '');
  if (leftDigits.length < 10 || rightDigits.length < 10) {
    return false;
  }

  const shorter = leftDigits.length <= rightDigits.length ? leftDigits : rightDigits;
  const longer = leftDigits.length <= rightDigits.length ? rightDigits : leftDigits;
  return longer.startsWith(shorter) && longer.length - shorter.length <= 4;
}

function sameAmountToday(record: UsedInvoiceRecord, total: number | null | undefined, today: string): boolean {
  return total != null
    && record.total != null
    && Number.isFinite(total)
    && Number.isFinite(record.total)
    && Math.abs(record.total - total) <= 1
    && record.uploadedAt.slice(0, 10) === today;
}

function isBlocking(record: UsedInvoiceRecord | undefined): record is UsedInvoiceRecord {
  return !!record && (record.pending === true || Number.isFinite(record.newBalance));
}

function blockingImage(record: UsedInvoiceRecord | undefined): UsedInvoiceRecord | null {
  return isBlocking(record) ? record : null;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost);
      diagonal = saved;
    }
  }

  return previous[right.length];
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
