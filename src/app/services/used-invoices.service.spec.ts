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
      points: 5
    });

    const duplicate = service.findDuplicate('fo18898120878790');
    expect(duplicate).toBeTruthy();
    expect(duplicate?.uploadedAt).toBe('2026-09-20 17:21:05');
    expect(service.findDuplicate('ZO18896118771070')).toBeNull();
  });
});
