/**
 * Bridge to the Android app (Kotlin `@JavascriptInterface` object named `MangaLingoNative`).
 * Absent when the page is opened in a normal browser (preview / development).
 */
export interface NativeApi {
  /** "Display over other apps" permission granted. */
  overlayAllowed(): boolean;
  /** Opens the system screen to grant that permission. */
  openOverlaySettings(): void;
  /** Starts / stops the floating button. Returns the new state. */
  setEnabled(on: boolean): boolean;
  isEnabled(): boolean;
  /** Notifications permission (Android 13+), needed for the "running" notification. */
  notificationsAllowed(): boolean;
  /** Switches the launcher icon to a logo (glass | clear | oil | sunset | clay | ink). */
  setLogo?(id: string): boolean;
  requestNotifications(): void;
  /** On-device machine translation (ML Kit); the answer arrives through window.__mlMt. */
  mt?(id: number, op: string, text: string): void;
  /** Smart Setup: Android Keystore-backed secret storage (synchronous, "" when absent). */
  secretGet?(name: string): string;
  secretSet?(name: string, value: string): void;
  secretRemove?(name: string): void;
  /** Google sign-in in the system browser (Authorization Code + PKCE); the answer comes through window.__mlOAuth. */
  oauthConfigured?(): boolean;
  oauthStart?(id: number, scopes: string): void;
  oauthRevoke?(token: string): void;
  /** Opens a link in the system browser (Google Cloud Console pages). */
  openUrl?(url: string): void;
}

export const native: NativeApi | null = (globalThis as { MangaLingoNative?: NativeApi }).MangaLingoNative ?? null;

/** The activity calls this when the user comes back (e.g. from the permission screen). */
export function onResume(cb: () => void): () => void {
  const g = globalThis as { __mlOnResume?: () => void };
  const prev = g.__mlOnResume;
  g.__mlOnResume = () => {
    prev?.();
    cb();
  };
  return () => {
    g.__mlOnResume = prev;
  };
}

let mtSeq = 0;
const mtPending = new Map<number, { ok: (v: string) => void; fail: (e: Error) => void }>();
(globalThis as { __mlMt?: (id: number, ok: boolean, text: string) => void }).__mlMt = (id, ok, text) => {
  const p = mtPending.get(id);
  mtPending.delete(id);
  if (p) ok ? p.ok(text) : p.fail(new Error(text));
};

/** One machine-translation request to the Android app (ML Kit). */
export function androidMt(op: 'status' | 'prepare' | 'translate', text = '', pair = 'en>vi'): Promise<string> {
  return new Promise((ok, fail) => {
    if (!native?.mt) return fail(new Error('unavailable'));
    const id = ++mtSeq;
    mtPending.set(id, { ok, fail });
    native.mt(id, pair === 'en>vi' ? op : `${op}:${pair}`, text); // no suffix = en>vi (original bridge behaviour)
  });
}

/** 'en>vi' (default) or 'vi>en' from a Translator-API options object. */
const pairOf = (o?: { sourceLanguage?: string; targetLanguage?: string }) => (o?.sourceLanguage === 'vi' && o?.targetLanguage === 'en' ? 'vi>en' : 'en>vi');

/** Makes ML Kit look like Chrome's `Translator` API so every machine-translating screen works in the Android app. */
export function installAndroidTranslatorShim(): void {
  const g = globalThis as { Translator?: unknown };
  if (!native?.mt) return;
  g.Translator = {
    async availability(o?: { sourceLanguage?: string; targetLanguage?: string }) {
      try {
        return (await androidMt('status', '', pairOf(o))) === 'installed' ? 'available' : 'downloadable';
      } catch {
        return 'unavailable';
      }
    },
    async create(o?: { sourceLanguage?: string; targetLanguage?: string; monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) {
      const pair = pairOf(o);
      if ((await androidMt('status', '', pair)) !== 'installed') {
        const cbs: Array<(e: { loaded: number }) => void> = [];
        o?.monitor?.({ addEventListener: (_t, cb) => cbs.push(cb) });
        cbs.forEach((cb) => cb({ loaded: 0 }));
        await androidMt('prepare', '', pair);
        cbs.forEach((cb) => cb({ loaded: 1 }));
      }
      return { translate: (text: string) => androidMt('translate', text, pair) };
    },
  };
}
