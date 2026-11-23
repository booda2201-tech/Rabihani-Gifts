import jsQR from 'jsqr';

export interface ReceiptQrReading {
  raw: string;
  sellerName: string | null;
  invoiceTotal: number | null;
  tax: number | null;
  invoiceDate: string | null;
  ourStore: boolean;
}

export async function readReceiptQr(image: string): Promise<ReceiptQrReading | null> {
  const img = await loadImage(image);
  // Receipt QR sits near the bottom. One small crop keeps this off the critical path.
  const raw = decodeRegion(img, 0.1, 0.55, 0.8, 0.45)
    || decodeRegion(img, 0.2, 0.65, 0.6, 0.35);
  return raw ? parseEtaQr(raw) : null;
}

function decodeRegion(
  img: HTMLImageElement,
  xRatio: number,
  yRatio: number,
  widthRatio: number,
  heightRatio: number
): string | null {
  const sx = Math.round(img.width * xRatio);
  const sy = Math.round(img.height * yRatio);
  const sw = Math.max(1, Math.round(img.width * widthRatio));
  const sh = Math.max(1, Math.round(img.height * heightRatio));
  const scale = Math.min(1, 700 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return null;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })?.data?.trim() || null;
}

function parseEtaQr(raw: string): ReceiptQrReading | null {
  let bytes: Uint8Array | null = null;
  try {
    const binary = atob(raw.replace(/\s/g, ''));
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }

  const fields = new Map<number, string>();
  let index = 0;
  while (index + 2 <= bytes.length) {
    const tag = bytes[index];
    const length = bytes[index + 1];
    index += 2;
    if (length < 0 || index + length > bytes.length) {
      break;
    }
    fields.set(tag, new TextDecoder().decode(bytes.slice(index, index + length)));
    index += length;
  }

  const sellerName = fields.get(1) || null;
  const timestamp = fields.get(3) || null;
  const total = parseAmount(fields.get(4));
  const tax = parseAmount(fields.get(5));
  if (!sellerName && total == null && !timestamp) {
    return null;
  }

  return {
    raw,
    sellerName,
    invoiceTotal: total,
    tax,
    invoiceDate: timestamp ? timestamp.slice(0, 10) : null,
    ourStore: isOurStoreName(sellerName || '')
  };
}

function parseAmount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isOurStoreName(value: string): boolean {
  return /porto|forto|فورت|بورت|مغسل|bubble|بابل|زول|زويل|hope|zweil|zoweil|hendal|هندال|رباح|rabihani/i.test(value);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
    img.src = source;
  });
}
