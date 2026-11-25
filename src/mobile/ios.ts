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
/** Raw message to the iPhone shell (Smart Setup: Keychain, Google sign-in, Safari). */
export const iosPost = (msg: unknown): Promise<unknown> => handler()?.postMessage(msg) ?? Promise.reject(new Error('no ios bridge'));

export interface WidgetStatus {
  /** the widget can share data with the app (an App Group is usable) */
  ok: boolean;
  group: string;
  count: number;
  text: string;
  /** the encrypted GitHub sync is connected */
  cloud: boolean;
  repo?: string;
  /** the sync code to paste into the widget once (no token inside) */
  code?: string;
  /** result of the last upload, in words */
  last?: string;
  /** "Sign in with GitHub" is available in this build */
  github?: boolean;
  /** widgets of LingoLens on the Home Screen, and whether one of them holds our sync code (iOS 17+) */
  widgets?: number;
  linked?: boolean;
}

export interface GithubStart {
  userCode: string;
  deviceCode: string;
  verifyUrl: string;
  /** seconds between checks */
  interval: number;
  expiresIn: number;
}

export interface WidgetSyncResult {
  /** an App Group file was written (never with a free Apple ID) */
  ok: boolean;
  /** "off" (not connected) | "ok" | an error text */
  cloud: string;
}

/**
 * Hands the saved words to the app shell: it writes them for the widget (App Group file when possible) and uploads them, encrypted, to
 * the GitHub repository when the sync is connected. Resolves when the upload is done.
 */
export async function widgetSync(words: unknown[], order = 'random', theme = 'white', interval = 60): Promise<WidgetSyncResult> {
  const h = handler();
  if (!h) return { ok: false, cloud: 'off' };
  return h.postMessage({ cmd: 'widgetSync', words, order, theme, interval }).then(
    (r) => ({ ok: (r as WidgetSyncResult | null)?.ok === true, cloud: String((r as WidgetSyncResult | null)?.cloud ?? 'off') }),
    () => ({ ok: false, cloud: 'Không gửi được cho ứng dụng.' }),
  );
}

/** What the app shell can see: signing groups, whether an App Group container exists, the sync state and code. */
export async function widgetStatus(): Promise<WidgetStatus | null> {
  const h = handler();
  if (!h) return null;
  return (await h.postMessage({ cmd: 'widgetStatus' }).catch(() => null)) as WidgetStatus | null;
}

/** Connects the encrypted GitHub sync. The token goes to the Keychain and is never sent back. Rejects with a readable message. */
export async function widgetConfigure(repo: string, token: string): Promise<WidgetStatus> {
  const h = handler();
  if (!h) throw new Error('Không có cầu nối với ứng dụng iPhone.');
  try {
    return (await h.postMessage({ cmd: 'widgetConfigure', repo, token })) as WidgetStatus;
  } catch (e) {
    throw new Error(String((e as Error)?.message ?? e));
  }
}

/** Sign in with GitHub, step 1: a short code to type on github.com/login/device. Rejects with a readable message. */
export async function githubStart(): Promise<GithubStart> {
  const h = handler();
  if (!h) throw new Error('Không có cầu nối với ứng dụng iPhone.');
  try {
    return (await h.postMessage({ cmd: 'githubStart' })) as GithubStart;
  } catch (e) {
    throw new Error(String((e as Error)?.message ?? e));
  }
}

/** Step 2, repeated: 'pending' until the user has authorised on GitHub, then 'ok' (token kept in the Keychain, repository created, sync connected). */
export async function githubPoll(deviceCode: string): Promise<'pending' | 'ok'> {
  const h = handler();
  if (!h) throw new Error('Không có cầu nối với ứng dụng iPhone.');
  try {
    const r = (await h.postMessage({ cmd: 'githubPoll', deviceCode })) as { status?: string } | null;
    return r?.status === 'ok' ? 'ok' : 'pending';
  } catch (e) {
    throw new Error(String((e as Error)?.message ?? e));
  }
}

