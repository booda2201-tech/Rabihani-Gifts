export const INVOICE_POINTS_RATE = 0.1;

export interface InvoiceParseResult {
  totalAmount: number | null;
  discount: number | null;
  tax: number | null;
  net: number | null;
  paid: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  customerPhone: string | null;
  invoiceTotal: number | null;
  points: number;
  amountSource: 'paid' | 'net' | 'total' | 'fallback' | null;
  invoiceNumberTrusted: boolean;
  confidence: 'high' | 'medium' | 'low';
  rawText: string;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const FIELD_PATTERNS: Record<
  'totalAmount' | 'discount' | 'tax' | 'net' | 'paid',
  RegExp
> = {
  totalAmount: /ا?ل?اجمل[يى]|ا?ل?إ?جمال[يى]|total\s*amount|fotalal|totalamount|tote\s*amount|otal\s*amount/i,
  discount: /الخصم|discount|discorint/i,
  tax: /الضريبة|الضريبه|\btax\b|\blax\b|faxax|taxax/i,
  net: /الصافي|الصافى|\bnet\b|netet|vetet|fact/i,
  paid: /المدفوع|المنقوع|paidid|\bpaid\b/i
};

const MONEY_RE = /(\d{1,7}[.,]\d{2,4})/g;
const INVOICE_NO_FORWARD_RE = /(?:invoice|nvoice|فاتور)[^\n]{0,30}?([A-Z]{1,4}\d{8,})/i;
const INVOICE_NO_BACKWARD_RE = /([A-Z]{1,4}\d{8,})[^\n]{0,30}?(?:invoice|nvoice|فاتور)/i;
const INVOICE_NO_FALLBACK_RE = /\b([A-Z]{1,3}\d{10,})\b/;
const INVOICE_DATE_RE = /(\d{1,2}-[A-Za-z]{3,9}-\d{4})/;
const PHONE_LABELED_RE = /(?:هاتف(?:\s*العميل)?|mobile|cust\.?\s*mobile)[^\d+]{0,24}(\+?0?\d{8,13})/i;
const PHONE_EGY_RE = /\b(01[0125]\d{8})\b/;

export function calculateInvoicePoints(total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round(total * INVOICE_POINTS_RATE);
}

export function parseInvoiceText(text: string): InvoiceParseResult {
  const normalized = normalizeInvoiceText(text);
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const found: Record<'totalAmount' | 'discount' | 'tax' | 'net' | 'paid', number | null> = {
    totalAmount: null,
    discount: null,
    tax: null,
    net: null,
    paid: null
  };

  for (const line of lines) {
    const amounts = extractMoneyValues(line);
    if (!amounts.length) {
      continue;
    }

    (Object.keys(FIELD_PATTERNS) as Array<keyof typeof FIELD_PATTERNS>).forEach((key) => {
      if (found[key] == null && FIELD_PATTERNS[key].test(line)) {
        found[key] = pickLineAmount(amounts);
      }
    });
  }

  let usedFallback = false;
  if (found.paid == null && found.net == null && found.totalAmount == null) {
    const fallback = extractMoneyValues(normalized).filter((value) => value > 0);
    if (fallback.length) {
      found.totalAmount = fallback[fallback.length - 1];
      usedFallback = true;
    }
  }

  const invoiceTotal = found.paid ?? found.net ?? found.totalAmount;
  const amountSource = found.paid != null
    ? 'paid'
    : found.net != null
      ? 'net'
      : usedFallback
        ? 'fallback'
        : found.totalAmount != null
          ? 'total'
          : null;
  const matchedFields = [found.paid, found.net, found.totalAmount].filter((value) => value != null).length;
  const invoiceNumber = extractInvoiceNumber(normalized);

  return {
    ...found,
    invoiceNumber: invoiceNumber.value,
    invoiceDate: extractInvoiceDate(normalized),
    customerPhone: extractCustomerPhone(normalized),
    invoiceTotal,
    points: invoiceTotal == null ? 0 : calculateInvoicePoints(invoiceTotal),
    amountSource,
    invoiceNumberTrusted: invoiceNumber.trusted,
    confidence: matchedFields >= 2 ? 'high' : matchedFields === 1 ? 'medium' : 'low',
    rawText: text
  };
}

function normalizeInvoiceText(text: string): string {
  return text
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[|]/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function extractMoneyValues(text: string): number[] {
  return [...text.matchAll(MONEY_RE)]
    .map((match) => parseMoney(match[1]))
    .filter((value): value is number => value != null);
}

function parseMoney(raw: string): number | null {
  const parsed = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000000) {
    return null;
  }

  return parsed;
}

function pickLineAmount(amounts: number[]): number {
  const meaningful = amounts.filter((value) => value > 0);
  return (meaningful.length ? meaningful : amounts)[0];
}

function extractInvoiceNumber(text: string): { value: string | null; trusted: boolean } {
  const labeled = text.match(INVOICE_NO_FORWARD_RE) || text.match(INVOICE_NO_BACKWARD_RE);
  if (labeled?.[1]) {
    return { value: labeled[1].toUpperCase(), trusted: true };
  }

  const fallback = text.match(INVOICE_NO_FALLBACK_RE);
  return { value: fallback ? fallback[1].toUpperCase() : null, trusted: false };
}

function extractInvoiceDate(text: string): string | null {
  const labeled = text.match(/(?:تاريخ(?:\s*الفاتورة)?|invoice\s*date|\bdate\b)[^\dA-Za-z]{0,16}(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}-[A-Za-z]{3,9}-\d{4})/i);
  if (labeled?.[1]) {
    return labeled[1];
  }

  const named = text.match(INVOICE_DATE_RE);
  return named ? named[1] : null;
}

function extractCustomerPhone(text: string): string | null {
  const labeled = text.match(PHONE_LABELED_RE);
  if (labeled?.[1]) {
    return labeled[1];
  }

  const egyptian = text.match(PHONE_EGY_RE);
  return egyptian ? egyptian[1] : null;
}
