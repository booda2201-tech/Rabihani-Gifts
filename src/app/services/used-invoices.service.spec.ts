import { formatDateTimeToSecond, UsedInvoicesService } from './used-invoices.service';

describe('UsedInvoicesService', () => {
  let service: UsedInvoicesService;

  beforeEach(() => {
    localStorage.clear();
    service = new UsedInvoicesService();
  });

  it('formats the upload time down to the second', () => {
    expect(formatDateTimeToSecond(new Date(2026, 8, 20, 17, 21, 5, 890))).toBe('2026-09-20 17:21:05');
  });

  it('rejects the same invoice number even if it is uploaded a second later', () => {
    service.markUsed({
      invoiceNumber: 'FO18898120878790',
      imageAddedAt: '2026-09-20 17:21:05',
      uploadedAt: '2026-09-20 17:21:05',
      total: 50.012,
      points: 10,
      newBalance: 110
    });

    const duplicate = service.findDuplicate('fo18898120878790');
    expect(duplicate).toBeTruthy();
    expect(duplicate?.uploadedAt).toBe('2026-09-20 17:21:05');
    expect(service.findDuplicate('ZO18896118771070')).toBeNull();
  });

  it('rejects the same invoice when a second photo misreads letters or one digit', () => {
    service.markUsed({
      invoiceNumber: 'FO1907512009978',
      imageAddedAt: '2026-11-10 17:20:00',
      uploadedAt: '2026-11-10 17:20:00',
      total: 275.003,
      points: 55,
      newBalance: 55
    });

    expect(service.findDuplicate('F0 1907512009978', 275.003)?.invoiceNumber).toBe('FO1907512009978');
    expect(service.findDuplicate('FO1907512OO9978', 275)?.invoiceNumber).toBe('FO1907512009978');
    expect(service.findDuplicate('FO1907512009988', 275.4)?.invoiceNumber).toBe('FO1907512009978');
    expect(service.findDuplicate('FO1907512009988', 90)).toBeNull();
    expect(service.findDuplicate('ZZ99999999999999', 275.003)).toBeNull();
  });

  it('rejects the same amount on the same day when the invoice number is read as a different one', () => {
    const uploadedAt = formatDateTimeToSecond(new Date());
    service.markUsed({
      invoiceNumber: 'FO1907512009978',
      imageAddedAt: uploadedAt,
      uploadedAt,
      total: 275.003,
      points: 55,
      newBalance: 80
    });

    expect(service.findDuplicate('KX448812009991', 275)?.invoiceNumber).toBe('FO1907512009978');
    expect(service.findDuplicate('KX448812009991', 90)).toBeNull();

    service.markUsed({
      invoiceNumber: 'FO1907512001111',
      imageAddedAt: '2026-11-01 12:00:00',
      uploadedAt: '2026-11-01 12:00:00',
      total: 80,
      points: 16,
      newBalance: 16
    });
    expect(service.findDuplicate('QQ111111111111', 80)).toBeNull();
  });

  it('treats a wrapped Porto invoice number as the same invoice even when the amount differs', () => {
    service.markUsed({
      invoiceNumber: 'FO1907512037141732',
      imageAddedAt: '2026-11-10 18:00:00',
      uploadedAt: '2026-11-10 18:00:00',
      total: 200.002,
      points: 40,
      newBalance: 40
    });

    expect(service.findDuplicate('FO1907512037141', 175.44)?.invoiceNumber).toBe('FO1907512037141732');
    expect(service.findDuplicate('FO1907512009978', 50)).toBeNull();
  });

  it('rejects the same photo even when the invoice number was read differently', () => {
    service.markUsed({
      invoiceNumber: 'FO18898120878790',
      imageAddedAt: '2026-10-21 11:00:00',
      uploadedAt: '2026-10-21 11:00:00',
      total: 100,
      points: 20,
      newBalance: 20,
      imageHash: 'abc123'
    });

    service.markUsed({
      invoiceNumber: 'FO0000000000002',
      imageAddedAt: '2026-10-21 11:05:00',
      uploadedAt: '2026-10-21 11:05:00',
      total: 80,
      points: 8,
      newBalance: Number.NaN,
      imageHash: 'unconfirmed'
    });

    expect(service.findDuplicate('FO0000000000002')).toBeNull();
    expect(service.findDuplicateImage('unconfirmed')).toBeNull();

    expect(service.findDuplicateImage('abc123')?.invoiceNumber).toBe('FO18898120878790');
    expect(service.findDuplicateImage('other')).toBeNull();
  });
});
