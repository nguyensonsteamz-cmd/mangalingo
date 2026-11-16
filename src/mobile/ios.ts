/**
 * Bridge to the iPhone app (Swift `WKScriptMessageHandlerWithReply` named "ml").
 * Absent in browsers and in the Android app.
 */
import type { OcrLine } from '@/shared/types';

interface Handler {
  postMessage(msg: unknown): Promise<unknown>;
}
const handler = (): Handler | undefined => (globalThis as { webkit?: { messageHandlers?: { ml?: Handler } } }).webkit?.messageHandlers?.ml;

export const iosBridge = () => !!handler();

/** Seconds-since-1970 stamp of the latest image sent by the Shortcuts action (0 = none). */
export async function pendingScanStamp(): Promise<number> {
  const h = handler();
  if (!h) return 0;
  const r = (await h.postMessage({ cmd: 'pendingScan' })) as { stamp?: number } | null;
  return r?.stamp ?? 0;
}

/** Apple Vision OCR of a base64 image (optionally only a normalised region). */
export async function recognize(imageBase64: string, region?: { x: number; y: number; w: number; h: number }): Promise<OcrLine[]> {
  const h = handler();
  if (!h) throw new Error('Nhận dạng chữ chỉ có trong ứng dụng LingoLens trên iPhone.');
  const r = (await h.postMessage({ cmd: 'ocr', image: imageBase64, region })) as { lines?: OcrLine[] } | null;
  return r?.lines ?? [];
}

/**
 * English → Vietnamese with Apple Translation on the iPhone (iOS 18+, on the device). null when
 * unavailable (older iOS, outside the app); throws on a translation error.
 */
export async function translateOnDevice(text: string): Promise<string | null> {
  const h = handler();
  if (!h) return null;
  try {
    const r = (await h.postMessage({ cmd: 'translate', text })) as { text?: string } | null;
    return r?.text ?? null;
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes('unavailable')) return null;
    throw e;
  }
}

/**
 * Several texts in one request (all bubbles of a page): one model load instead of one per bubble.
 * null when unavailable (older iOS, outside the app); throws on a translation error.
 */
export async function translateBatch(texts: string[]): Promise<string[] | null> {
  const h = handler();
  if (!h || !texts.length) return null;
  try {
    const r = (await h.postMessage({ cmd: 'translateBatch', texts })) as { texts?: string[] } | null;
    return r?.texts ?? null;
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes('unavailable')) return null;
    throw e;
  }
}

/**
 * Copies text: the iPhone's system pasteboard through the app (always works), else the web
 * Clipboard API, else the old execCommand fallback. Resolves true when copied.
 */
export async function copyText(text: string): Promise<boolean> {
  const h = handler();
  if (h) {
    const ok = await h.postMessage({ cmd: 'copy', text }).then(() => true, () => false);
    if (ok) return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** The English voice the phone will use (to suggest downloading a better one). */
export async function voiceInfo(): Promise<{ name: string; quality: 'premium' | 'enhanced' | 'compact' | 'none' } | null> {
  const h = handler();
  if (!h) return null;
  return (await h.postMessage({ cmd: 'voiceInfo' }).catch(() => null)) as { name: string; quality: 'premium' | 'enhanced' | 'compact' | 'none' } | null;
}

/** Is the Vietnamese translation pack on the phone? ('unavailable' = older iOS / not the iPhone app) */
export async function translationPackStatus(): Promise<'installed' | 'download' | 'unsupported' | 'unavailable'> {
  const h = handler();
  if (!h) return 'unavailable';
  const r = (await h.postMessage({ cmd: 'mtStatus' }).catch(() => null)) as { status?: string } | null;
  const s = r?.status;
  return s === 'installed' || s === 'download' || s === 'unsupported' ? s : 'unavailable';
}

/** Downloads the Vietnamese pack now (iOS shows its own download sheet). */
export async function prepareTranslationPack(): Promise<boolean> {
  const h = handler();
  if (!h) return false;
  return h.postMessage({ cmd: 'mtPrepare' }).then(() => true, () => false);
}

/** The image the Shortcuts action delivered (served by the app at app://local/__scan/latest). */
export const latestScanUrl = (stamp: number) => `__scan/latest?t=${stamp}`;

/** Switches the iPhone app icon to a logo (alternate icons; the default logo = primary icon). */
export async function setAppIcon(logo: string): Promise<void> {
  const h = handler();
  if (!h) return;
  const name = logo === 'glass' ? null : `AppIcon-${logo[0].toUpperCase()}${logo.slice(1)}`;
  await h.postMessage({ cmd: 'setIcon', name }).catch(() => {});
}

/**
 * Makes the iPhone's Apple Translation look like Chrome's `Translator` API, so everything that
 * machine-translates (sentence translation, single words in the vocabulary list…) works in the app.
 * No-op outside the iPhone app.
 */
export function installTranslatorShim(): void {
  const h = handler();
  const g = globalThis as { Translator?: unknown };
  if (!h) return;
  g.Translator = {
    async availability() {
      const s = await translationPackStatus();
      return s === 'installed' ? 'available' : s === 'download' ? 'downloadable' : 'unavailable';
    },
    async create(o?: { monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) {
      const s = await translationPackStatus();
      if (s === 'unsupported' || s === 'unavailable') throw new Error('Bản dịch trên máy cần iOS 18 trở lên.');
      if (s === 'download') {
        const cbs: Array<(e: { loaded: number }) => void> = [];
        o?.monitor?.({ addEventListener: (_t, cb) => cbs.push(cb) });
        cbs.forEach((cb) => cb({ loaded: 0 }));
        if (!(await prepareTranslationPack())) throw new Error('Chưa tải được gói dịch Anh → Việt.');
        cbs.forEach((cb) => cb({ loaded: 1 }));
      }
      return {
        async translate(text: string) {
          const out = await translateOnDevice(text);
          if (out === null) throw new Error('Bản dịch trên máy không khả dụng.');
          return out;
        },
      };
    },
  };
}

/** Opens the in-app Web Reader (a native browser that translates while you read). iPhone app only. */
export async function openReader(url?: string): Promise<boolean> {
  const h = handler();
  if (!h) return false;
  return h.postMessage({ cmd: 'openReader', url }).then(() => true, () => false);
}
