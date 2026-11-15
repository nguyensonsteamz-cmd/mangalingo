/**
 * Liquid Glass motion system – the interactive behaviour of glass elements (styles in styles.css,
 * "Liquid Glass motion"). One delegated listener set per document / shadow root:
 *   - every .ml-press element: cursor-following reflection (--ml-mx / --ml-my), hover lift and
 *     press compression are CSS; this module only feeds the cursor position;
 *   - [data-ml-magnetic]: the element leans towards the cursor (≤ 3 px, ≤ 2°) and springs back;
 *   - .ml-ripple: a soft radial light spreads from the click point and fades.
 * Mouse / pen only for hover effects (touch never gets stuck hover states). Everything is skipped
 * with prefers-reduced-motion. Returns a cleanup function.
 */
const MAX_SHIFT = 3; // px
const MAX_TILT = 2; // deg

const reducedMotion = () => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

type Root = Document | ShadowRoot;

export function installGlassMotion(root: Root = document): () => void {
  let frame = 0;
  let pending: PointerEvent | null = null;
  let magnet: HTMLElement | null = null;

  const releaseMagnet = () => {
    if (!magnet) return;
    magnet.style.removeProperty('--ml-mag-x');
    magnet.style.removeProperty('--ml-mag-y');
    magnet.style.removeProperty('--ml-mag-r');
    magnet = null;
  };

  const update = () => {
    frame = 0;
    const e = pending;
    pending = null;
    if (!e || !(e.target instanceof Element)) return;
    // reflection that follows the cursor
    const press = e.target.closest<HTMLElement>('.ml-press');
    if (press) {
      const r = press.getBoundingClientRect();
      press.style.setProperty('--ml-mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      press.style.setProperty('--ml-my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    }
    // magnetic lean
    const m = e.target.closest<HTMLElement>('[data-ml-magnetic]');
    if (m !== magnet) releaseMagnet();
    if (m && !(m as HTMLButtonElement).disabled && !reducedMotion()) {
      magnet = m;
      const r = m.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      m.style.setProperty('--ml-mag-x', `${(nx * MAX_SHIFT).toFixed(2)}px`);
      m.style.setProperty('--ml-mag-y', `${(ny * MAX_SHIFT * 0.7).toFixed(2)}px`);
      m.style.setProperty('--ml-mag-r', `${(nx * MAX_TILT * 0.6).toFixed(2)}deg`);
    }
  };

  const onMove = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;
    pending = e;
    if (!frame) frame = requestAnimationFrame(update);
  };

  const onLeave = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!magnet) return;
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (!to || !magnet.contains(to)) releaseMagnet();
  };

  const onDown = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!(e.target instanceof Element) || reducedMotion()) return;
    const host = e.target.closest<HTMLElement>('.ml-ripple');
    if (!host || (host as HTMLButtonElement).disabled) return;
    const r = host.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const wave = document.createElement('span');
    wave.className = 'ml-ripple-wave';
    wave.setAttribute('aria-hidden', 'true');
    wave.style.width = wave.style.height = `${size}px`;
    wave.style.left = `${e.clientX - r.left - size / 2}px`;
    wave.style.top = `${e.clientY - r.top - size / 2}px`;
    host.appendChild(wave);
    const done = () => wave.remove();
    wave.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1200); // safety net (animation disabled / element detached)
  };

  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerout', onLeave, { passive: true });
  root.addEventListener('pointerdown', onDown, { passive: true });
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerout', onLeave);
    root.removeEventListener('pointerdown', onDown);
    if (frame) cancelAnimationFrame(frame);
    releaseMagnet();
  };
}

/**
 * Crossfade for content that changes in place (popup / sidebar tabs): returns a class whose
 * animation restarts whenever `key` changes, without re-mounting the content.
 */
export function crossfadeClass(key: string, memo: { key?: string; flip?: boolean }): string {
  if (memo.key !== undefined && memo.key !== key) memo.flip = !memo.flip;
  memo.key = key;
  return memo.flip ? 'ml-xfade-b' : 'ml-xfade-a';
}
