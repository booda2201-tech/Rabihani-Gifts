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

  async analyzeInvoice(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<InvoiceAnalysis> {
    this.progressListener = onProgress || null;
    onProgress?.({ status: 'جاري تجهيز صورة الفاتورة...', progress: 8 });
    const pages = await this.preparePages(image);
    const worker = await this.getWorker();
    let text = '';

    for (let index = 0; index < pages.length; index += 1) {
      this.recognizeFloor = 18 + (index / pages.length) * 72;
      this.recognizeSpan = 72 / pages.length;
      onProgress?.({ status: 'جاري قراءة الفاتورة...', progress: Math.round(this.recognizeFloor) });
      const { data } = await worker.recognize(pages[index]);
      text += `\n${data?.text || ''}`;
    }

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
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
      gzip: true
    });

    this.worker = worker;

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        classify_enable_learning: '0',
        load_system_dawg: '0',
        load_freq_dawg: '0',
        user_defined_dpi: '170'
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

  private preparePages(image: string): Promise<HTMLCanvasElement[]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 860;
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('تعذر تجهيز صورة الفاتورة'));
          return;
        }

        ctx.filter = 'grayscale(1) contrast(1.45)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const paper = cropToPaper(canvas);
        resolve(paper.height > 1280 ? [slice(paper, 0, 420), slice(paper, paper.height - 620, 620)] : [paper]);
      };
      img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
      img.src = image;
    });
  }
}

function cropToPaper(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return source;
  }

  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const step = 4;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4] < 165) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (boxWidth < width * 0.4 || boxHeight < height * 0.3) {
    return source;
  }

  const pad = 10;
  return slice(
    source,
    Math.max(0, minY - pad),
    Math.min(height, maxY + pad) - Math.max(0, minY - pad),
    Math.max(0, minX - pad),
    Math.min(width, maxX + pad) - Math.max(0, minX - pad)
  );
}

function slice(source: HTMLCanvasElement, y: number, height: number, x = 0, width = source.width): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return source;
  }

  ctx.drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
