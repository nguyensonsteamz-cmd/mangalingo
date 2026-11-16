/**
 * Hover underline: the word under the mouse is underlined so the user sees what a click will
 * look up. Uses the CSS Custom Highlight API (::highlight) – no page DOM is touched, nothing to
 * clean up in the page, and it follows the mouse without re-layout.
 */
import { isInteractive, wordAtPoint } from './dom-reader';

const NAME = 'lingolens-hover';
const STYLE_ID = 'lingolens-hover-style';

type HighlightApi = { highlights?: { set(name: string, h: unknown): void; delete(name: string): void } };
type HighlightCtor = new (...ranges: Range[]) => unknown;

export function installHoverUnderline(opts: { enabled: () => boolean; fromUs: (e: Event) => boolean }): () => void {
  const css = (globalThis as unknown as { CSS?: HighlightApi }).CSS;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!css?.highlights || !Highlight) return () => {}; // older Chrome: no underline, everything else works

  let style: HTMLStyleElement | null = null;
  const ensureStyle = () => {
    if (style?.isConnected) return;
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `::highlight(${NAME}){text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;text-decoration-color:#3451d1;}`;
    (document.head ?? document.documentElement).appendChild(style);
  };
  const clear = () => css.highlights!.delete(NAME);

  // time-based throttle (not requestAnimationFrame: it does not run in a background tab)
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let lastRun = 0;
  let last: MouseEvent | null = null;
  const onMove = (e: MouseEvent) => {
    last = e;
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      lastRun = performance.now();
      const ev = last;
      if (!ev) return;
      if (!opts.enabled() || ev.buttons !== 0 || opts.fromUs(ev)) return clear(); // off / dragging a selection / over our own UI
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!target || isInteractive(target)) return clear(); // links, buttons, fields keep their own behaviour
      const hit = wordAtPoint(ev.clientX, ev.clientY);
      if (!hit) return clear();
      ensureStyle();
      css.highlights!.set(NAME, new Highlight(hit.range));
    }, Math.max(0, 40 - (performance.now() - lastRun)));
  };
  const off = () => clear();
  window.addEventListener('mousemove', onMove, { passive: true, capture: true });
  window.addEventListener('scroll', off, { passive: true, capture: true });
  window.addEventListener('mousedown', off, { capture: true });
  document.addEventListener('mouseleave', off);
  return () => {
    window.removeEventListener('mousemove', onMove, { capture: true });
    window.removeEventListener('scroll', off, { capture: true });
    window.removeEventListener('mousedown', off, { capture: true });
    document.removeEventListener('mouseleave', off);
    clear();
    style?.remove();
  };
}
