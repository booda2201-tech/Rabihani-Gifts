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

  /** One fast OCR pass on header + totals. No second/third retries. */
  async recognizeText(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<string> {
    this.progressListener = onProgress || null;
    onProgress?.({ status: 'جاري تجهيز صورة الفاتورة...', progress: 10 });

    const [page, worker] = await Promise.all([
      this.preparePage(image),
      this.getWorker()
    ]);

    this.recognizeFloor = 20;
    this.recognizeSpan = 70;
    onProgress?.({ status: 'جاري قراءة الفاتورة...', progress: 20 });
    const { data } = await worker.recognize(page);
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

  private preparePage(image: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const page = this.receiptCanvas(img);
        if (!page) {
          reject(new Error('تعذر تجهيز صورة الفاتورة'));
          return;
        }
        resolve(page);
      };
      img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
      img.src = image;
    });
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
        user_defined_dpi: '180'
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
        progress: Math.min(18, Math.round((message.progress || 0) * 18))
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
    const maxWidth = 960;

    if (!tall) {
      return this.drawBand(img, 0, img.height, Math.min(1, maxWidth / img.width, 1400 / img.height));
    }

    // Header (number/date) + totals above the QR. One canvas = one OCR pass.
    const topHeight = Math.round(img.height * 0.36);
    const totalsY = Math.round(img.height * 0.48);
    const totalsHeight = Math.round(img.height * 0.34);
    const gap = 12;
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
    ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.06)';
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = 'none';
  }
}
