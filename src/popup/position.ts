/**
 * Popup placement: never covers the anchor (the word/sentence being read) when there is room,
 * flips above/below, falls back to the side for tall anchors, and always stays inside the viewport.
 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'below' | 'above' | 'right' | 'left' | 'overlay';
}

export function computePopupPosition(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  /** 'side' (OCR speech bubbles): beside the anchor, vertically aligned with it, when there is room. */
  pref: 'auto' | 'below' | 'above' | 'side' = 'auto',
  gap = 8,
  margin = 8,
): Placement {
  const width = Math.max(200, Math.min(size.width, viewport.width - margin * 2));
  const wanted = Math.max(120, size.height);
  const bottom = anchor.top + anchor.height;
  const right = anchor.left + anchor.width;
  const spaceBelow = viewport.height - bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const MIN = 160;
  const clampX = (x: number) => Math.min(Math.max(margin, x), viewport.width - width - margin);
  const clampY = (y: number, h: number) => Math.min(Math.max(margin, y), viewport.height - h - margin);

  const below = (): Placement => {
    const maxHeight = Math.max(MIN, spaceBelow);
    return { left: clampX(anchor.left), top: bottom + gap, width, maxHeight, placement: 'below' };
  };
  const above = (): Placement => {
    const maxHeight = Math.max(MIN, spaceAbove);
    const h = Math.min(wanted, maxHeight);
    return { left: clampX(anchor.left), top: Math.max(margin, anchor.top - gap - h), width, maxHeight, placement: 'above' };
  };

  const besideRight = () => viewport.width - right - gap - margin >= width;
  const besideLeft = () => anchor.left - gap - margin >= width;
  const beside = (side: 'right' | 'left'): Placement => {
    const maxHeight = viewport.height - margin * 2;
    const h = Math.min(wanted, maxHeight);
    // Align the popup's top with the anchor's top, but keep it fully on screen.
    const top = clampY(anchor.top, h);
    return { left: side === 'right' ? right + gap : anchor.left - gap - width, top, width, maxHeight, placement: side };
  };
  if (pref === 'side') {
    if (besideRight()) return beside('right');
    if (besideLeft()) return beside('left');
  }

  const fitsBelow = spaceBelow >= Math.min(wanted, 260);
  const fitsAbove = spaceAbove >= Math.min(wanted, 260);
  if (pref === 'below' && spaceBelow >= MIN) return below();
  if (pref === 'above' && spaceAbove >= MIN) return above();
  if (fitsBelow && (pref !== 'above' || !fitsAbove)) return below();
  if (fitsAbove) return above();
  if (Math.max(spaceBelow, spaceAbove) >= MIN) return spaceBelow >= spaceAbove ? below() : above();

  // Tall anchor (paragraph selection): try beside it.
  if (besideRight()) return beside('right');
  if (besideLeft()) return beside('left');
  const maxHeight = viewport.height - margin * 2;
  const h = Math.min(wanted, maxHeight);
  // No free space at all: bottom-right corner, overlapping as little of the anchor's start as possible.
  return { left: viewport.width - width - margin, top: viewport.height - h - margin, width, maxHeight: h, placement: 'overlay' };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r.left));
  const t = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((x) => x.left + x.width));
  const b = Math.max(...rects.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Resizes a rectangle by dragging one handle by (dx, dy); keeps a 14 px minimum. */
export function resizeRect(r: Rect, h: Handle, dx: number, dy: number): Rect {
  let { left, top, width, height } = r;
  if (h.includes('w')) {
    const nl = Math.min(left + dx, left + width - 14);
    width += left - nl;
    left = nl;
  }
  if (h.includes('e')) width = Math.max(14, width + dx);
  if (h.includes('n')) {
    const nt = Math.min(top + dy, top + height - 14);
    height += top - nt;
    top = nt;
  }
  if (h.includes('s')) height = Math.max(14, height + dy);
  return { left, top, width, height };
}

