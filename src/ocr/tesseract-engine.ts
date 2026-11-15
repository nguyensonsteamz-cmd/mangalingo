/**
 * Tesseract.js wrapper running inside the offscreen document. All runtime files (worker, WASM core,
 * traineddata) are loaded from the extension package – nothing is downloaded at runtime.
 */
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { PSM } from './preprocess';

export interface EngineProgress {
  status: string;
  progress: number;
}

export class CancelledError extends Error {
  constructor() {
    super('Đã hủy OCR.');
    this.name = 'CancelledError';
  }
}

export interface EnginePaths {
  workerPath: string;
  corePath: string;
  langPath: string;
}

export class TesseractEngine {
  private worker: Worker | null = null;
  private workerLang = '';
  private starting: Promise<Worker> | null = null;
  private onProgress: ((p: EngineProgress) => void) | null = null;
  private cancelled = false;
  private rejectCurrent: ((e: Error) => void) | null = null;

  constructor(private paths: EnginePaths) {}

  /** Starts the worker (loads WASM + language data) ahead of the first scan. */
  async warm(lang: string): Promise<void> {
    await this.ensure(lang);
  }

  private async ensure(lang: string): Promise<Worker> {
    if (this.worker && this.workerLang === lang) return this.worker;
    if (this.starting && this.workerLang === lang) return this.starting;
    if (this.worker) await this.terminate();
    this.workerLang = lang;
    this.starting = createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: this.paths.workerPath,
      corePath: this.paths.corePath,
      langPath: this.paths.langPath,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => this.onProgress?.({ status: m.status, progress: m.progress ?? 0 }),
      errorHandler: (e: unknown) => console.warn('[MangaLingo OCR] worker error', e),
    }).then((w) => {
      this.worker = w;
      this.starting = null;
      return w;
    });
    try {
      return await this.starting;
    } catch (e) {
      this.starting = null;
      this.workerLang = '';
      throw e;
    }
  }

  async recognize(image: Blob, opts: { lang: string; layout: 'sparse' | 'auto' | 'block' }, onProgress: (p: EngineProgress) => void) {
    this.cancelled = false;
    this.onProgress = onProgress;
    const cancelGuard = new Promise<never>((_, reject) => (this.rejectCurrent = reject));
    try {
      const worker = await Promise.race([this.ensure(opts.lang), cancelGuard]);
      if (this.cancelled) throw new CancelledError();
      await worker.setParameters({
        tessedit_pageseg_mode: PSM[opts.layout] as never,
        preserve_interword_spaces: '1',
        // Screenshots / web images carry no DPI. Without this Tesseract estimates it and prints
        // "Estimating resolution as …" through console.warn – which Chrome lists under the
        // extension's "Errors" button on every scan.
        user_defined_dpi: '300',
      });
      const res = await Promise.race([worker.recognize(image, {}, { blocks: true, text: true }), cancelGuard]);
      if (this.cancelled) throw new CancelledError();
      return res.data;
    } finally {
      this.onProgress = null;
      this.rejectCurrent = null;
    }
  }

  /** Tesseract.js cannot abort a running job, so cancelling terminates the worker. */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.rejectCurrent?.(new CancelledError());
    await this.terminate();
  }

  async terminate(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.workerLang = '';
    this.starting = null;
    if (w) await w.terminate().catch(() => {});
  }
}
