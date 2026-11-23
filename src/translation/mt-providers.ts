/**
 * The app's translation providers as MtProviders + the registry that selects between them (see docs/MT_ENGINE_PROVIDER_REGISTRY.md).
 *  - native   : the platform translator (Chrome Translator API / Apple Translation / ML Kit) – unchanged code, wrapped
 *  - google-web : Google Translate (web, unofficial, no key) – only when the user selected it in the settings
 * Selection (registry.select) never sends text to a cloud provider unless the user selected it, and never falls back from a
 * local provider to a cloud one.
 */
import { send } from '@/shared/messages';
import { countChars } from '@/modules/usage/count';
import {
  EN_VI,
  MtError,
  ProviderRegistry,
  VI_EN,
  pairKey,
  type Availability,
  type LanguagePair,
  type MtProvider,
  type Platform,
  type SelectionConfig,
  type TranslateRequest,
  type TranslateResponse,
} from '@/modules/mt';
import { PROVIDER_LIMITS, type ProviderId } from '@/modules/translation';
import { getTranslator, googleMode, nativeAvailability } from './chrome-mt';

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

/**
 * Google Translate web (UNOFFICIAL): no API key, no Google Cloud project, no billing. Text is sent from the device straight to
 * Google; Google can block or change it at any time (errors: see src/modules/usage/google-web.ts). Opt-in: used only when the user
 * selected it in the settings.
 */
export function googleWebProvider(): MtProvider {
  return {
    id: 'google-web',
    kind: 'cloud-web',
    label: PROVIDER_LIMITS['google-web'].label,
    capabilities: { pairs: [EN_VI, VI_EN], platforms: ['chrome', 'android', 'ios'], local: false, metered: false, cancellable: false, streaming: false, needsDownload: false },
    limits: { targetChars: PROVIDER_LIMITS['google-web'].targetChars, maxChars: PROVIDER_LIMITS['google-web'].maxChars },
    availability: async () => (((await googleMode()) === 'google-web' ? 'available' : 'unavailable') as Availability),
    translate: async (req) => {
      const r = await send({ type: 'usage:translate', text: req.text, idempotencyKey: req.idempotencyKey, keepBreaks: req.keepBreaks, ...(req.pair.source === 'vi' ? { languagePair: 'vi>en' } : {}) });
      if (r.source === 'google') return { text: r.text, providerId: 'google-web', pair: req.pair, chars: r.chars };
      throw new MtError('unavailable', 'Google Dịch (web) chưa được bật.', { providerId: 'google-web' });
    },
  };
}

let registry: ProviderRegistry | null = null;
/** Registry with every provider of this platform. Selection never sends text to a cloud provider unless the user chose it. */
export function getRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry().register(googleWebProvider(), 2).register(nativeProvider(), 10);
  }
  return registry;
}
export const resetRegistryForTests = () => (registry = null);

export interface DeviceRoute {
  provider: MtProvider;
  /** the id used for chunk limits and the informational usage ledger */
  limitsId: ProviderId;
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** Which on-device provider translates the pair right now: the platform translator (Chrome Translator / Apple Translation / ML Kit). */
export async function resolveDevice(pair: LanguagePair = EN_VI): Promise<DeviceRoute> {
  const cfg: SelectionConfig = { preferred: 'auto', platform: currentPlatform(), cloudReady: false };
  const sel = await getRegistry().select(pair, cfg);
  const p = sel.provider;
  return {
    provider: p,
    limitsId: p.id as ProviderId,
    translate: async (text, o) => {
      const r = await getRegistry().translate({ text, pair, signal: o?.signal }, cfg);
      return r.text;
    },
  };
}

/** Label of the provider that will translate `pair` (shown next to the translation). */
export async function describeActive(pair: LanguagePair = EN_VI): Promise<{ id: string; label: string; local: boolean }> {
  const mode = await googleMode();
  if (mode === 'google-web') return { id: 'google-web', label: googleWebProvider().label, local: false };
  try {
    const r = await resolveDevice(pair);
    return { id: r.provider.id, label: r.provider.label + (pair.source === 'vi' ? ' · Việt → Anh' : ''), local: true };
  } catch {
    return { id: 'none', label: `Chưa có bộ dịch cho ${pairKey(pair)}`, local: true };
  }
}
