import { calculateInvoicePoints, parseInvoiceText } from './invoice-parser';

const FORTO_RECEIPT = `
PORTO مغسله
Invoice No. FO1907512037141 رقم الفاتورة
732
Cust. Mobile 01114311146 هاتف العميل
fotalal Amounto 350.8800 الإجمالي
Discorint 307.01 الخصم
Faxax 6.1422 الضريبة
vetet 50.0122 الصافي
Paidid 50.0122 المدفوع
changge 0.0000 المتبقي
`;

const BUBBLE_RECEIPT = `
Bubble كافيه زول
Invoice No. ZO1919921821912 رقم الفاتورة
222
TotalAmounto 122.8088 الإجمالي
Discount 0.0000 الخصم
Taxax 17.1933 الضريبة
Netet 140.0022 الصافي
Paidid 140.0022 المدفوع
Change 0.0000 المتبقي
`;

describe('invoice parser', () => {
  it('calculates 20 percent points from the invoice total', () => {
    expect(calculateInvoicePoints(1000)).toBe(200);
    expect(calculateInvoicePoints(140.0022)).toBe(28);
    expect(calculateInvoicePoints(50.0122)).toBe(10);
  });

  it('reads the paid total from a Forto-style receipt', () => {
    const result = parseInvoiceText(FORTO_RECEIPT);

    expect(result.totalAmount).toBe(350.88);
    expect(result.paid).toBe(50.0122);
    expect(result.invoiceTotal).toBe(50.0122);
    expect(result.points).toBe(10);
    expect(result.invoiceNumber).toBe('FO1907512037141732');
    expect(parseInvoiceText('رقم الفاتورة 18898120\nالمدفوع 50.00').invoiceNumber).toBeNull();
    expect(parseInvoiceText('Invoice No. FO1907512037141\n732').invoiceNumber).toBeNull();
    expect(result.invoiceNumberTrusted).toBeTrue();
    expect(result.amountSource).toBe('paid');
    expect(result.customerPhone).toBe('01114311146');
    expect(result.confidence).toBe('high');
  });

  it('reads the paid total from a cafe-style receipt', () => {
    const result = parseInvoiceText(BUBBLE_RECEIPT);

    expect(result.totalAmount).toBe(122.8088);
    expect(result.paid).toBe(140.0022);
    expect(result.invoiceTotal).toBe(140.0022);
    expect(result.points).toBe(28);
    expect(result.invoiceNumber).toBe('ZO1919921821912222');
    expect(result.invoiceNumberTrusted).toBeTrue();
  });

  it('recovers totals from noisy OCR of the real receipts', () => {
    const forto = parseInvoiceText(`
      الاجمالي 350.880 otal Amount
      الصَافي 50.012 fact
      المدفوع 50.012
    `);
    const bubble = parseInvoiceText(`
      الاجملي 122.608 Tote Amount
      Tax 17.193
      Net 140.002
      المنقوع 40002 Paid
    `);

    expect(forto.invoiceTotal).toBe(50.012);
    expect(forto.points).toBe(10);
    expect(bubble.invoiceTotal).toBe(140.002);
    expect(bubble.points).toBe(28);
  });

  it('joins the wrapped Porto invoice number and uses the paid amount', () => {
    const result = parseInvoiceText(`
      PORTO
      nvoice No. FO1907512037141 رقم الفاتورة
      732
      Date 23-Oct-2026
      Total Amount 175.440 الاجمالي
      Discount 0.00 خصم
      Fax 24.562 الضريبة
      Vet 200.002 الصافي
      Paid 200.002 المدفوع
    `);

    expect(result.invoiceNumber).toBe('FO1907512037141732');
    expect(result.invoiceNumberTrusted).toBeTrue();
    expect(result.invoiceTotal).toBe(200.002);
    expect(result.points).toBe(40);
  });

  it('joins the wrapped Bubble invoice number the same way', () => {
    const result = parseInvoiceText(`
      Bubble
      Invoice No. ZO1919921821912 رقم الفاتورة
      222
      Date 10-Nov-2026
      Total Amount 80.702 الاجمالي
      Tax 11.298 الضريبة
      Net 92.001 الصافي
      Paid 92.001 المدفوع
    `);

    expect(result.invoiceNumber).toBe('ZO1919921821912222');
    expect(result.invoiceNumberTrusted).toBeTrue();
    expect(result.invoiceTotal).toBe(92.001);
    expect(result.points).toBe(18);
  });

  it('accepts another Bubble branch when the first two letters change', () => {
    const result = parseInvoiceText(`
      Bubble
      Invoice No. KM1919921821999 رقم الفاتورة
      441
      Paid 40.00 المدفوع
    `);

    expect(result.invoiceNumber).toBe('KM1919921821999441');
    expect(result.invoiceNumberTrusted).toBeTrue();
  });

});
