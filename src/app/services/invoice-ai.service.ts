import { Injectable, OnDestroy } from '@angular/core';
import { parseInvoiceText, type InvoiceParseResult } from './invoice-parser';

export interface InvoiceProgress {
  status: string;
  progress: number;
}

export type InvoiceAnalysis = InvoiceParseResult;

type TesseractWorker = {
  recognize(image: CanvasImageSource | string): Promise<{ data: { text: string } }>;
  setParameters(params: Record<string, string>): Promise<void>;
  terminate(): Promise<void>;
};

type TesseractApi = {
  createWorker: (
    langs: string,
    oem: number,
    options: {
      logger?: (message: { status: string; progress: number }) => void;
      workerPath?: string;
      corePath?: string;
      langPath?: string;
      gzip?: boolean;
    }
  ) => Promise<TesseractWorker>;
};

@Injectable({
  providedIn: 'root'
})
export class InvoiceAiService implements OnDestroy {
  private worker: TesseractWorker | null = null;
  private workerPromise: Promise<TesseractWorker> | null = null;
  private progressListener: ((progress: InvoiceProgress) => void) | null = null;
  private recognizeFloor = 18;
  private recognizeSpan = 72;

  warmup(): void {
    void this.getWorker().catch(() => undefined);
  }

  /**
   * Reads a normal phone photo of the whole receipt.
   * Uses header+totals first; only retries a close header crop if the invoice number is missing.
   */
  async recognizeText(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<string> {
    this.progressListener = onProgress || null;
    onProgress?.({ status: 'جاري تجهيز صورة الفاتورة...', progress: 8 });

    const img = await loadImage(image);
    const worker = await this.getWorker();
    const mainPage = this.receiptCanvas(img);
    if (!mainPage) {
      throw new Error('تعذر تجهيز صورة الفاتورة');
    }

    this.recognizeFloor = 18;
    this.recognizeSpan = 55;
    onProgress?.({ status: 'جاري قراءة الفاتورة...', progress: 18 });
    const main = await worker.recognize(mainPage);
    let text = main.data?.text || '';
    let parsed = parseInvoiceText(text);

    if (!parsed.invoiceNumberTrusted) {
      const headerPage = this.headerCanvas(img);
      if (headerPage) {
        this.recognizeFloor = 72;
        this.recognizeSpan = 12;
        onProgress?.({ status: 'جاري توضيح رقم الفاتورة...', progress: 74 });
        text = `${text}\n${await this.recognizeWithMode(worker, headerPage, '4')}`;
        parsed = parseInvoiceText(text);
      }
    }

    if (parsed.amountSource !== 'paid' && parsed.amountSource !== 'net') {
      const totalsPage = this.totalsCanvas(img);
      if (totalsPage) {
        this.recognizeFloor = 86;
        this.recognizeSpan = 10;
        onProgress?.({ status: 'جاري توضيح المدفوع...', progress: 88 });
        text = `${text}\n${await this.recognizeWithMode(worker, totalsPage, '6')}`;
      }
    }

    return text;
  }

  private async recognizeWithMode(
    worker: TesseractWorker,
    page: HTMLCanvasElement,
    mode: string
  ): Promise<string> {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
    } catch {
      // optional
    }
    const { data } = await worker.recognize(page);
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
    } catch {
      // optional
    }
    return data?.text || '';
  }

  async analyzeInvoice(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<InvoiceAnalysis> {
    const text = await this.recognizeText(image, onProgress);
    onProgress?.({ status: 'جاري استخراج إجمالي الفاتورة...', progress: 95 });

    const analysis = parseInvoiceText(text);
    if (!analysis.invoiceTotal || analysis.invoiceTotal <= 0) {
      throw new Error('تعذر قراءة إجمالي الفاتورة. صوّرها مرة أخرى بوضوح مع ظهور الإجمالي.');
    }

    onProgress?.({ status: 'تم استخراج الإجمالي', progress: 100 });
    return analysis;
  }

  ngOnDestroy(): void {
    void this.terminateWorker();
  }

  private getWorker(): Promise<TesseractWorker> {
    if (this.worker) {
      return Promise.resolve(this.worker);
    }

    if (!this.workerPromise) {
      this.workerPromise = this.createWorker().catch((error) => {
        this.workerPromise = null;
        throw error;
      });
    }

    return this.workerPromise;
  }

  private async createWorker(): Promise<TesseractWorker> {
    const cores = [
      'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js',
      'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js'
    ];
    let lastError: unknown;

    for (const corePath of cores) {
      try {
        return await this.bootWorker(corePath);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('تعذر تحميل نموذج قراءة الفاتورة');
  }

  private async bootWorker(corePath: string): Promise<TesseractWorker> {
    const Tesseract = await this.loadTesseract();
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (message) => this.handleWorkerLog(message),
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath,
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      gzip: true
    });

    this.worker = worker;

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        classify_enable_learning: '0',
        user_defined_dpi: '220'
      });
    } catch {
      // Reading still works if the runtime rejects optional parameters.
    }

    return worker;
  }

  private handleWorkerLog(message: { status: string; progress: number }): void {
    if (!this.progressListener) {
      return;
    }

    if (message.status === 'recognizing text') {
      this.progressListener({
        status: 'جاري قراءة الفاتورة...',
        progress: Math.round(this.recognizeFloor + message.progress * this.recognizeSpan)
      });
      return;
    }

    if (message.status) {
      this.progressListener({
        status: 'جاري تجهيز القراءة...',
        progress: Math.min(20, Math.round((message.progress || 0) * 20))
      });
    }
  }

  private loadTesseract(): Promise<TesseractApi> {
    const existing = (window as unknown as { Tesseract?: TesseractApi }).Tesseract;
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => {
        const api = (window as unknown as { Tesseract?: TesseractApi }).Tesseract;
        if (!api) {
          reject(new Error('تعذر تحميل نموذج قراءة الفاتورة'));
          return;
        }
        resolve(api);
      };
      script.onerror = () => reject(new Error('تعذر تحميل نموذج قراءة الفاتورة'));
      document.body.appendChild(script);
    });
  }

  private async terminateWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.workerPromise = null;
    if (worker) {
      await worker.terminate();
    }
  }

  private receiptCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
    const tall = img.height > img.width * 1.25;
    const maxWidth = 1400;

    if (!tall) {
      return this.drawBand(img, 0, img.height, Math.min(1, maxWidth / img.width, 2000 / img.height));
    }

    // Skip the QR/footer at the very bottom; Paid/Net sit above it on Forto/Bubble paper.
    const topHeight = Math.round(img.height * 0.4);
    const totalsY = Math.round(img.height * 0.46);
    const totalsHeight = Math.round(img.height * 0.4);
    const gap = 20;
    const scale = Math.min(1, maxWidth / img.width);
    const width = Math.max(1, Math.round(img.width * scale));
    const topDraw = Math.max(1, Math.round(topHeight * scale));
    const totalsDraw = Math.max(1, Math.round(totalsHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = topDraw + gap + totalsDraw;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawEnhanced(ctx, img, 0, 0, img.width, topHeight, 0, 0, width, topDraw);
    this.drawEnhanced(
      ctx,
      img,
      0,
      totalsY,
      img.width,
      totalsHeight,
      0,
      topDraw + gap,
      width,
      totalsDraw
    );
    return canvas;
  }

  private headerCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
    const topHeight = Math.round(img.height * Math.min(0.5, img.height > img.width ? 0.45 : 0.55));
    const scale = Math.min(2, 1600 / img.width);
    return this.drawBand(img, 0, topHeight, scale);
  }

  private totalsCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
    const y = Math.round(img.height * 0.45);
    const height = Math.round(img.height * 0.42);
    const scale = Math.min(2, 1600 / img.width);
    return this.drawBand(img, y, height, scale);
  }

  private drawBand(
    img: HTMLImageElement,
    sy: number,
    sourceHeight: number,
    scale: number
  ): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      return null;
    }

    this.drawEnhanced(ctx, img, 0, sy, img.width, sourceHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  private drawEnhanced(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    ctx.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = 'none';
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
    img.src = source;
  });
}
