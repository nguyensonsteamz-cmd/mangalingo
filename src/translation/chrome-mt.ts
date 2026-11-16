/**
 * Optional machine translation through Chrome's built-in Translator API (Chrome 138+).
 * Translation runs on-device: Chrome downloads the EN→VI language model from Google once (only
 * after an explicit user click), then text is translated locally and never sent anywhere.
 * Off by default (Settings → Hành vi đọc → Bản dịch máy).
 */

import { send } from '@/shared/messages';
import { countChars } from '@/modules/usage/count';
import type { JobResult } from '@/modules/translation';
import { DEFAULT_TARGET } from '@/modules/translation';
import { translateLongText, type LongTextDeps, type LongTextOptions } from './long-text';
import type { BlockedDecision } from '@/modules/usage/types';
import { EN_VI, type LanguagePair } from '@/modules/mt';
import { localAvailability, resolveDevice, describeActive } from './mt-providers';

/** A translation the quota guard did not let through (needs the user's consent, or a limit was reached). */
export class UsageBlockedError extends Error {
  constructor(public decision: BlockedDecision) {
    super(decision.message);
    this.name = 'UsageBlockedError';
  }
}

let googleOn: { t: number; on: boolean } | null = null;
/** Is the optional Google Cloud provider selected (and has a key)? Cached briefly; asked from the background / in-app router. */
export async function googleActive(): Promise<boolean> {
  if (googleOn && Date.now() - googleOn.t < 2000) return googleOn.on;
  const on = await send({ type: 'usage:snapshot' }).then(
    (s) => s.settings.provider === 'google' && s.hasKey,
    () => false,
  );
  googleOn = { t: Date.now(), on };
  return on;
}
export function invalidateGoogleActive() {
  googleOn = null;
}

export type MtAvailability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface ChromeTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: DownloadMonitor) => void }): Promise<ChromeTranslator>;
}

const PAIR = { sourceLanguage: 'en', targetLanguage: 'vi' } as const;
const VI_EN_API = { sourceLanguage: 'vi', targetLanguage: 'en' } as const;
/** Translator-API options for a pair (default en→vi, the original behaviour). */
const apiPair = (p?: LanguagePair) => (p?.source === 'vi' && p?.target === 'en' ? VI_EN_API : PAIR);
const api = (): TranslatorStatic | undefined => (globalThis as { Translator?: TranslatorStatic }).Translator;

