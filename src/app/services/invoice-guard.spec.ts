import { parseInvoiceText } from './invoice-parser';
import { reviewCapture, reviewInvoiceReading } from './invoice-guard';

const NOW = new Date(2026, 9, 21, 11, 0, 0);

const CLEAR_RECEIPT = `
Invoice No. FO18898120878790 رقم الفاتورة
Date 21-Oct-2026
Total Amount 100.00 الإجمالي
Discount 0.00 الخصم
Net 100.00 الصافي
Paid 100.00 المدفوع
`;

describe('invoice fraud guard', () => {
  it('accepts a fresh photo of today invoice when the paid amount is clear', () => {
    const review = reviewInvoiceReading({
      analysis: parseInvoiceText(CLEAR_RECEIPT),
      duplicateInvoice: null,
      duplicateImage: null,
      now: NOW
    });

    expect(review.allowed).toBeTrue();
    expect(reviewCapture(NOW.getTime() - 1000, NOW.getTime()).allowed).toBeTrue();
  });

  it('rejects an old gallery photo before it is worth reading', () => {
    const review = reviewCapture(NOW.getTime() - 11 * 60 * 1000, NOW.getTime());

    expect(review.allowed).toBeFalse();
    expect(review.reason).toContain('مش متصورة دلوقتي');
  });

  it('rejects the same invoice number and the same image', () => {
    const analysis = parseInvoiceText(CLEAR_RECEIPT);
    const prior = { uploadedAt: '2026-10-21 10:00:00' };

    expect(reviewInvoiceReading({
      analysis,
      duplicateInvoice: prior,
      duplicateImage: null,
      now: NOW
    }).reason).toContain('FO18898120878790');

    expect(reviewInvoiceReading({
      analysis,
      duplicateInvoice: null,
      duplicateImage: prior,
      now: NOW
    }).reason).toContain('الصورة دي اتسجلت');
  });

  it('rejects a paid amount that does not match the net', () => {
    const analysis = parseInvoiceText(CLEAR_RECEIPT);
    analysis.paid = 500;
    analysis.invoiceTotal = 500;

    const review = reviewInvoiceReading({
      analysis,
      duplicateInvoice: null,
      duplicateImage: null,
      now: NOW
    });

    expect(review.allowed).toBeFalse();
    expect(review.reason).toContain('مش متطابقين');
  });

  it('rejects a guessed amount and an invoice from another day', () => {
    const guessed = parseInvoiceText('random line 999.99');
    expect(reviewInvoiceReading({
      analysis: guessed,
      duplicateInvoice: null,
      duplicateImage: null,
      now: NOW
    }).allowed).toBeFalse();

    const yesterday = parseInvoiceText(CLEAR_RECEIPT.replace('21-Oct-2026', '20-Oct-2026'));
    expect(reviewInvoiceReading({
      analysis: yesterday,
      duplicateInvoice: null,
      duplicateImage: null,
      now: NOW
    }).reason).toContain('مش فاتورة النهاردة');
  });

  it('rejects points calculated from the gross total when a discount exists', () => {
    const analysis = parseInvoiceText(`
      Invoice No. FO18898120878790
      Total Amount 350.88 الإجمالي
      Discount 307.01 الخصم
    `);

    expect(analysis.amountSource).toBe('total');
    expect(reviewInvoiceReading({
      analysis,
      duplicateInvoice: null,
      duplicateImage: null,
      now: NOW
    }).reason).toContain('قبل الخصم');
  });
});
