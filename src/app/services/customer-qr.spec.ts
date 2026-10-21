import { parseCustomerQr } from './customer-qr';

describe('customer qr parser', () => {
  it('keeps a plain customer code as-is', () => {
    const profile = parseCustomerQr('  CUST-1001  ');

    expect(profile.publicCode).toBe('CUST-1001');
    expect(profile.name).toBeNull();
    expect(profile.fields).toEqual([]);
  });

  it('reads the customer name and phone from a json payload', () => {
    const profile = parseCustomerQr(JSON.stringify({
      publicCode: 'CUST-1001',
      customer: { fullName: 'محمد علي', phone: '01001234567', points: 240 }
    }));

    expect(profile.publicCode).toContain('CUST-1001');
    expect(profile.name).toBe('محمد علي');
    expect(profile.fields).toEqual([
      { label: 'الكود', value: 'CUST-1001' },
      { label: 'الموبايل', value: '01001234567' },
      { label: 'النقاط', value: '240' }
    ]);
  });

  it('reads customer fields from a qr url', () => {
    const profile = parseCustomerQr('https://rabahni.com/u?name=Sara%20Adel&phone=01112223334&code=AB12');

    expect(profile.name).toBe('Sara Adel');
    expect(profile.fields).toEqual([
      { label: 'الكود', value: 'AB12' },
      { label: 'الموبايل', value: '01112223334' }
    ]);
  });

  it('reads the name from a jwt payload', () => {
    const header = btoa(JSON.stringify({ alg: 'none' })).replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ fullName: 'Nour Hassan', phone: '01099887766' })).replace(/=+$/, '');
    const profile = parseCustomerQr(`${header}.${payload}.sig`);

    expect(profile.name).toBe('Nour Hassan');
    expect(profile.fields).toEqual([{ label: 'الموبايل', value: '01099887766' }]);
  });

  it('reads arabic labels written inside the code', () => {
    const profile = parseCustomerQr('الاسم: أحمد سعيد\nالموبايل: 01234567890');

    expect(profile.name).toBe('أحمد سعيد');
    expect(profile.fields).toEqual([{ label: 'الموبايل', value: '01234567890' }]);
  });
});