/**
 * The app's translation providers as MtProviders + the registry that selects between them (see docs/MT_ENGINE_PROVIDER_REGISTRY.md).
 *  - native   : the platform translator (Chrome Translator API / Apple Translation / ML Kit) – unchanged code, wrapped
 *  - local    : the downloaded OPUS-MT model (src/modules/mt/local) – opt-in, downloaded only after the user agrees
 *  - google   : the user's own Google Cloud key (BYOK) – goes through the quota guard, selected by the existing usage settings
 * Selection (registry.select) never sends text to a cloud provider unless the user selected it, and never falls back from a
 * local provider to a cloud one.
 */
import { send } from '@/shared/messages';
import { chromeLocal } from '@/storage/kv';
import { countChars } from '@/modules/usage/count';
import {
  EN_VI,
  LOCAL_MODEL_ID,
  LocalModelProvider,
  MtError,
  ProviderRegistry,
  VI_EN,
  modelForPair,
  pairKey,
  type Availability,
  type LanguagePair,
  type LocalBackend,
  type LocalModelSpec,
  type MtProvider,
  type Platform,
  type SelectionConfig,
  type TranslateRequest,
  type TranslateResponse,
} from '@/modules/mt';
import { PROVIDER_LIMITS, type ProviderId } from '@/modules/translation';
import { getTranslator, googleActive, nativeAvailability } from './chrome-mt';

const g = globalThis as { MangaLingoPlatform?: string; MangaLingoNative?: unknown };
export const currentPlatform = (): Platform => (g.MangaLingoPlatform === 'ios' ? 'ios' : g.MangaLingoNative ? 'android' : 'chrome');

const toAvail = (a: string): Availability => (a === 'available' || a === 'downloadable' || a === 'downloading' || a === 'unavailable' ? a : 'unsupported');

/** The platform's own translator (Chrome Translator API / Apple Translation / ML Kit), for both directions. */
export function nativeProvider(platform: Platform = currentPlatform()): MtProvider {
  const id = platform === 'ios' ? 'device-apple' : platform === 'android' ? 'device-mlkit' : 'device-chrome';
  const label = platform === 'ios' ? 'Apple Translation' : platform === 'android' ? 'ML Kit' : 'Chrome Translator';
  return {
    id,
    kind: 'native',
    label: `${label} (trên thiết bị)`,
    capabilities: {
      pairs: [EN_VI, VI_EN], // Apple: separate queue + session for vi→en (Translator.swift) – compiled only by CI, see docs/MT_ENGINE_TEST_REPORT.md
      platforms: [platform],
      local: true,
      metered: false,
      cancellable: false,
      streaming: false,
      needsDownload: true,
    },
    limits: { targetChars: PROVIDER_LIMITS[id as ProviderId].targetChars, maxChars: PROVIDER_LIMITS[id as ProviderId].maxChars },
    availability: async (pair) => toAvail(await nativeAvailability(pair)),
    translate: async (req: TranslateRequest): Promise<TranslateResponse> => {
      const t = await getTranslator(undefined, req.pair);
      return { text: await t.translate(req.text), providerId: id, pair: req.pair, chars: countChars(req.text) };
    },
  };
}

/** Google Cloud Translation with the user's own key. All requests go through the usage / cost guard in the router. */
export function googleProvider(): MtProvider {
  return {
    id: 'google-v2',
    kind: 'cloud-byok',
    label: 'Google Cloud Translation (khóa của bạn)',
    capabilities: { pairs: [EN_VI, VI_EN], platforms: ['chrome', 'android', 'ios'], local: false, metered: true, cancellable: false, streaming: false, needsDownload: false },
    limits: { targetChars: PROVIDER_LIMITS['google-v2'].targetChars, maxChars: PROVIDER_LIMITS['google-v2'].maxChars },
    availability: async () => ((await googleActive()) ? 'available' : 'unavailable'),
    translate: async (req) => {
      const r = await send({ type: 'usage:translate', text: req.text, idempotencyKey: req.idempotencyKey, keepBreaks: req.keepBreaks, ...(req.pair.source === 'vi' ? { languagePair: 'vi>en' } : {}) });
      if (r.source === 'google') return { text: r.text, providerId: 'google-v2', pair: req.pair, chars: r.chars };
      if (r.source === 'blocked') throw new MtError('blocked', r.decision.message, { providerId: 'google-v2', fatal: true, detail: r.decision });
      throw new MtError('unavailable', 'Google Cloud chưa được bật.', { providerId: 'google-v2' });
    },
  };
}

