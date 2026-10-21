import { calculateInvoicePoints, type InvoiceParseResult } from './invoice-parser';

export const MAX_CAPTURE_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const AMOUNT_MISMATCH_EGP = 1;

export interface InvoiceReview {
  allowed: boolean;
  reason: string | null;
}

export interface PriorInvoiceUse {
  uploadedAt: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

export function reviewCapture(fileLastModified: number, now: number): InvoiceReview {
  if (!fileLastModified) {
    return allow();
  }

  const age = now - fileLastModified;
  if (age > MAX_CAPTURE_AGE_MS || fileLastModified - now > MAX_CLOCK_SKEW_MS) {
    return block('الصورة دي مش متصورة دلوقتي. صوّر الفاتورة من الكاميرا في نفس اللحظة.');
  }

  return allow();
}

export function reviewInvoiceReading(input: {
  analysis: InvoiceParseResult;
  duplicateInvoice: PriorInvoiceUse | null;
  duplicateImage: PriorInvoiceUse | null;
  now: Date;
}): InvoiceReview {
  if (input.duplicateImage) {
    return block(`الصورة دي اتسجلت قبل كده في ${input.duplicateImage.uploadedAt}، ومش هيتضاف عليها نقاط تاني.`);
  }

  if (input.duplicateInvoice && input.analysis.invoiceNumber) {
    return block(`الفاتورة رقم ${input.analysis.invoiceNumber} اترفعت قبل كده في ${input.duplicateInvoice.uploadedAt}، ومش هيتضاف عليها نقاط تاني.`);
  }

  if (!input.analysis.invoiceNumber || !input.analysis.invoiceNumberTrusted) {
    return block('رقم الفاتورة مش واضح. صوّرها تاني وخلّي رقم الفاتورة ظاهر.');
  }

  if (input.analysis.paid != null && input.analysis.net != null
    && Math.abs(input.analysis.paid - input.analysis.net) > AMOUNT_MISMATCH_EGP) {
    return block('المبلغ المدفوع والصافي مش متطابقين. صوّر الفاتورة تاني بوضوح.');
  }

  const amountAllowed = input.analysis.amountSource === 'paid'
    || input.analysis.amountSource === 'net'
    || (input.analysis.amountSource === 'total' && (input.analysis.discount == null || input.analysis.discount <= 0));

  if (!amountAllowed) {
    return block('لازم المبلغ المدفوع يكون واضح. مش هيتضاف نقاط على مبلغ متلخبط أو قبل الخصم.');
  }

  const invoiceDay = parseInvoiceDay(input.analysis.invoiceDate);
  if (invoiceDay && !sameDay(invoiceDay, input.now)) {
    return block(`الفاتورة بتاريخ ${input.analysis.invoiceDate} مش فاتورة النهاردة، ومش هيتضاف عليها نقاط.`);
  }

  if (!input.analysis.invoiceTotal || input.analysis.points !== calculateInvoicePoints(input.analysis.invoiceTotal) || input.analysis.points <= 0) {
    return block('المبلغ المستخرج صغير أو غير موثوق. صوّر الإجمالي تاني.');
  }

  return allow();
}

export async function fingerprintImage(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function allow(): InvoiceReview {
  return { allowed: true, reason: null };
}

function block(reason: string): InvoiceReview {
  return { allowed: false, reason };
}

function parseInvoiceDay(value: string | null): { year: number; month: number; day: number } | null {
  if (!value) {
    return null;
  }

  const named = value.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    return month ? validDay(Number(named[3]), month, Number(named[1])) : null;
  }

  const iso = value.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (iso) {
    return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const local = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!local) {
    return null;
  }

  const year = Number(local[3].length === 2 ? `20${local[3]}` : local[3]);
  return validDay(year, Number(local[2]), Number(local[1]));
}

function validDay(year: number, month: number, day: number): { year: number; month: number; day: number } | null {
  if (year < 2020 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function sameDay(day: { year: number; month: number; day: number }, now: Date): boolean {
  return day.year === now.getFullYear()
    && day.month === now.getMonth() + 1
    && day.day === now.getDate();
}
