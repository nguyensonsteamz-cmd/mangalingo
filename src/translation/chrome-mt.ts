/**
 * Optional machine translation through Chrome's built-in Translator API (Chrome 138+).
 * Translation runs on-device: Chrome downloads the EN→VI language model from Google once (only
 * after an explicit user click), then text is translated locally and never sent anywhere.
 * Off by default (Settings → Hành vi đọc → Bản dịch máy).
 */

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

/** Translates EN→VI on-device. Requires an available model (see mtAvailability / getTranslator). */
export function machineTranslate(text: string): Promise<string> {
  const src = prepareForMt(text).slice(0, 4000);
  let p = cache.get(src);
  if (!p) {
    p = getTranslator().then((t) => t.translate(src));
    p.catch(() => cache.delete(src));
    cache.set(src, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}
