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
