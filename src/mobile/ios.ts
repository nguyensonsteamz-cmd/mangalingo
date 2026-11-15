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
