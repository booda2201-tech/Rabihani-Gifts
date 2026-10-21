import { Injectable, OnDestroy } from '@angular/core';
import { parseInvoiceText, type InvoiceParseResult } from './invoice-parser';

export interface InvoiceProgress {
  status: string;
  progress: number;
}

export type InvoiceAnalysis = InvoiceParseResult;

type TesseractWorker = {
  recognize(image: string): Promise<{ data: { text: string } }>;
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

  warmup(): void {
    void this.getWorker().catch(() => undefined);
  }

  async analyzeInvoice(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<InvoiceAnalysis> {
    this.progressListener = onProgress || null;
    onProgress?.({ status: 'جاري تجهيز صورة الفاتورة...', progress: 8 });
    const processedImage = await this.prepareImage(image);

    onProgress?.({ status: 'جاري قراءة الفاتورة...', progress: 18 });
    const worker = await this.getWorker();

    const { data } = await worker.recognize(processedImage);
    onProgress?.({ status: 'جاري استخراج إجمالي الفاتورة...', progress: 95 });

    const analysis = parseInvoiceText(data?.text || '');
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
    const worker = await Tesseract.createWorker('ara+eng', 1, {
      logger: (message) => this.handleWorkerLog(message),
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath,
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
      gzip: true
    });

    this.worker = worker;

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '4',
        classify_enable_learning: '0',
        user_defined_dpi: '300'
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
        progress: Math.round(20 + message.progress * 70)
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

  private prepareImage(image: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1100;
        const maxHeight = 1500;
        const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر تجهيز صورة الفاتورة'));
          return;
        }

        ctx.filter = 'grayscale(1) contrast(1.35)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
      img.src = image;
    });
  }
}