/** The platform's own translator (Chrome Translator / Apple Translation / ML Kit) for a pair: never the Google provider. */
export async function nativeAvailability(pair?: LanguagePair): Promise<MtAvailability> {
  const T = api();
  if (!T) return 'unsupported';
  try {
    const a = await T.availability(apiPair(pair));
    return a === 'available' || a === 'downloadable' || a === 'downloading' ? a : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** What the UI asks: Google Cloud needs nothing to download; otherwise the platform translator, or (when it cannot do the pair) the downloaded local model. */
export async function mtAvailability(pair?: LanguagePair): Promise<MtAvailability> {
  if (await googleActive()) return 'available';
  const native = await nativeAvailability(pair);
  if (native === 'available' || native === 'downloading') return native;
  const local = await localAvailability(pair);
  if (local === 'available') return 'available';
  // 'downloadable' of the native translator wins (it is the default); the local model is offered separately (see MachineTranslation)
  return native;
}

const instances = new Map<string, Promise<ChromeTranslator>>();
let markReady: () => void;
const ready = new Promise<void>((r) => (markReady = r));

/** Resolves once a translator exists (the model is on the machine). Never starts a download. */
export function translatorReady(): Promise<void> {
  return ready;
}
const progressListeners = new Set<(p: number) => void>();

/**
 * Creates (once) the translator. When the model still has to be downloaded Chrome requires this to
 * be called from a user gesture (a click on "Tải mô hình").
 */
export function getTranslator(onProgress?: (loaded: number) => void, pair?: LanguagePair): Promise<ChromeTranslator> {
  if (onProgress) progressListeners.add(onProgress);
  const T = api();
  if (!T) return Promise.reject(new Error('Chrome này không có Translator API (cần Chrome 138 trở lên).'));
  const o = apiPair(pair);
  const k = `${o.sourceLanguage}>${o.targetLanguage}`;
  let p = instances.get(k);
  if (!p) {
    p = T.create({
      ...o,
      monitor: (m) => m.addEventListener('downloadprogress', (e) => progressListeners.forEach((l) => l(e.loaded))),
    }).then((t) => {
      markReady();
      return t;
    }).catch((e: Error) => {
      instances.delete(k);
      throw e;
    });
    instances.set(k, p);
  }
  return p;
}

/** Prepares OCR/bubble text: re-joins words hyphenated across lines and collapses whitespace. */
export function prepareForMt(text: string): string {
  return text.replace(/([A-Za-z])-\s+([a-z])/gi, '$1$2').replace(/\s+/g, ' ').trim();
}

const cache = new Map<string, Promise<string>>();

const isViEn = (p?: LanguagePair) => p?.source === 'vi' && p?.target === 'en';

/** Google Cloud (through the quota guard) when selected, otherwise the on-device translator. */
async function translateRouted(src: string, pair?: LanguagePair): Promise<string> {
  if (await googleActive()) {
    const r = await send({ type: 'usage:translate', text: src, ...(isViEn(pair) ? { languagePair: 'vi>en' } : {}) });
    if (r.source === 'google') return r.text;
    if (r.source === 'blocked') throw new UsageBlockedError(r.decision);
    // 'device': fall through to the on-device translator
  }
  return (await resolveDevice(pair ?? EN_VI)).translate(src);
}

/** Some of the chunks of a long text could not be translated (the merged text, with the failed parts left as the original, is in `result`). */
export class PartialTranslationError extends Error {
  constructor(public result: JobResult) {
    super(`Chưa dịch được ${result.failedIndexes.length}/${result.chunks.length} phần của văn bản.`);
    this.name = 'PartialTranslationError';
  }
}

const onDeviceProvider = () => {
  const g = globalThis as { MangaLingoPlatform?: string; MangaLingoNative?: unknown };
  return g.MangaLingoPlatform === 'ios' ? ('device-apple' as const) : g.MangaLingoNative ? ('device-mlkit' as const) : ('device-chrome' as const);
};

/** The two providers of the app for the chunked runner (see long-text.ts). */
function longDeps(pair?: LanguagePair): LongTextDeps {
  return {
    googleActive,
    sendGoogle: (text, o) => send({ type: 'usage:translate', text, idempotencyKey: o.idempotencyKey, keepBreaks: o.keepBreaks, ...(isViEn(pair) ? { languagePair: 'vi>en' } : {}) }),
    deviceTranslate: async (text) => (await getTranslator(undefined, pair)).translate(text),
    resolveDevice: async () => {
      const r = await resolveDevice(pair ?? EN_VI);
      return { provider: r.limitsId, translate: r.translate };
    },
    deviceProvider: onDeviceProvider(),
    reportDevice: (provider, chars, idempotencyKey) => send({ type: 'usage:device-processed', provider, chars, idempotencyKey }).catch(() => {}),
    completeOperation: (jobId) => send({ type: 'usage:operation', jobId }).catch(() => {}),
  };
}

/** Re-joins words hyphenated across lines; everything else (line breaks, paragraphs) is kept for the chunker. */
const prepareLong = (text: string) => text.replace(/([A-Za-z])-\s+([a-z])/g, '$1$2');

/**
 * Translates text of ANY length: split into ~4,800-character chunks at sentence / paragraph boundaries, translated in order with
 * per-chunk retries, progress, cancellation and ordered merge. Never cuts text silently. Each chunk goes through the quota guard
 * (Google) or the on-device translator.
 */
export function machineTranslateLong(text: string, o: LongTextOptions = {}): Promise<JobResult> {
  return translateLongText(prepareLong(text), longDeps(o.pair), o);
}

/** True when the text needs more than one request (the UI then shows progress / cancel). */
export const needsChunking = (text: string) => countChars(prepareForMt(text)) > DEFAULT_TARGET;

/**
 * Translates EN→VI: short text in one request, long text through the chunked runner (no truncation). Rejects with
 * UsageBlockedError (quota) or PartialTranslationError (some chunks failed) when the whole text could not be translated.
 */
export async function machineTranslate(text: string, pair?: LanguagePair): Promise<string> {
  if (needsChunking(text)) {
    const r = await machineTranslateLong(text, { pair });
    if (r.complete) return r.text;
    const blocked = r.outcomes.find((x) => x.errorCode && x.errorDetail && typeof x.errorDetail === 'object' && 'reason' in (x.errorDetail as object));
    if (blocked) throw new UsageBlockedError(blocked.errorDetail as BlockedDecision);
    throw new PartialTranslationError(r);
  }
  const src = prepareForMt(text);
  const ck = isViEn(pair) ? `vi>en${src}` : src;
  let p = cache.get(ck);
  if (!p) {
    p = translateRouted(src, pair);
    p.catch(() => cache.delete(ck));
    cache.set(ck, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Name of the provider that will translate `pair` right now (shown to the user: no hidden provider). */
export async function activeProviderLabel(pair?: LanguagePair): Promise<string> {
  return (await describeActive(pair ?? EN_VI)).label;
}
