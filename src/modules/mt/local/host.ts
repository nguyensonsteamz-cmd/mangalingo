import { MtError } from '../types';
import type { Integrity, LocalBackend } from './engine';
import { LOCAL_MODELS, type LocalModelSpec } from './models';

export interface LocalStatus {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  loaded: number;
  total: number;
  error?: string;
}

/** The model operations addressable by message (service worker router / offscreen document / mobile in-page router). */
export interface LocalHost {
  cached(modelId: string): Promise<boolean>;
  /** starts the (user-approved) download and returns at once; poll `status` */
  start(modelId: string): Promise<LocalStatus>;
  status(modelId: string): Promise<LocalStatus>;
  translate(modelId: string, text: string): Promise<string>;
  release(): Promise<void>;
  /** deletes the downloaded model files */
  remove(modelId: string): Promise<void>;
  /** stops a download in progress */
  cancel(modelId: string): Promise<LocalStatus>;
  /** SHA-256 + size check of the files on the device */
  verify(modelId: string): Promise<Integrity>;
}

const spec = (id: string): LocalModelSpec => {
  const m = LOCAL_MODELS.find((x) => x.id === id);
  if (!m) throw new MtError('unsupported-pair', `Mô hình không tồn tại: ${id}`);
  return m;
};

/** Runs a LocalBackend behind the message-friendly LocalHost API (download tracked as a status, not a long-lived call). */
export class LocalModelHost implements LocalHost {
  private st = new Map<string, LocalStatus>();
  constructor(private backend: LocalBackend) {}

  cached(modelId: string) {
    return this.backend.cached(spec(modelId));
  }

  async status(modelId: string): Promise<LocalStatus> {
    const s = this.st.get(modelId);
    if (s) return s;
    return { state: (await this.cached(modelId)) ? 'ready' : 'idle', loaded: 0, total: spec(modelId).downloadBytes };
  }

  async start(modelId: string): Promise<LocalStatus> {
    const m = spec(modelId);
    const cur = this.st.get(modelId);
    if (cur?.state === 'downloading') return cur;
    const s: LocalStatus = { state: 'downloading', loaded: 0, total: m.downloadBytes };
    this.st.set(modelId, s);
    this.backend
      .prepare(m, (loaded, total) => {
        s.loaded = loaded;
        if (total) s.total = total;
      })
      .then(
        () => this.st.set(modelId, { state: 'ready', loaded: s.total, total: s.total }),
        (e: Error) => {
          // a cancelled download is not an error
          if (this.st.get(modelId) !== s) return;
          this.st.set(modelId, e instanceof MtError && e.code === 'aborted' ? { state: 'idle', loaded: 0, total: s.total } : { state: 'error', loaded: s.loaded, total: s.total, error: e.message });
        },
      );
    return s;
  }

  translate(modelId: string, text: string) {
    return this.backend.translate(spec(modelId), text);
  }

  async remove(modelId: string) {
    await this.backend.remove?.(spec(modelId));
    this.st.delete(modelId);
  }

  async cancel(modelId: string): Promise<LocalStatus> {
    await this.backend.cancel?.(spec(modelId));
    const s: LocalStatus = { state: 'idle', loaded: 0, total: spec(modelId).downloadBytes };
    this.st.set(modelId, s);
    return s;
  }

  async verify(modelId: string): Promise<Integrity> {
    return this.backend.verify ? this.backend.verify(spec(modelId)) : ((await this.cached(modelId)) ? 'ok' : 'missing');
  }

  async release() {
    await this.backend.release?.();
    this.st.clear();
  }
}
