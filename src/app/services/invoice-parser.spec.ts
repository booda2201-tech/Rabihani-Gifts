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
    expect(parseInvoiceText('Invoice No. FO1907512037141\n732').invoiceNumber).toBe('FO1907512037141732');
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

  it('reads the real Porto sample with the continuation on the same or next line', () => {
    const wrapped = parseInvoiceText(`
      PORTO محل مغسلة المحطة للسيارات
      Invoice No.: FO1907512009978 رقم الفاتورة
      551
      Date 23-Oct-2026
      Total Amount 241.230 الاجمالي
      Tax 33.773 الضريبة
      Net 275.003 الصافي
      Paid 275.003 المدفوع
    `);
    const sameLine = parseInvoiceText(`
      PORTO
      Invoice No FO1907512009978551 رقم الفاتورة
      Date 23-Oct-2026
      Paid 275.003 المدفوع
      Net 275.003 الصافي
    `);
    const spaced = parseInvoiceText(`
      PORTO
      Invoice No. FO1907512009978 551
      Paid 275.003 المدفوع
    `);

    expect(wrapped.invoiceNumber).toBe('FO1907512009978551');
    expect(wrapped.invoiceTotal).toBe(275.003);
    expect(wrapped.points).toBe(55);
    expect(sameLine.invoiceNumber).toBe('FO1907512009978551');
    expect(spaced.invoiceNumber).toBe('FO1907512009978551');
  });

  it('infers paid/net from total plus tax when the paid line is missing', () => {
    const result = parseInvoiceText(`
      PORTO
      Invoice No. FO1907512037141
      732
      Date 23-Oct-2026
      Total Amount 175.440
      Tax 24.562
    `);

    expect(result.net).toBe(200.002);
    expect(result.invoiceTotal).toBe(200.002);
    expect(result.amountSource).toBe('net');
    expect(result.points).toBe(40);
  });

  it('recovers a noisy Forto number even when OCR breaks the lines', () => {
    const result = parseInvoiceText(`
      Maghsala fourto
      Inv0ice No F0 1907 5120 37141
      732
      Date 23-Oct-2026
      Paid 200.002
      Net 200.002
      Tax 24.562
    `);

    expect(result.invoiceNumber).toBe('FO1907512037141732');
    expect(result.invoiceNumberTrusted).toBeTrue();
  });

  it('accepts Bubble Hope when the logo is missing and the number wraps as 12+4', () => {
    const result = parseInvoiceText(`
      Print Date 23-Nov-2026
      Invoice No.: MO192841189449
      7417
      Date 23-Nov-2026
      Total Amount 263.159
      Fax 36.842
      Vet 300.002
      Paid 300.002
    `);
    const noisy = parseInvoiceText(`
      Bobble hope
      nvoice No MO192841189449
      7417
      Date 23-Nov-2026
      Paidid 300.002
      Netet 300.002
    `);

    expect(result.invoiceNumber).toBe('MO1928411894497417');
    expect(result.invoiceNumberTrusted).toBeTrue();
    expect(result.invoiceTotal).toBe(300.002);
    expect(result.points).toBe(60);
    expect(noisy.invoiceNumber).toBe('MO1928411894497417');
    expect(noisy.invoiceNumberTrusted).toBeTrue();
  });

});