export async function widgetDisconnect(): Promise<WidgetStatus | null> {
  const h = handler();
  if (!h) return null;
  return (await h.postMessage({ cmd: 'widgetDisconnect' }).catch(() => null)) as WidgetStatus | null;
}

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
export async function translateOnDevice(text: string, pair = 'en>vi'): Promise<string | null> {
  const h = handler();
  if (!h) return null;
  try {
    const r = (await h.postMessage({ cmd: 'translate', text, ...(pair === 'vi>en' ? { pair } : {}) })) as { text?: string } | null;
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
    return legacyCopy(text);
  }
}

/**
 * Fallback when the Clipboard API refuses (document not focused, a Permissions-Policy of the page, an iframe…). Many reading
 * sites also switch text selection off or cancel the `copy` event, which breaks a plain textarea + execCommand('copy'). So the
 * temporary textarea forces `user-select: text`, and a capture-phase `copy` listener (it runs before the page's own handlers) puts
 * the text on the clipboard itself and stops the page from cancelling it. The user's own text selection is restored afterwards.
 */
export function legacyCopy(text: string): boolean {
  let ta: HTMLTextAreaElement | null = null;
  const sel = document.getSelection?.();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  try {
    document.addEventListener('copy', onCopy, true);
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;width:1px !important;height:1px !important;opacity:0 !important;pointer-events:none !important;user-select:text !important;-webkit-user-select:text !important';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    ta?.remove();
    if (saved && sel) {
      sel.removeAllRanges();
      sel.addRange(saved);
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
export async function translationPackStatus(pair = 'en>vi'): Promise<'installed' | 'download' | 'unsupported' | 'unavailable'> {
  const h = handler();
  if (!h) return 'unavailable';
  const r = (await h.postMessage({ cmd: 'mtStatus', ...(pair === 'vi>en' ? { pair } : {}) }).catch(() => null)) as { status?: string } | null;
  const s = r?.status;
  return s === 'installed' || s === 'download' || s === 'unsupported' ? s : 'unavailable';
}

/** Downloads the Vietnamese pack now (iOS shows its own download sheet). */
export async function prepareTranslationPack(pair = 'en>vi'): Promise<boolean> {
  const h = handler();
  if (!h) return false;
  return h.postMessage({ cmd: 'mtPrepare', ...(pair === 'vi>en' ? { pair } : {}) }).then(() => true, () => false);
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
/** 'vi>en' for a Vietnamese → English request of the Translator API, otherwise the default 'en>vi'. */
const pairOf = (o?: { sourceLanguage?: string; targetLanguage?: string }) => (o?.sourceLanguage === 'vi' && o?.targetLanguage === 'en' ? 'vi>en' : 'en>vi');

export function installTranslatorShim(): void {
  const h = handler();
  const g = globalThis as { Translator?: unknown };
  if (!h) return;
  g.Translator = {
    async availability(o?: { sourceLanguage?: string; targetLanguage?: string }) {
      const s = await translationPackStatus(pairOf(o));
      return s === 'installed' ? 'available' : s === 'download' ? 'downloadable' : 'unavailable';
    },
    async create(o?: { sourceLanguage?: string; targetLanguage?: string; monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) {
      const pair = pairOf(o);
      const s = await translationPackStatus(pair);
      if (s === 'unsupported' || s === 'unavailable') throw new Error('Bản dịch trên máy cần iOS 18 trở lên.');
      if (s === 'download') {
        const cbs: Array<(e: { loaded: number }) => void> = [];
        o?.monitor?.({ addEventListener: (_t, cb) => cbs.push(cb) });
        cbs.forEach((cb) => cb({ loaded: 0 }));
        if (!(await prepareTranslationPack(pair))) throw new Error('Chưa tải được gói dịch Anh ↔ Việt.');
        cbs.forEach((cb) => cb({ loaded: 1 }));
      }
      return {
        async translate(text: string) {
          const out = await translateOnDevice(text, pair);
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
