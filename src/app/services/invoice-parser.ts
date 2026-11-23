export const INVOICE_POINTS_RATE = 0.2;

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
  tax: /الضريبة|الضريبه|\btax\b|\bfax\b|\blax\b|faxax|taxax/i,
  net: /الصافي|الصافى|\bnet\b|netet|vetet|fact|\bvet\b/i,
  paid: /المدفوع|المنقوع|paidid|\bpaid\b|\bpald\b|pa\s*id/i
};

const MONEY_RE = /(\d{1,7}[.,]\d{2,4})/g;
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

  // Forto/Bubble: Net/Paid = Total Amount + Tax when OCR misses the paid line.
  if (found.paid == null && found.net == null
    && found.totalAmount != null && found.tax != null
    && found.totalAmount > 0 && found.tax > 0) {
    found.net = roundMoney(found.totalAmount + found.tax);
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

function roundMoney(value: number): number {
  return Math.round(value * 1000) / 1000;
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
  const value = findBranchInvoiceNumber(text);
  if (!value) {
    return { value: null, trusted: false };
  }

  // Forto/Bubble share one POS number shape. Brand logos often fail OCR, so the
  // number itself is the identity; store words are a bonus, not a hard gate.
  return { value, trusted: true };
}

function findBranchInvoiceNumber(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = compactInvoiceLine(lines[index]);
    const labeled = /invoice|nvoice|inv[o0]ice|فاتور|\bno\b/i.test(line);
    if (!labeled) {
      continue;
    }

    const onLabel = parseBranchInvoiceNumber(line, lines[index + 1] ?? '');
    if (onLabel) {
      return onLabel;
    }

    const onNext = parseBranchInvoiceNumber(
      compactInvoiceLine(lines[index + 1] ?? ''),
      lines[index + 2] ?? ''
    );
    if (onNext) {
      return onNext;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseBranchInvoiceNumber(
      compactInvoiceLine(lines[index]),
      lines[index + 1] ?? ''
    );
    if (parsed) {
      return parsed;
    }
  }

  return findBranchInvoiceNumberLoose(text);
}

function findBranchInvoiceNumberLoose(text: string): string | null {
  const compact = text
    .toUpperCase()
    .replace(/[^A-Z0-9\n]/g, '')
    .replace(/O/g, '0')
    .replace(/Q/g, '0')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');

  const glued = compact.match(/([A-Z][A-Z0-9])([0-9]{16})/);
  if (glued) {
    return formatInvoiceNumber(glued[1], glued[2].slice(0, 13), glued[2].slice(13));
  }

  const wrapped = compact.match(/([A-Z][A-Z0-9])([0-9]{12,13})\n([0-9]{3,4})/);
  if (wrapped) {
    return assembleInvoiceNumber(wrapped[1], wrapped[2], wrapped[3]);
  }

  return null;
}

function parseBranchInvoiceNumber(line: string, nextLine: string): string | null {
  if (!line) {
    return null;
  }

  const glued = line.match(/([A-Z][A-Z0-9])([0-9OQILSBZ]{16})\b/i);
  if (glued) {
    return formatInvoiceNumber(glued[1], glued[2].slice(0, 13), glued[2].slice(13));
  }

  const sameLine = line.match(/([A-Z][A-Z0-9])([0-9OQILSBZ]{13})([0-9OQILSBZ]{3})\b/i);
  if (sameLine) {
    return formatInvoiceNumber(sameLine[1], sameLine[2], sameLine[3]);
  }

  const spaced = line.match(/([A-Z][A-Z0-9])([0-9OQILSBZ]{12,13})\s+([0-9OQILSBZ]{3,4})\b/i);
  if (spaced) {
    return assembleInvoiceNumber(spaced[1], spaced[2], spaced[3]);
  }

  const head = line.match(/([A-Z][A-Z0-9])([0-9OQILSBZ]{12,13})\b/i);
  const continuation = normalizeDigitRun(nextLine.replace(/\s/g, ''));
  if (head && /^\d{3,4}$/.test(continuation)) {
    return assembleInvoiceNumber(head[1], head[2], continuation);
  }

  return null;
}

function assembleInvoiceNumber(prefix: string, body: string, tail: string): string | null {
  const digits = normalizeDigitRun(`${body}${tail}`);
  if (digits.length !== 16) {
    return null;
  }

  return formatInvoiceNumber(prefix, digits.slice(0, 13), digits.slice(13));
}

export function isOurStore(text: string): boolean {
  return /porto|forto|fourto|فورت|بورت|مغسل|bubble|bobble|bubbl|بابل|زول|زويل|hope|zweil|zoweil|hendal|هندال/i.test(text)
    || (
      /invoice|nvoice|inv[o0]ice/i.test(text)
      && /paid|paidid|المدفوع/i.test(text)
      && /net|vetet|الصافي/i.test(text)
      && /tax|fax|lax|total\s*amount|الاجمال|الإجمال/i.test(text)
    );
}

function compactInvoiceLine(line: string): string {
  return line
    .replace(/([A-Za-z])\s+(?=[A-Za-z0-9])/g, '$1')
    .replace(/([0-9OQILSBZ])\s+(?=[0-9OQILSBZ])/gi, '$1');
}

function formatInvoiceNumber(prefix: string, body: string, tail: string): string {
  return `${normalizeBranchCode(prefix)}${normalizeDigitRun(body)}${normalizeDigitRun(tail)}`;
}

function normalizeBranchCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/2/g, 'Z');
}

function normalizeDigitRun(value: string): string {
  return value
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/Q/g, '0')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');
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
