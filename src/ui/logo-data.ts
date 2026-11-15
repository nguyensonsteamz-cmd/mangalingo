/**
 * LingoLens logos – data only (no React): 64×64 SVG paths + a canvas renderer. Used by the UI
 * (logos.tsx), the extension's service worker (toolbar icon) and scripts/make-logo-assets.mjs.
 */
export type LogoId = 'lens' | 'bubble' | 'spark' | 'book';

export interface LogoPath {
  d: string;
  fill: string;
  /** "evenodd" for shapes with holes (the lens ring). */
  rule?: 'evenodd' | 'nonzero';
}

export interface LogoDef {
  id: LogoId;
  name: string;
  /** Tile background (the app icon's background). */
  bg: string;
  paths: LogoPath[];
}

export const LOGOS: LogoDef[] = [
  {
    id: 'lens',
    name: 'Kính lúp',
    bg: '#3451D1',
    paths: [
      // ring of the lens
      { d: 'M28 11a17 17 0 1 1 0 34a17 17 0 1 1 0-34zm0 6a11 11 0 1 0 0 22a11 11 0 1 0 0-22z', fill: '#FFFFFF', rule: 'evenodd' },
      // handle
      { d: 'M38.6 41.4l4.2-4.2l11.4 11.4a3 3 0 0 1-4.2 4.2z', fill: '#FFFFFF' },
      // text lines seen through the lens
      { d: 'M21 23.5h14v3.6H21zM21 30h9v3.6h-9z', fill: '#FFD43B' },
    ],
  },
  {
    id: 'bubble',
    name: 'Bong bóng',
    bg: '#1B2030',
    paths: [
      { d: 'M14 14h36a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5H30l-10 8v-8h-6a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5z', fill: '#7C9CFF' },
      { d: 'M19 23h26v4H19zM19 31h17v4H19z', fill: '#1B2030' },
    ],
  },
  {
    id: 'spark',
    name: 'Chữ L',
    bg: '#7048E8',
    paths: [
      { d: 'M17 13h9v28h20v9H17z', fill: '#FFFFFF' },
      { d: 'M45 9l2.6 6.9L54.5 18.5l-6.9 2.6L45 28l-2.6-6.9L35.5 18.5l6.9-2.6z', fill: '#FFD43B' },
    ],
  },
  {
    id: 'book',
    name: 'Sách mở',
    bg: '#0B8F6A',
    paths: [
      { d: 'M9 17c8-2.5 15.5-1.5 21.5 3v27c-6-4.5-13.5-5.5-21.5-3z', fill: '#FFFFFF' },
      { d: 'M55 17c-8-2.5-15.5-1.5-21.5 3v27c6-4.5 13.5-5.5 21.5-3z', fill: '#DDF7EE' },
      { d: 'M14 24h11v2.6H14zM14 30h8v2.6h-8zM39 24h11v2.6H39zM39 30h8v2.6h-8z', fill: '#0B8F6A' },
    ],
  },
];

export const logoById = (id: string | undefined): LogoDef => LOGOS.find((l) => l.id === id) ?? LOGOS[0];

/** Draws a logo on a 2D canvas (Chrome toolbar icon, PNG export). */
export function drawLogo(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, id: string, size: number, square = false) {
  const logo = logoById(id);
  const s = size / 64;
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = logo.bg;
  const r = square ? 0.001 : 15; // phone launchers mask the corners themselves
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(64, 0, 64, 64, r);
  ctx.arcTo(64, 64, 0, 64, r);
  ctx.arcTo(0, 64, 0, 0, r);
  ctx.arcTo(0, 0, 64, 0, r);
  ctx.closePath();
  ctx.fill();
  for (const p of logo.paths) {
    ctx.fillStyle = p.fill;
    ctx.fill(new Path2D(p.d), p.rule ?? 'nonzero');
  }
  ctx.restore();
}