/** Reaches the model host (offscreen document in the extension, in-page worker in the phone apps) through the router. */
export const messageBackend: LocalBackend = {
  cached: (spec: LocalModelSpec) => send({ type: 'mtlocal:cached', modelId: spec.id }).catch(() => false),
  async prepare(spec, onProgress, signal) {
    let st = await send({ type: 'mtlocal:start', modelId: spec.id });
    while (st.state === 'downloading') {
      if (signal?.aborted) throw new MtError('aborted', 'Đã hủy.');
      onProgress?.(st.loaded, st.total);
      await new Promise((r) => setTimeout(r, 400));
      st = await send({ type: 'mtlocal:status', modelId: spec.id });
    }
    if (st.state === 'error') throw new MtError('provider-error', st.error ?? 'Tải mô hình thất bại.', { retryable: true });
    onProgress?.(st.total, st.total);
  },
  translate: (spec, text) => send({ type: 'mtlocal:translate', modelId: spec.id, text }),
  release: () => send({ type: 'mtlocal:release' }).then(() => undefined),
  cancel: (spec) => send({ type: 'mtlocal:cancel', modelId: spec.id }).then(() => undefined),
  verify: (spec) => send({ type: 'mtlocal:verify', modelId: spec.id }),
  remove: (spec) => send({ type: 'mtlocal:remove', modelId: spec.id }).then(() => undefined),
};

export const localProvider = new LocalModelProvider(messageBackend, () => typeof WebAssembly !== 'undefined');

let registry: ProviderRegistry | null = null;
/** Registry with every provider of this platform. Priority: native first (today's behaviour), then the downloaded model. */
export function getRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry().register(googleProvider(), 1).register(nativeProvider(), 10).register(localProvider, 20);
  }
  return registry;
}
export const resetRegistryForTests = () => (registry = null);

// ---- user preference: "use the downloaded model instead of the platform translator" (off by default; changing defaults needs the user)
const PREFS_KEY = 'mt.prefs';
export interface MtPrefs {
  /** 'auto' = platform translator first (default); 'local' = the downloaded model */
  preferred: 'auto' | 'local';
}
export async function getMtPrefs(): Promise<MtPrefs> {
  try {
    const p = await chromeLocal().get<MtPrefs>(PREFS_KEY);
    return { preferred: p?.preferred === 'local' ? 'local' : 'auto' };
  } catch {
    return { preferred: 'auto' };
  }
}
export async function setMtPrefs(p: MtPrefs): Promise<void> {
  await chromeLocal().set({ [PREFS_KEY]: p });
}

export async function localAvailability(pair?: LanguagePair): Promise<Availability> {
  const p = pair ?? EN_VI;
  if (!modelForPair(p) || !localProvider.capabilities.platforms.includes(currentPlatform())) return 'unsupported'; // iOS: not verified on a device → not offered
  return localProvider.availability(p);
}

export interface DeviceRoute {
  provider: MtProvider;
  /** the id used for chunk limits and the informational usage ledger */
  limitsId: ProviderId;
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** Which on-device provider translates `pair` right now (user choice, else the platform translator, else a downloaded model). */
export async function resolveDevice(pair: LanguagePair = EN_VI): Promise<DeviceRoute> {
  const prefs = await getMtPrefs();
  const cfg: SelectionConfig = { preferred: prefs.preferred === 'local' ? LOCAL_MODEL_ID : 'auto', platform: currentPlatform(), cloudReady: false };
  let sel;
  try {
    sel = await getRegistry().select(pair, cfg);
  } catch (e) {
    // the chosen model is not usable (e.g. not downloaded): explain, never switch silently
    if (prefs.preferred === 'local' && e instanceof MtError) throw e;
    throw e;
  }
  const p = sel.provider;
  const limitsId: ProviderId = p.id === LOCAL_MODEL_ID ? 'device-local' : (p.id as ProviderId);
  return {
    provider: p,
    limitsId,
    translate: async (text, o) => {
      const r = await getRegistry().translate({ text, pair, signal: o?.signal }, cfg);
      return r.text;
    },
  };
}

/** Label of the provider that will translate `pair` (shown next to the translation). */
export async function describeActive(pair: LanguagePair = EN_VI): Promise<{ id: string; label: string; local: boolean }> {
  if (await googleActive()) return { id: 'google-v2', label: googleProvider().label, local: false };
  try {
    const r = await resolveDevice(pair);
    return { id: r.provider.id, label: r.provider.label + (pair.source === 'vi' ? ' · Việt → Anh' : ''), local: true };
  } catch {
    return { id: 'none', label: `Chưa có bộ dịch cho ${pairKey(pair)}`, local: true };
  }
}
