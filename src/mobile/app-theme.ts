/**
 * Sends the app's theme (light / dark and its colours) to the iPhone shell, so the Web Reader (bars, tools, the popup on the page) uses
 * the same theme as the rest of the app. Sent at start and again whenever the theme or the accent colour changes. Only the main page.
 */
import { iosBridge, iosPost } from './ios';

const VARS = { bg: '--ml-bg', surface: '--ml-surface', elevated: '--ml-elevated', text: '--ml-text', muted: '--ml-muted', border: '--ml-border', accent: '--ml-accent', accentFg: '--ml-accent-fg' } as const;

/** The current theme as "r g b" triples (null while the colours are not readable). */
export function readAppTheme(root: HTMLElement = document.documentElement): Record<string, string | boolean> | null {
  const cs = getComputedStyle(root);
  const out: Record<string, string | boolean> = { light: root.dataset.theme === 'light' };
  for (const [k, v] of Object.entries(VARS)) {
    const t = cs.getPropertyValue(v).trim().replace(/\s+/g, ' ');
    if (!/^\d{1,3} \d{1,3} \d{1,3}$/.test(t)) return null;
    out[k] = t;
  }
  return out;
}

export function startAppThemeSync(): () => void {
  if (!iosBridge()) return () => {};
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    const t = readAppTheme();
    if (!t) return;
    const key = JSON.stringify(t);
    if (key === last) return;
    last = key;
    void iosPost({ cmd: 'appTheme', ...t }).catch(() => {});
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(send, 150);
  };
  send();
  const mo = new MutationObserver(later);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', later);
  return () => {
    clearTimeout(timer);
    mo.disconnect();
    mq.removeEventListener?.('change', later);
  };
}
