import {
  MtError,
  pairKey,
  type Availability,
  type LanguagePair,
  type MtProvider,
  type SelectionConfig,
  type TranslateRequest,
  type TranslateResponse,
} from './types';

export interface Candidate {
  provider: MtProvider;
  availability: Availability;
}

export interface Selection {
  provider: MtProvider;
  availability: Availability;
  /** why this one (shown to the user / logged) */
  reason: string;
  /** providers that may take over when this one reports `unavailable` – never a cloud provider after a local one */
  fallbacks: MtProvider[];
}

const supports = (p: MtProvider, pair: LanguagePair, platform: SelectionConfig['platform']) =>
  p.capabilities.platforms.includes(platform) && p.capabilities.pairs.some((x) => pairKey(x) === pairKey(pair));

/**
 * Registry of providers. Selection rules (all are privacy / cost rules, they are not optional):
 *  1. A request is only ever sent to a provider that supports the language pair on this platform.
 *  2. `preferred = <id>`: exactly that provider. If it is not usable the request FAILS (with the reason); nothing else is tried
 *     except a LOCAL provider as fallback when the chosen one is a cloud provider (text then stays on the device).
 *  3. `preferred = 'auto'`: local providers only (native, then downloaded models) by priority. A cloud / metered provider is never
 *     chosen automatically.
 *  4. A local provider never falls back to a cloud provider.
 *  5. A cloud-byok provider needs `cloudReady`; metered providers need the user to have selected them explicitly.
 */
export class ProviderRegistry {
  private providers = new Map<string, { p: MtProvider; priority: number }>();

  register(p: MtProvider, priority = 100): this {
    this.providers.set(p.id, { p, priority });
    return this;
  }
  unregister(id: string): void {
    this.providers.delete(id);
  }
  get(id: string): MtProvider | undefined {
    return this.providers.get(id)?.p;
  }
  list(): MtProvider[] {
    return [...this.providers.values()].sort((a, b) => a.priority - b.priority).map((x) => x.p);
  }
  /** providers that can translate this pair on this platform (discovery) */
  forPair(pair: LanguagePair, platform: SelectionConfig['platform']): MtProvider[] {
    return this.list().filter((p) => supports(p, pair, platform));
  }
  /** providers + their current availability, for the picker UI */
  async discover(pair: LanguagePair, platform: SelectionConfig['platform']): Promise<Candidate[]> {
    return Promise.all(
      this.forPair(pair, platform).map(async (provider) => ({ provider, availability: await provider.availability(pair).catch((): Availability => 'unavailable') })),
    );
  }

  async select(pair: LanguagePair, cfg: SelectionConfig): Promise<Selection> {
    const usable = (a: Availability) => a === 'available';
    const cands = await this.discover(pair, cfg.platform);
    const local = cands.filter((c) => c.provider.capabilities.local);

    if (cfg.preferred !== 'auto') {
      const chosen = this.get(cfg.preferred);
      if (!chosen) throw new MtError('no-provider', `Provider "${cfg.preferred}" không tồn tại.`);
      if (!supports(chosen, pair, cfg.platform)) throw new MtError('unsupported-pair', `${chosen.label} không hỗ trợ cặp ${pairKey(pair)} trên nền tảng này.`, { providerId: chosen.id });
      if (chosen.kind === 'cloud-byok' && !cfg.cloudReady) throw new MtError('unavailable', `${chosen.label}: chưa có khóa API hợp lệ.`, { providerId: chosen.id, fatal: true });
      if (chosen.capabilities.metered && !cfg.allowMetered && chosen.kind !== 'cloud-byok') throw new MtError('blocked', `${chosen.label} tính phí: cần được cho phép.`, { providerId: chosen.id, fatal: true });
      const c = cands.find((x) => x.provider.id === chosen.id)!;
      // fallback only to local providers, and only when the chosen one is cloud (local stays local)
      const fallbacks = chosen.capabilities.local ? [] : local.filter((x) => usable(x.availability)).map((x) => x.provider);
      return { provider: chosen, availability: c.availability, reason: 'người dùng chọn', fallbacks };
    }

    const ready = local.find((c) => usable(c.availability));
    if (ready) return { provider: ready.provider, availability: ready.availability, reason: 'tự động: provider trên thiết bị đầu tiên sẵn sàng', fallbacks: local.filter((c) => c !== ready && usable(c.availability)).map((c) => c.provider) };
    const needs = local.find((c) => c.availability === 'downloadable' || c.availability === 'downloading');
    if (needs) return { provider: needs.provider, availability: needs.availability, reason: 'tự động: cần tải mô hình trước khi dùng', fallbacks: [] };
    throw new MtError('no-provider', `Không có provider trên thiết bị nào dịch được ${pairKey(pair)} (không tự chuyển sang dịch vụ đám mây).`);
  }

  /** Select + translate with timeout, cancellation and the (restricted) fallback chain. */
  async translate(req: TranslateRequest, cfg: SelectionConfig): Promise<TranslateResponse> {
    const sel = await this.select(req.pair, cfg);
    // a model WE download needs the user's explicit agreement first; the platform translators manage their own downloads (Chrome asks inside a user gesture)
    if (sel.provider.kind === 'local-model' && (sel.availability === 'downloadable' || sel.availability === 'downloading')) {
      throw new MtError('needs-download', `${sel.provider.label} cần tải mô hình (${sel.provider.resources?.downloadBytes ?? '?'} byte) – cần người dùng đồng ý.`, { providerId: sel.provider.id });
    }
    const chain = [sel.provider, ...sel.fallbacks];
    let last: unknown;
    for (const p of chain) {
      try {
        if (p === sel.provider && (sel.availability === 'unavailable' || sel.availability === 'unsupported')) throw new MtError('unavailable', `${p.label} hiện không dùng được.`, { providerId: p.id });
        return await runWithLimits(p, req);
      } catch (e) {
        last = e;
        // only "this provider cannot serve it" moves on; blocked / aborted / timeout / fatal stop here
        if (!(e instanceof MtError) || e.code !== 'unavailable' || e.extra.fatal) throw e;
      }
    }
    throw last;
  }
}

async function runWithLimits(p: MtProvider, req: TranslateRequest): Promise<TranslateResponse> {
  if (req.signal?.aborted) throw new MtError('aborted', 'Đã hủy.', { providerId: p.id });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, rej) => {
    if (req.timeoutMs) timer = setTimeout(() => rej(new MtError('timeout', `${p.label}: quá thời gian chờ.`, { providerId: p.id, retryable: true })), req.timeoutMs);
    onAbort = () => rej(new MtError('aborted', 'Đã hủy.', { providerId: p.id }));
    req.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const out = await Promise.race([p.translate(req), guard]);
    return { ...out, providerId: p.id, modelId: p.modelId, pair: req.pair };
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) req.signal?.removeEventListener('abort', onAbort);
  }
}
