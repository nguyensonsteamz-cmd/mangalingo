/**
 * Optional machine translation through Chrome's built-in Translator API (Chrome 138+).
 * Translation runs on-device: Chrome downloads the EN→VI language model from Google once (only
 * after an explicit user click), then text is translated locally and never sent anywhere.
 * Off by default (Settings → Hành vi đọc → Bản dịch máy).
 */

import { send } from '@/shared/messages';
import type { BlockedDecision } from '@/modules/usage/types';

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
const api = (): TranslatorStatic | undefined => (globalThis as { Translator?: TranslatorStatic }).Translator;

export async function mtAvailability(): Promise<MtAvailability> {
  if (await googleActive()) return 'available'; // Google Cloud provider: nothing to download
  const T = api();
  if (!T) return 'unsupported';
  try {
    const a = await T.availability(PAIR);
    return a === 'available' || a === 'downloadable' || a === 'downloading' ? a : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

let instance: Promise<ChromeTranslator> | null = null;
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
export function getTranslator(onProgress?: (loaded: number) => void): Promise<ChromeTranslator> {
  if (onProgress) progressListeners.add(onProgress);
  const T = api();
  if (!T) return Promise.reject(new Error('Chrome này không có Translator API (cần Chrome 138 trở lên).'));
  instance ??= T.create({
    ...PAIR,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => progressListeners.forEach((l) => l(e.loaded))),
  }).then((t) => {
    markReady();
    return t;
  }).catch((e: Error) => {
    instance = null;
    throw e;
  });
  return instance;
}

/** Prepares OCR/bubble text: re-joins words hyphenated across lines and collapses whitespace. */
export function prepareForMt(text: string): string {
  return text.replace(/([A-Za-z])-\s+([a-z])/gi, '$1$2').replace(/\s+/g, ' ').trim();
}

const cache = new Map<string, Promise<string>>();

/** Google Cloud (through the quota guard) when selected, otherwise the on-device translator. */
async function translateRouted(src: string): Promise<string> {
  if (await googleActive()) {
    const r = await send({ type: 'usage:translate', text: src });
    if (r.source === 'google') return r.text;
    if (r.source === 'blocked') throw new UsageBlockedError(r.decision);
    // 'device': fall through to the on-device translator
  }
  const t = await getTranslator();
  return t.translate(src);
}

/** Translates EN→VI on-device. Requires an available model (see mtAvailability / getTranslator). */
export function machineTranslate(text: string): Promise<string> {
  const src = prepareForMt(text).slice(0, 4000);
  let p = cache.get(src);
  if (!p) {
    p = translateRouted(src);
    p.catch(() => cache.delete(src));
    cache.set(src, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}
