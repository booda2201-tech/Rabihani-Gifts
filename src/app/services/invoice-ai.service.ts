import { Injectable, OnDestroy } from '@angular/core';
import { parseInvoiceText, type InvoiceParseResult } from './invoice-parser';

export interface InvoiceProgress {
  status: string;
  progress: number;
}

export type InvoiceAnalysis = InvoiceParseResult;

type TesseractWorker = {
  recognize(image: string): Promise<{ data: { text: string } }>;
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
    }
  ) => Promise<TesseractWorker>;
};

@Injectable({
  providedIn: 'root'
})
export class InvoiceAiService implements OnDestroy {
  private worker: TesseractWorker | null = null;

  async analyzeInvoice(
    image: string,
    onProgress?: (progress: InvoiceProgress) => void
  ): Promise<InvoiceAnalysis> {
    onProgress?.({ status: 'جاري تجهيز صورة الفاتورة...', progress: 5 });
    const processedImage = await this.prepareImage(image);

    onProgress?.({ status: 'جاري تحميل نموذج قراءة الفاتورة...', progress: 12 });
    const worker = await this.getWorker((message) => {
      if (message.status === 'recognizing text') {
        onProgress?.({
          status: 'جاري قراءة الفاتورة بالذكاء الاصطناعي...',
          progress: Math.round(20 + message.progress * 70)
        });
      } else if (message.status) {
        onProgress?.({
          status: 'جاري تحميل نموذج قراءة الفاتورة...',
          progress: Math.min(20, Math.round((message.progress || 0) * 20))
        });
      }
    });

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

  private async getWorker(
    logger: (message: { status: string; progress: number }) => void
  ): Promise<TesseractWorker> {
    if (this.worker) {
      return this.worker;
    }

    const Tesseract = await this.loadTesseract();
    this.worker = await Tesseract.createWorker('ara+eng', 1, {
      logger,
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0'
    });
    return this.worker;
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
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  private prepareImage(image: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1400;
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر تجهيز صورة الفاتورة'));
          return;
        }

        ctx.filter = 'grayscale(1) contrast(1.4) brightness(1.08)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error('تعذر فتح صورة الفاتورة'));
      img.src = image;
    });
  }
}
