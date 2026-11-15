import { describe, expect, it } from 'vitest';
import { computePopupPosition, intersects, unionRects } from '@/popup/position';

const vp = { width: 1280, height: 800 };
const size = { width: 380, height: 320 };

describe('popup positioning', () => {
  it('places the popup below the word when there is room, without covering it', () => {
    const anchor = { left: 200, top: 100, width: 60, height: 20 };
    const p = computePopupPosition(anchor, size, vp);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(128);
    expect(intersects({ left: p.left, top: p.top, width: p.width, height: 320 }, anchor)).toBe(false);
  });
  it('flips above near the bottom edge', () => {
    const anchor = { left: 200, top: 700, width: 60, height: 20 };
    const p = computePopupPosition(anchor, size, vp);
    expect(p.placement).toBe('above');
    expect(p.top + Math.min(320, p.maxHeight)).toBeLessThanOrEqual(anchor.top);
  });
  it('stays inside the viewport near the right edge', () => {
    const p = computePopupPosition({ left: 1250, top: 100, width: 25, height: 20 }, size, vp);
    expect(p.left + p.width).toBeLessThanOrEqual(1280 - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
  it('honours the preferred position', () => {
    const anchor = { left: 200, top: 400, width: 60, height: 20 };
    expect(computePopupPosition(anchor, size, vp, 'above').placement).toBe('above');
    expect(computePopupPosition(anchor, size, vp, 'below').placement).toBe('below');
  });
  it('limits height and enables scrolling when content is taller than the space', () => {
    const p = computePopupPosition({ left: 100, top: 300, width: 50, height: 20 }, { width: 380, height: 2000 }, vp);
    expect(p.maxHeight).toBeLessThan(800);
  });
  it('goes beside a tall paragraph selection', () => {
    const anchor = { left: 100, top: 40, width: 600, height: 720 };
    const p = computePopupPosition(anchor, size, vp);
    expect(p.placement).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(anchor.left + anchor.width);
  });
  it('falls back to a corner when nothing fits (narrow viewport)', () => {
    const p = computePopupPosition({ left: 0, top: 10, width: 400, height: 780 }, size, { width: 420, height: 800 });
    expect(p.placement).toBe('overlay');
    expect(p.width).toBeLessThanOrEqual(404);
  });
  it('computes rect unions', () => {
    expect(unionRects([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 5, height: 10 }])).toEqual({ left: 0, top: 0, width: 25, height: 15 });
    expect(unionRects([])).toBeNull();
  });

  it("'side' (OCR bubble) puts the popup to the right of the bubble, top-aligned, without covering it", () => {
    const bubble = { left: 500, top: 300, width: 120, height: 140 };
    const p = computePopupPosition(bubble, size, vp, 'side');
    expect(p.placement).toBe('right');
    expect(p.left).toBe(628);
    expect(p.top).toBe(300);
    expect(intersects({ left: p.left, top: p.top, width: p.width, height: 320 }, bubble)).toBe(false);
  });
  it("'side' falls back to the left near the right edge, and stays inside the viewport vertically", () => {
    const bubble = { left: 1000, top: 700, width: 150, height: 80 };
    const p = computePopupPosition(bubble, size, vp, 'side');
    expect(p.placement).toBe('left');
    expect(p.left + p.width).toBeLessThanOrEqual(bubble.left);
    expect(p.top + 320).toBeLessThanOrEqual(vp.height - 8);
  });
  it("'side' with no room on either side falls back to above/below", () => {
    const narrow = { width: 500, height: 800 };
    const p = computePopupPosition({ left: 100, top: 100, width: 300, height: 60 }, size, narrow, 'side');
    expect(p.placement).toBe('below');
  });
});

describe('resizing an OCR box by its handles', () => {
  it('moves only the dragged edges and keeps a minimum size', async () => {
    const { resizeRect } = await import('@/popup/position');
    const r = { left: 100, top: 100, width: 80, height: 60 };
    expect(resizeRect(r, 's', 0, 40)).toEqual({ left: 100, top: 100, width: 80, height: 100 });
    expect(resizeRect(r, 'nw', -20, -10)).toEqual({ left: 80, top: 90, width: 100, height: 70 });
    expect(resizeRect(r, 'e', 30, 99)).toEqual({ left: 100, top: 100, width: 110, height: 60 });
    expect(resizeRect(r, 'w', 500, 0)).toEqual({ left: 166, top: 100, width: 14, height: 60 });
    expect(resizeRect(r, 'n', 0, -500).top).toBe(-400);
  });
});
