import { calculateInvoicePoints, isOurStore, type InvoiceParseResult } from './invoice-parser';
import type { ReceiptQrReading } from './invoice-receipt-qr';

export function mergeInvoiceReading(
  analysis: InvoiceParseResult,
  qr: ReceiptQrReading | null
): InvoiceParseResult {
  if (!qr) {
    return analysis;
  }

  const paid = analysis.paid;
  const net = analysis.net;
  const qrTotal = qr.invoiceTotal;
  let amountSource = analysis.amountSource;
  let invoiceTotal = analysis.invoiceTotal;

  if ((amountSource !== 'paid' && amountSource !== 'net') && qrTotal != null) {
    invoiceTotal = qrTotal;
    amountSource = 'paid';
  } else if (paid == null && net == null && qrTotal != null) {
    invoiceTotal = qrTotal;
    amountSource = 'paid';
  } else if (invoiceTotal != null && qrTotal != null && Math.abs(invoiceTotal - qrTotal) <= 1) {
    invoiceTotal = paid ?? net ?? qrTotal;
    amountSource = paid != null ? 'paid' : net != null ? 'net' : 'paid';
  }

  const invoiceDate = analysis.invoiceDate || formatQrDate(qr.invoiceDate);
  const storeOk = analysis.invoiceNumberTrusted || isOurStore(analysis.rawText) || qr.ourStore;

  return {
    ...analysis,
    paid: paid ?? (amountSource === 'paid' ? invoiceTotal : paid),
    net: net ?? (amountSource === 'net' ? invoiceTotal : net),
    tax: analysis.tax ?? qr.tax,
    invoiceDate,
    invoiceTotal,
    amountSource,
    points: invoiceTotal == null ? 0 : calculateInvoicePoints(invoiceTotal),
    invoiceNumberTrusted: analysis.invoiceNumberTrusted && storeOk,
    confidence: qrTotal != null && analysis.confidence === 'low' ? 'medium' : analysis.confidence
  };
}

function formatQrDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) {
    return value;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(iso[2]) - 1];
  return month ? `${Number(iso[3])}-${month}-${iso[1]}` : value;
}
