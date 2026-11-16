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
  mt?(id: number, op: 'status' | 'prepare' | 'translate', text: string): void;
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
export function androidMt(op: 'status' | 'prepare' | 'translate', text = ''): Promise<string> {
  return new Promise((ok, fail) => {
    if (!native?.mt) return fail(new Error('unavailable'));
    const id = ++mtSeq;
    mtPending.set(id, { ok, fail });
    native.mt(id, op, text);
  });
}

/** Makes ML Kit look like Chrome's `Translator` API so every machine-translating screen works in the Android app. */
export function installAndroidTranslatorShim(): void {
  const g = globalThis as { Translator?: unknown };
  if (!native?.mt) return;
  g.Translator = {
    async availability() {
      try {
        return (await androidMt('status')) === 'installed' ? 'available' : 'downloadable';
      } catch {
        return 'unavailable';
      }
    },
    async create(o?: { monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) {
      if ((await androidMt('status')) !== 'installed') {
        const cbs: Array<(e: { loaded: number }) => void> = [];
        o?.monitor?.({ addEventListener: (_t, cb) => cbs.push(cb) });
        cbs.forEach((cb) => cb({ loaded: 0 }));
        await androidMt('prepare');
        cbs.forEach((cb) => cb({ loaded: 1 }));
      }
      return { translate: (text: string) => androidMt('translate', text) };
    },
  };
}
