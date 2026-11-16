import { mergeChunks, splitIntoChunks } from '@/modules/translation/chunker';
import { countChars } from '@/modules/usage/count';
import { EN_VI, MtError, VI_EN, pairKey, type Availability, type LanguagePair, type MtProvider, type TranslateRequest, type TranslateResponse } from '../types';
import type { LocalBackend } from './engine';
import { LOCAL_MODELS, LOCAL_MODEL_ID, modelForPair } from './models';

/**
 * The downloaded local model (OPUS-MT, ONNX Runtime) as an MtProvider. Text never leaves the device; the only network
 * access is the one-time model download that `prepare()` performs after the user agreed.
 * The model takes ≤ 512 tokens per call, so each chunk the runner hands over is split again into sentences (≤ model.maxChars)
 * and translated one by one: cancellation is checked between sentences and progress is reported.
 */
export class LocalModelProvider implements MtProvider {
  readonly id = LOCAL_MODEL_ID;
  readonly kind = 'local-model' as const;
  readonly label = 'Mô hình dịch tải về (OPUS-MT)';
  readonly modelId = 'Xenova/opus-mt-{en-vi,vi-en}@q8';
  readonly capabilities = {
    pairs: [EN_VI, VI_EN],
    // iOS is excluded until proven on a real iPhone: the app page is served from a custom URL scheme (app://), where the Cache API and
    // module workers are not guaranteed. See docs/MT_ENGINE_DEPLOYMENT.md.
    platforms: ['chrome', 'android'] as ('chrome' | 'android' | 'ios')[],
    local: true,
    metered: false,
    cancellable: true,
    streaming: false,
    needsDownload: true,
  };
  readonly resources = { downloadBytes: LOCAL_MODELS[0].downloadBytes, diskBytes: LOCAL_MODELS[0].downloadBytes, peakRamBytes: LOCAL_MODELS[0].peakRamBytes };
  /** characters per chunk handed to this provider: small, so a cancel / progress step happens every few seconds */
  readonly limits = { targetChars: 800, maxChars: 900, maxTokens: 512 };

  constructor(
    private backend: LocalBackend,
    /** can this context run WebAssembly workers at all? (false → provider reports 'unavailable') */
    private supported: () => boolean = () => typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined',
  ) {}

  async availability(pair: LanguagePair): Promise<Availability> {
    const m = modelForPair(pair);
    if (!m) return 'unsupported';
    if (!this.supported()) return 'unavailable';
    return (await this.backend.cached(m)) ? 'available' : 'downloadable';
  }

  async prepare(pair: LanguagePair, onProgress?: (fraction: number) => void): Promise<void> {
    const m = modelForPair(pair);
    if (!m) throw new MtError('unsupported-pair', `Mô hình không hỗ trợ ${pairKey(pair)}.`, { providerId: this.id });
    await this.backend.prepare(m, (loaded, total) => onProgress?.(total ? loaded / total : 0));
    onProgress?.(1);
  }

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    const m = modelForPair(req.pair);
    if (!m) throw new MtError('unsupported-pair', `Mô hình không hỗ trợ ${pairKey(req.pair)}.`, { providerId: this.id });
    if (!this.supported()) throw new MtError('unavailable', 'Thiết bị này không chạy được mô hình dịch (thiếu WebAssembly / Worker).', { providerId: this.id });
    if (!(await this.backend.cached(m))) throw new MtError('needs-download', `Cần tải mô hình ${m.label} (${Math.round(m.downloadBytes / 2 ** 20)} MB) trước.`, { providerId: this.id });
    const parts = splitIntoChunks(req.text, { target: 400, max: m.maxChars });
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (req.signal?.aborted) throw new MtError('aborted', 'Đã hủy.', { providerId: this.id });
      // a sentence of only symbols / digits is returned as is (the model can hallucinate on it)
      out.push(/[\p{L}]/u.test(parts[i].source) ? (await this.backend.translate(m, parts[i].source, req.signal)).trim() : parts[i].source);
      req.onProgress?.((i + 1) / parts.length);
    }
    return { text: mergeChunks(parts, out), providerId: this.id, modelId: m.upstream.repo, pair: req.pair, chars: countChars(req.text) };
  }

  async dispose(): Promise<void> {
    await this.backend.release?.();
  }
}
