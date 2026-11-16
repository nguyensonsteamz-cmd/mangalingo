/**
 * Client of the model worker. Runs in whatever context can spawn a Worker (the extension's offscreen document, or the mobile app
 * page). Everything is local: the only network access is the user-approved one-time model download.
 * Lifecycle hardening: free-space check before a download, SHA-256 + size verification after it (a corrupt download is deleted),
 * cancel, removal of stale revisions, and recovery when a cached model fails to load.
 */
import { MtError } from '../types';
import type { LocalModelSpec } from './models';

export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: any }) => void) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  onerror: ((e: unknown) => void) | null;
}

export type Integrity = 'ok' | 'missing' | 'corrupt';

/** What the provider needs from a place that can run the model (in this context, or reached by messages). */
export interface LocalBackend {
  /** is the model already on this device (no download needed)? quick: presence + size */
  cached(spec: LocalModelSpec): Promise<boolean>;
  /** downloads (after the user agreed) and loads the model; verifies it */
  prepare(spec: LocalModelSpec, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void>;
  translate(spec: LocalModelSpec, text: string, signal?: AbortSignal): Promise<string>;
  /** frees the model's memory */
  release?(): Promise<void>;
  /** deletes the downloaded files of this model from the device */
  remove?(spec: LocalModelSpec): Promise<void>;
  /** stops a download in progress (partial data is never kept) */
  cancel?(spec: LocalModelSpec): Promise<void>;
  /** full check: every file present, right size, SHA-256 equals the published one */
  verify?(spec: LocalModelSpec): Promise<Integrity>;
}

interface Pending {
  resolve(v: { text?: string }): void;
  reject(e: Error): void;
  onProgress?: (loaded: number, total: number) => void;
}

const CACHE_NAME = 'transformers-cache';
const FREE_SPACE_FACTOR = 2; // the download is cached, then loaded: ask for 2× its size

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export class LocalMtEngine implements LocalBackend {
  private worker: WorkerLike | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private preparing = new Map<string, Promise<void>>();

  constructor(
    private makeWorker: () => WorkerLike,
    /** URL (directory, trailing slash) that serves ort-wasm-simd-threaded.{mjs,wasm} */
    private wasmBase: string,
    private cacheStorage: CacheStorage | undefined = globalThis.caches,
    private estimate: () => Promise<{ quota?: number; usage?: number } | undefined> = async () => globalThis.navigator?.storage?.estimate?.(),
    private digest: (b: ArrayBuffer) => Promise<ArrayBuffer> = (b) => crypto.subtle.digest('SHA-256', b),
  ) {}

  private call(msg: Record<string, unknown>, onProgress?: Pending['onProgress']): { id: number; p: Promise<{ text?: string }> } {
    const id = ++this.seq;
    const p = new Promise<{ text?: string }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker!.postMessage({ ...msg, id });
    });
    return { id, p };
  }

  private spawn(): Promise<void> {
    if (this.ready) return this.ready;
    const w = this.makeWorker();
    this.worker = w;
    w.onmessage = (e) => {
      const m = e.data as { id: number; type: string; text?: string; message?: string; code?: string; loaded?: number; total?: number };
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress?.(m.loaded ?? 0, m.total ?? 0);
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new MtError(m.code === 'aborted' ? 'aborted' : 'provider-error', m.message ?? 'Mô hình dịch lỗi.', { retryable: m.code !== 'aborted', detail: m.code }));
      else p.resolve({ text: m.text });
    };
    w.onerror = () => {
      for (const p of this.pending.values()) p.reject(new MtError('unavailable', 'Không chạy được mô hình dịch trên thiết bị này.'));
      this.pending.clear();
      this.worker = null;
      this.ready = null;
    };
    this.ready = this.call({ op: 'init', wasmBase: this.wasmBase }).p.then(() => undefined);
    return this.ready;
  }

  private async cache(): Promise<Cache | undefined> {
    return this.cacheStorage?.open(CACHE_NAME);
  }

  private urlOf(spec: LocalModelSpec, path: string, revision = spec.revision) {
    return `/${spec.repo}/resolve/${revision}/${path}`;
  }

  /** cache entry of one model file (matched by path, the host part of the URL is Hugging Face's) */
  private async entry(c: Cache, spec: LocalModelSpec, path: string): Promise<Response | undefined> {
    for (const r of await c.keys()) if (r.url.includes(this.urlOf(spec, path))) return c.match(r);
    return undefined;
  }

  async cached(spec: LocalModelSpec): Promise<boolean> {
    try {
      const c = await this.cache();
      if (!c) return false;
      for (const f of spec.files) {
        const r = await this.entry(c, spec, f.path);
        if (!r || (await r.clone().blob()).size !== f.bytes) return false; // missing or truncated
      }
      return true;
    } catch {
      return false;
    }
  }

  async verify(spec: LocalModelSpec): Promise<Integrity> {
    const c = await this.cache();
    if (!c) return 'missing';
    for (const f of spec.files) {
      const r = await this.entry(c, spec, f.path);
      if (!r) return 'missing';
      const buf = await r.clone().arrayBuffer();
      if (buf.byteLength !== f.bytes || hex(await this.digest(buf)) !== f.sha256) return 'corrupt';
    }
    return 'ok';
  }

  private async dropStale(spec: LocalModelSpec) {
    const c = await this.cache();
    if (!c) return;
    for (const r of await c.keys()) if (r.url.includes(`/${spec.repo}/resolve/`) && !r.url.includes(`/resolve/${spec.revision}/`)) await c.delete(r); // an older pinned revision
  }

  async prepare(spec: LocalModelSpec, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    // one download per model at a time: a second call joins the first
    const running = this.preparing.get(spec.id);
    if (running) return running;
    const job = this.doPrepare(spec, onProgress, signal).finally(() => this.preparing.delete(spec.id));
    this.preparing.set(spec.id, job);
    return job;
  }

  private async doPrepare(spec: LocalModelSpec, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new MtError('aborted', 'Đã hủy.');
    const already = await this.cached(spec);
    if (!already) {
      const est = await this.estimate().catch(() => undefined);
      if (est?.quota != null && est.usage != null && est.quota - est.usage < spec.downloadBytes * FREE_SPACE_FACTOR) {
        throw new MtError('unavailable', `Không đủ dung lượng trống để tải mô hình (cần khoảng ${Math.round((spec.downloadBytes * FREE_SPACE_FACTOR) / 2 ** 20)} MB).`, { retryable: false, fatal: true, detail: 'low-storage' });
      }
    }
    await this.dropStale(spec);
    await this.spawn();
    try {
      const { p } = this.call({ op: 'prepare', model: spec }, onProgress);
      await this.race(p, signal);
    } catch (e) {
      if (e instanceof MtError && e.code === 'aborted') {
        await this.release(); // stop the download in flight
        throw e;
      }
      if (/quota|storage/i.test(String((e as Error)?.message))) throw new MtError('unavailable', 'Bộ nhớ trống không đủ để lưu mô hình.', { fatal: true, detail: 'low-storage' });
      if (!navigator.onLine) throw new MtError('unavailable', 'Đang ngoại tuyến: cần kết nối mạng để tải mô hình (một lần).', { retryable: true, detail: 'offline' });
      throw e;
    }
    if ((await this.verify(spec)) !== 'ok') {
      await this.remove(spec); // never keep a file that does not match the published hash
      throw new MtError('provider-error', 'Tệp mô hình tải về bị hỏng (sai SHA-256). Đã xoá, hãy tải lại.', { retryable: true, detail: 'corrupt' });
    }
  }

  async translate(spec: LocalModelSpec, text: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new MtError('aborted', 'Đã hủy.');
    await this.spawn();
    const { id, p } = this.call({ op: 'translate', model: spec, text });
    try {
      const out = await this.race(p, signal, () => this.worker?.postMessage({ op: 'cancel', id: ++this.seq, target: id }));
      return out.text ?? '';
    } catch (e) {
      // a cached model that fails to LOAD is damaged: delete it so the user can download it again (never loops on a broken file)
      if (e instanceof MtError && e.extra.detail === 'load-failed') {
        // only if the files really do not match the published hashes; a load failure with intact files (e.g. out of memory) keeps them
        if ((await this.verify(spec).catch(() => 'corrupt' as Integrity)) === 'ok') throw new MtError('provider-error', 'Không nạp được mô hình (có thể thiếu bộ nhớ). Tệp mô hình vẫn nguyên vẹn.', { retryable: true, detail: 'load-failed-intact' });
        await this.remove(spec);
        throw new MtError('needs-download', 'Mô hình trên máy bị hỏng nên đã được xoá. Hãy tải lại.', { retryable: false, detail: 'corrupt' });
      }
      throw e;
    }
  }

  async cancel(spec: LocalModelSpec): Promise<void> {
    if (!this.preparing.has(spec.id)) return;
    await this.release(); // terminating the worker aborts its fetches; partial files are not cached by the loader
    await this.remove(spec).catch(() => {});
  }

  async remove(spec: LocalModelSpec): Promise<void> {
    await this.release(); // the worker holds the model: drop it first
    const c = await this.cache();
    if (!c) return;
    for (const r of await c.keys()) if (r.url.includes(`/${spec.repo}/resolve/`)) await c.delete(r);
  }

  async release(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new MtError('aborted', 'Đã giải phóng mô hình.'));
    this.pending.clear();
  }

  private race<T>(p: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
    if (!signal) return p;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        onAbort?.();
        reject(new MtError('aborted', 'Đã hủy.'));
      };
      signal.addEventListener('abort', abort, { once: true });
      p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
