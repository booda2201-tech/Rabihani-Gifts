export interface CustomerField {
  label: string;
  value: string;
}

export interface CustomerQrProfile {
  publicCode: string;
  name: string | null;
  fields: CustomerField[];
}

const NAME_PRIORITY = [
  'fullname',
  'customername',
  'displayname',
  'الاسمالكامل',
  'اسمالعميل',
  'الاسم',
  'اسم',
  'name',
  'username',
  'clientname'
];

const CODE_KEYS = new Set([
  'publiccode',
  'code',
  'qrcode',
  'usercode',
  'customercode',
  'الكود',
  'كود',
  'كودالعميل'
]);

const FIELD_LABELS: Record<string, string> = {
  phone: 'الموبايل',
  mobile: 'الموبايل',
  phonenumber: 'الموبايل',
  customerphone: 'الموبايل',
  هاتف: 'الموبايل',
  هاتفالعميل: 'الموبايل',
  موبايل: 'الموبايل',
  تليفون: 'الموبايل',
  email: 'البريد',
  mail: 'البريد',
  points: 'النقاط',
  pointbalance: 'النقاط',
  currentpoints: 'النقاط',
  النقاط: 'النقاط',
  balance: 'الرصيد',
  newbalance: 'الرصيد',
  الرصيد: 'الرصيد',
  userid: 'رقم العميل',
  customerid: 'رقم العميل',
  id: 'رقم العميل'
};

const HIDDEN_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'authorization',
  'jwt',
  'apikey'
]);

const CONTAINERS = new Set(['user', 'customer', 'data', 'profile', 'member', 'client', 'payload']);

export function parseCustomerQr(raw: string): CustomerQrProfile {
  const publicCode = raw.trim();
  const record = extractRecord(publicCode);

  if (!record) {
    return { publicCode, name: null, fields: [] };
  }

  const name = pickName(record);
  const fields: CustomerField[] = [];
  const seenLabels = new Set<string>();

  const embeddedCode = pick(record, CODE_KEYS);
  if (embeddedCode && embeddedCode !== publicCode && embeddedCode.length <= 64) {
    pushField(fields, seenLabels, 'الكود', embeddedCode);
  }

  Object.entries(record).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (!value || value.length > 80) {
      return;
    }
    if (HIDDEN_KEYS.has(normalized) || CODE_KEYS.has(normalized) || isNameKey(normalized)) {
      return;
    }

    const label = FIELD_LABELS[normalized] || humanLabel(key);
    pushField(fields, seenLabels, label, value);
  });

  return { publicCode, name, fields };
}

function extractRecord(raw: string): Record<string, string> | null {
  if (!raw) {
    return null;
  }

  const json = tryJson(raw);
  if (json) {
    return json;
  }

  const jwt = tryJwt(raw);
  if (jwt) {
    return jwt;
  }

  const url = tryUrl(raw);
  if (url) {
    return url;
  }

  return tryLabeled(raw);
}

function tryJson(raw: string): Record<string, string> | null {
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    return null;
  }

  try {
    return flatten(JSON.parse(raw));
  } catch {
    return null;
  }
}

function tryJwt(raw: string): Record<string, string> | null {
  const parts = raw.split('.');
  if (parts.length < 2 || parts.some((part) => !part || part.length > 4000)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return flatten(payload);
  } catch {
    return null;
  }
}

function tryUrl(raw: string): Record<string, string> | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return null;
  }

  try {
    const url = new URL(raw);
    const record: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      const text = value.trim();
      if (text) {
        record[key] = text;
      }
    });
    return Object.keys(record).length ? record : null;
  } catch {
    return null;
  }
}

function tryLabeled(raw: string): Record<string, string> | null {
  if (raw.length > 2000 || !/[=:]/.test(raw)) {
    return null;
  }

  const record: Record<string, string> = {};
  raw.split(/\r?\n|&|\|/).forEach((part) => {
    const match = part.trim().match(/^([^\n:=]{1,30})\s*[:=]\s*(.{1,80})$/);
    if (!match) {
      return;
    }
    record[match[1].trim()] = match[2].trim();
  });

  const keys = Object.keys(record);
  if (!keys.length) {
    return null;
  }

  const hasKnown = keys.some((key) => {
    const normalized = normalizeKey(key);
    return isNameKey(normalized) || CODE_KEYS.has(normalized) || !!FIELD_LABELS[normalized];
  });

  return hasKnown || keys.length >= 2 ? record : null;
}

function flatten(value: unknown, depth = 0): Record<string, string> {
  const record: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) {
    return record;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (child == null) {
      return;
    }

    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
      const text = String(child).trim();
      if (text) {
        record[key] = text;
      }
      return;
    }

    if (typeof child === 'object' && !Array.isArray(child)) {
      const nested = flatten(child, depth + 1);
      if (CONTAINERS.has(normalizeKey(key))) {
        Object.assign(record, nested);
        return;
      }

      Object.entries(nested).forEach(([nestedKey, nestedValue]) => {
        record[`${key}.${nestedKey}`] = nestedValue;
      });
    }
  });

  return record;
}

function pickName(record: Record<string, string>): string | null {
  for (const key of NAME_PRIORITY) {
    const match = Object.entries(record).find(([recordKey, value]) => normalizeKey(recordKey) === key && !!value);
    if (match && match[1].length <= 80) {
      return match[1];
    }
  }

  return null;
}

function pick(record: Record<string, string>, keys: Set<string>): string | null {
  const match = Object.entries(record).find(([key, value]) => keys.has(normalizeKey(key)) && !!value);
  return match ? match[1] : null;
}

function pushField(fields: CustomerField[], seenLabels: Set<string>, label: string, value: string): void {
  if (seenLabels.has(label)) {
    return;
  }

  seenLabels.add(label);
  fields.push({ label, value });
}

function isNameKey(normalized: string): boolean {
  return NAME_PRIORITY.includes(normalized);
}

function humanLabel(key: string): string {
  const clean = key.split('.').pop() || key;
  return clean.replace(/[_-]+/g, ' ').trim();
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_\-.]/g, '');
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
