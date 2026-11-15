/**
 * LingoLens logos – data + canvas renderer (no React). Every logo is the same magnifier painted in a
 * different artistic style. Used by the UI (logos.tsx), the extension's service worker (toolbar
 * icon) and scripts/make-logo-assets.mjs (app icons). Drawn on a 64×64 unit grid.
 */
import { CLEAR_FROST, CLEAR_OPTICS, GLASS_VARIANTS, renderClear, renderClearAlpha, renderGlass, type GlassVariant } from './logo-glass';

export type LogoId = 'glass' | 'clear' | 'oil' | 'sunset' | 'clay' | 'ink';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** s = device pixels per unit (shadow blur / offsets are not scaled by the transform). */
type Painter = (x: Ctx, s: number, r: () => number, bg: () => void) => void;

export interface LogoDef {
  id: LogoId;
  name: string;
  /** Background behind the magnifier (bg layer) and the magnifier itself (fg layer). */
  bg: Painter;
  fg: Painter;
}

const TAU = Math.PI * 2;
const C = 28; // lens centre
const RR = 14; // lens ring radius (ring is 6 units wide)
const H0: [number, number] = [38.5, 38.5];
const H1: [number, number] = [51.5, 51.5];

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const tile = (x: Ctx, square: boolean) => {
  const r = square ? 0.001 : 15; // phone launchers mask the corners themselves
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(64, 0, 64, 64, r);
  x.arcTo(64, 64, 0, 64, r);
  x.arcTo(0, 64, 0, 0, r);
  x.arcTo(0, 0, 64, 0, r);
  x.closePath();
};
const circle = (x: Ctx, cx: number, cy: number, r: number) => {
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
};
const pill = (x: Ctx, X: number, Y: number, w: number, h: number) => {
  const r = h / 2;
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
};
/** The two "text" lines seen through the lens. */
const textLines = (x: Ctx, fill: string) => {
  x.fillStyle = fill;
  pill(x, 21, 23.5, 14, 3.6);
  x.fill();
  pill(x, 21, 30, 9, 3.6);
  x.fill();
};
const handle = (x: Ctx) => {
  x.beginPath();
  x.moveTo(...H0);
  x.lineTo(...H1);
};
const lens = (x: Ctx, ring: string | CanvasGradient, hnd: string | CanvasGradient = ring, w = 6) => {
  x.lineWidth = w;
  x.lineCap = 'round';
  x.strokeStyle = ring;
  circle(x, C, C, RR);
  x.stroke();
  x.strokeStyle = hnd;
  handle(x);
  x.stroke();
};
const lin = (x: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};
const rad = (x: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: [number, string][]) => {
  const g = x.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};
const shadow = (x: Ctx, s: number, color: string, blur: number, dx = 0, dy = 0) => {
  x.shadowColor = color;
  x.shadowBlur = blur * s;
  x.shadowOffsetX = dx * s;
  x.shadowOffsetY = dy * s;
};
const noShadow = (x: Ctx) => shadow(x, 0, 'transparent', 0);
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export const LOGOS: LogoDef[] = [
  {
    id: 'glass',
    name: 'Liquid Glass',
    // LingoLens blue → violet → magenta with distinct colour fields and two flowing light ribbons,
    // so the transparent glass visibly refracts what is behind it.
    bg(x) {
      x.fillStyle = lin(x, 0, 0, 64, 64, [[0, '#2350FF'], [0.55, '#6A2CF0'], [1, '#C21FD0']]);
      x.fillRect(0, 0, 64, 64);
      const blob = (cx: number, cy: number, r: number, rgb: string, a: number) => {
        x.fillStyle = rad(x, cx, cy, 0, cx, cy, r, [[0, `rgba(${rgb},${a})`], [1, `rgba(${rgb},0)`]]);
        x.fillRect(0, 0, 64, 64);
      };
      blob(4, 4, 30, '0,220,210', 0.95);
      blob(62, 60, 30, '255,60,140', 0.95);
      blob(60, 2, 22, '255,176,40', 0.95);
      blob(0, 64, 22, '60,70,255', 0.8);
      x.lineCap = 'round';
      const ribbon = (y0: number, y1: number, w: number, c: string) => {
        x.strokeStyle = c;
        x.lineWidth = w;
        x.beginPath();
        x.moveTo(-6, y0);
        x.bezierCurveTo(16, y0 - 22, 42, y1 + 22, 70, y1);
        x.stroke();
      };
      ribbon(30, 22, 7, 'rgba(255,255,255,.16)');
      ribbon(46, 38, 3, 'rgba(255,255,255,.28)');
      ribbon(20, 8, 2, 'rgba(120,255,240,.35)');
    },
    // The glass itself is rendered per pixel from the background (logo-glass.ts, see drawLogo);
    // only the two text lines – graphic elements, not glass – are painted here.
    fg(x, s) {
      shadow(x, s, 'rgba(20,0,80,.45)', 1.6, 0, 0.6);
      textLines(x, 'rgba(255,255,255,.96)');
      noShadow(x);
    },
  },
  {
    id: 'clear',
    name: 'Kính trong',
    // Background used only where an opaque icon is required (phone app icons): a soft white-grey
    // studio backdrop with a faint cool / warm light, so the icon reads as white clear glass (and
    // not as the Liquid Glass logo). Everywhere else the tile is transparent.
    bg(x) {
      x.fillStyle = lin(x, 0, 0, 64, 64, [[0, '#FBFCFE'], [1, '#D5DBE6']]);
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = rad(x, 8, 6, 0, 8, 6, 34, [[0, 'rgba(150,190,255,.35)'], [1, 'rgba(150,190,255,0)']]);
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = rad(x, 60, 60, 0, 60, 60, 30, [[0, 'rgba(255,170,210,.28)'], [1, 'rgba(255,170,210,0)']]);
      x.fillRect(0, 0, 64, 64);
    },
    fg(x, s) {
      shadow(x, s, 'rgba(20,10,60,.4)', 1.6, 0, 0.6);
      textLines(x, 'rgba(255,255,255,.97)');
      noShadow(x);
    },
  },
  {
    id: 'oil',
    name: 'Sơn dầu',
    bg(x, _s, r) {
      x.fillStyle = '#16306E';
      x.fillRect(0, 0, 64, 64);
      x.lineCap = 'round';
      const pal = ['#1B3C8C', '#2B57B5', '#3D72D6', '#0E2457', '#5C8EE8', '#1F4A9E', '#2A4FA0'];
      for (let i = 0; i < 520; i++) {
        const X = r() * 64, Y = r() * 64;
        const a = Math.atan2(Y - C, X - C) + Math.PI / 2 + (r() - 0.5) * 0.6, L = 3 + r() * 4;
        const c = (Math.cos(a) * L) / 2, d = (Math.sin(a) * L) / 2;
        x.strokeStyle = pick(r, pal);
        x.lineWidth = 1.1 + r() * 1.6;
        x.beginPath();
        x.moveTo(X - c, Y - d);
        x.quadraticCurveTo(X - d * 0.4, Y + c * 0.4, X + c, Y + d);
        x.stroke();
      }
      for (let i = 0; i < 70; i++) {
        const a = r() * TAU, R = 1 + r() * 6.5;
        x.strokeStyle = pick(r, ['#F6C945', '#F9E07F', '#E8A93B', '#FFF1B0']);
        x.lineWidth = 1 + r();
        x.beginPath();
        x.arc(52, 11, R, a, a + 0.6 + r() * 0.6);
        x.stroke();
      }
    },
    fg(x, s, r) {
      shadow(x, s, 'rgba(0,0,25,.45)', 1.5, 0.5, 0.8);
      lens(x, '#EFDDAA', '#EFDDAA', 5.4);
      noShadow(x);
      const cream = ['#FFF8E1', '#F6E7B8', '#FFFFFF', '#EBD39A', '#FDF1C7', '#D9BC78'];
      x.lineCap = 'round';
      for (let i = 0; i < 170; i++) {
        const a = r() * TAU, R = RR + (r() - 0.5) * 4.4, X = C + Math.cos(a) * R, Y = C + Math.sin(a) * R, t = a + Math.PI / 2, L = 2 + r() * 2.6;
        x.strokeStyle = pick(r, cream);
        x.lineWidth = 1.2 + r() * 1.2;
        x.beginPath();
        x.moveTo(X - (Math.cos(t) * L) / 2, Y - (Math.sin(t) * L) / 2);
        x.lineTo(X + (Math.cos(t) * L) / 2, Y + (Math.sin(t) * L) / 2);
        x.stroke();
      }
      for (let i = 0; i < 60; i++) {
        const k = r(), j = (r() - 0.5) * 4.2, L = 1.5 + r() * 2.5;
        const X = H0[0] + (H1[0] - H0[0]) * k + j * 0.707, Y = H0[1] + (H1[1] - H0[1]) * k - j * 0.707;
        x.strokeStyle = pick(r, cream);
        x.lineWidth = 1.2 + r();
        x.beginPath();
        x.moveTo(X - L * 0.35, Y - L * 0.35);
        x.lineTo(X + L * 0.35, Y + L * 0.35);
        x.stroke();
      }
      textLines(x, '#F2B632');
      for (let i = 0; i < 40; i++) {
        const top = r() < 0.6, X = 21 + r() * (top ? 14 : 9), Y = (top ? 25.3 : 31.8) + (r() - 0.5) * 2.6;
        x.strokeStyle = pick(r, ['#FFD95A', '#E39B1B', '#FFE9A0']);
        x.lineWidth = 0.9 + r() * 0.8;
        x.beginPath();
        x.moveTo(X - 1.2, Y);
        x.lineTo(Math.min(X + 1.2, top ? 35 : 30), Y + (r() - 0.5) * 0.6);
        x.stroke();
      }
    },
  },
  {
    id: 'sunset',
    name: 'Hoàng hôn',
    bg(x) {
      x.fillStyle = lin(x, 0, 0, 0, 64, [[0, '#FFC36B'], [0.45, '#FF6F91'], [1, '#6C3CE0']]);
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = rad(x, 47, 19, 0, 47, 19, 14, [[0, 'rgba(255,240,180,.95)'], [0.45, 'rgba(255,220,150,.45)'], [1, 'rgba(255,200,150,0)']]);
      x.fillRect(0, 0, 64, 64);
      x.strokeStyle = 'rgba(255,255,255,.18)';
      x.lineWidth = 0.9;
      x.lineCap = 'round';
      for (const [y, a, w] of [[48, 8, 26], [52, 4, 30], [56, 12, 22], [60, 2, 18]]) {
        x.beginPath();
        x.moveTo(a, y);
        x.lineTo(a + w, y);
        x.moveTo(a + w + 6, y);
        x.lineTo(a + w + 14, y);
        x.stroke();
      }
    },
    fg(x, s) {
      shadow(x, s, 'rgba(90,20,90,.4)', 4, 0, 2);
      x.fillStyle = 'rgba(255,255,255,.2)';
      circle(x, C, C, 11);
      x.fill();
      lens(x, '#FFFFFF');
      noShadow(x);
      textLines(x, '#FFF0B3');
    },
  },
  {
    id: 'clay',
    name: 'Đất sét 3D',
    bg(x) {
      x.fillStyle = rad(x, 14, 10, 2, 32, 32, 60, [[0, '#FFF0E8'], [1, '#FFC8B4']]);
      x.fillRect(0, 0, 64, 64);
    },
    fg(x, s) {
      shadow(x, s, 'rgba(170,80,60,.35)', 5, 2, 3);
      x.fillStyle = '#FFF7F2';
      circle(x, C, C, 12);
      x.fill();
      x.lineCap = 'round';
      x.lineWidth = 6.5;
      x.strokeStyle = lin(x, 42, 42, 52, 52, [[0, '#FFC75F'], [1, '#F29A2E']]);
      handle(x);
      x.stroke();
      x.strokeStyle = lin(x, 14, 12, 42, 44, [[0, '#A3AEFF'], [1, '#4F5DE0']]);
      circle(x, C, C, RR);
      x.stroke();
      noShadow(x);
      x.strokeStyle = 'rgba(255,255,255,.7)';
      x.lineWidth = 1.6;
      x.beginPath();
      x.arc(C, C, 15, 3.5, 4.6);
      x.stroke();
      x.strokeStyle = 'rgba(30,20,90,.22)';
      x.beginPath();
      x.arc(C, C, 13, 0.2, 1.4);
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.65)';
      x.lineWidth = 1.3;
      x.beginPath();
      x.moveTo(41, 40);
      x.lineTo(46, 45);
      x.stroke();
      shadow(x, s, 'rgba(200,80,50,.35)', 1.5, 0, 1);
      textLines(x, '#FF8A65');
      noShadow(x);
    },
  },
  {
    id: 'ink',
    name: 'Thủy mặc',
    bg(x, _s, r) {
      x.fillStyle = '#F3EBDD';
      x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 600; i++) {
        x.fillStyle = `rgba(90,70,40,${0.03 + r() * 0.05})`;
        x.fillRect(r() * 64, r() * 64, 0.4, 0.4);
      }
      x.fillStyle = 'rgba(40,40,45,.10)';
      x.beginPath();
      x.moveTo(0, 64);
      x.lineTo(0, 46);
      x.quadraticCurveTo(12, 34, 22, 46);
      x.quadraticCurveTo(34, 30, 48, 44);
      x.quadraticCurveTo(56, 38, 64, 42);
      x.lineTo(64, 64);
      x.fill();
      x.fillStyle = 'rgba(40,40,45,.16)';
      x.beginPath();
      x.moveTo(0, 64);
      x.lineTo(0, 54);
      x.quadraticCurveTo(16, 46, 30, 55);
      x.quadraticCurveTo(46, 48, 64, 54);
      x.lineTo(64, 64);
      x.fill();
      x.fillStyle = '#C8102E';
      circle(x, 50, 14, 5.5);
      x.fill();
    },
    fg(x, _s, r) {
      x.lineCap = 'round';
      // one brush stroke around the ring: thin → thick → thin
      for (let i = 0; i < 90; i++) {
        const a0 = 0.9 + (i / 90) * (TAU - 0.35);
        x.strokeStyle = `rgba(20,20,24,${0.8 + r() * 0.2})`;
        x.lineWidth = 3 + 3.4 * Math.sin((i / 90) * Math.PI);
        x.beginPath();
        x.arc(C, C, RR + (r() - 0.5) * 0.4, a0, a0 + 0.09);
        x.stroke();
      }
      for (let i = 0; i < 26; i++) {
        const a = 0.9 + r() * 0.5;
        x.strokeStyle = 'rgba(20,20,24,.55)';
        x.lineWidth = 0.35;
        x.beginPath();
        x.arc(C, C, RR + (r() - 0.5) * 4.5, a, a + 0.35);
        x.stroke();
      }
      x.strokeStyle = '#141418';
      for (let i = 0; i < 12; i++) {
        const k = i / 12, d = 13 / 12;
        x.lineWidth = 6 - k * 2.6;
        x.beginPath();
        x.moveTo(H0[0] + 13 * k, H0[1] + 13 * k);
        x.lineTo(H0[0] + 13 * k + d, H0[1] + 13 * k + d);
        x.stroke();
      }
      textLines(x, 'rgba(200,16,46,.85)');
    },
  },
];

export const DEFAULT_LOGO: LogoId = 'glass';
export const logoById = (id: string | undefined): LogoDef => LOGOS.find((l) => l.id === id) ?? LOGOS[0];

export interface DrawOptions {
  /** Liquid Glass only: optical realism level (default "optical"). */
  glass?: GlassVariant;
  /** No rounded corners (phone launchers mask the icon themselves). */
  square?: boolean;
  /** Only the background or only the magnifier (Android adaptive-icon layers). */
  layer?: 'all' | 'bg' | 'fg';
  /** Scale of the magnifier around the centre (keeps it inside Android's safe zone). */
  inset?: number;
  /** Kính trong only: 'transparent' = real alpha (UI, toolbar, files); 'brand' = over the LingoLens
   * colours (opaque phone app icons). */
  backdrop?: 'transparent' | 'brand';
}

/** Draws a logo on a 2D canvas of `size`×`size` px (UI, Chrome toolbar icon, PNG export). */
export function drawLogo(ctx: Ctx, id: string, size: number, opts: DrawOptions = {}) {
  const { square = false, layer = 'all', inset = 1 } = opts;
  const logo = logoById(id);
  if (logo.id === 'glass' && layer !== 'bg') {
    drawGlassLogo(ctx, logo, size, opts);
    return;
  }
  if (logo.id === 'clear' && layer !== 'bg') {
    drawClearLogo(ctx, logo, size, opts);
    return;
  }
  const seed = [...logo.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);
  const s = size / 64;
  ctx.save();
  ctx.scale(s, s);
  tile(ctx, square || layer === 'fg');
  ctx.clip();
  const bg = () => logo.bg(ctx, s, rng(seed), bg);
  if (layer !== 'fg') bg();
  if (layer !== 'bg') {
    ctx.save();
    if (inset !== 1) {
      // centre of the magnifier's bounding box → centre of the tile
      ctx.translate(32, 32);
      ctx.scale(inset, inset);
      ctx.translate(-32.75, -32.75);
    }
    logo.fg(ctx, s * inset, rng(seed + 1), bg);
    ctx.restore();
  }
  ctx.restore();
}

const newCanvas = (n: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(n, n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
};

/**
 * Liquid Glass logo: background painted on its own canvas, then the transparent glass is computed
 * pixel by pixel from it (refraction, dispersion, Fresnel, highlights, shadow, caustic) and the
 * text lines are painted on top.
 */
function drawGlassLogo(ctx: Ctx, logo: LogoDef, size: number, opts: DrawOptions) {
  const { square = false, layer = 'all', inset = 1, glass = 'optical' } = opts;
  const N = Math.max(1, Math.round(size));
  const s = N / 64;
  const seed = 7;
  const bgCanvas = newCanvas(N);
  const bx = bgCanvas.getContext('2d') as Ctx | null;
  if (!bx) return;
  bx.save();
  bx.scale(s, s);
  logo.bg(bx, s, rng(seed), () => {});
  bx.restore();
  const bg = bx.getImageData(0, 0, N, N);
  const out = bx.createImageData(N, N);
  renderGlass(bg.data, out.data, N, GLASS_VARIANTS[glass], layer === 'fg' ? 'fg' : 'all', inset);
  bx.putImageData(out, 0, 0);

  ctx.save();
  ctx.scale(size / 64, size / 64);
  tile(ctx, square || layer === 'fg');
  ctx.clip();
  ctx.drawImage(bgCanvas as CanvasImageSource, 0, 0, 64, 64);
  ctx.translate(32, 32);
  ctx.scale(inset, inset);
  ctx.translate(-32.75, -32.75);
  logo.fg(ctx, (size / 64) * inset, rng(seed + 1), () => {});
  ctx.restore();
}

/**
 * "Kính trong": a tile of white frosted glass (12 %) with a clear optical magnifier and a grey
 * hairline. Transparent by default (what is behind the icon shows through); over the LingoLens
 * colours where an opaque icon is required.
 */
function drawClearLogo(ctx: Ctx, logo: LogoDef, size: number, opts: DrawOptions) {
  const { square = false, inset = 1, backdrop = 'transparent' } = opts;
  const N = Math.max(1, Math.round(size));
  const c = newCanvas(N);
  const cx = c.getContext('2d') as Ctx | null;
  if (!cx) return;
  const out = cx.createImageData(N, N);
  if (backdrop === 'brand') {
    cx.save();
    cx.scale(N / 64, N / 64);
    logo.bg(cx, N / 64, rng(7), () => {});
    cx.restore();
    const under = cx.getImageData(0, 0, N, N);
    renderClear(under.data, out.data, N, CLEAR_OPTICS, inset, square, CLEAR_FROST);
  } else {
    renderClearAlpha(out.data, N, CLEAR_OPTICS, inset, square, CLEAR_FROST);
  }
  cx.putImageData(out, 0, 0);
  ctx.save();
  ctx.scale(size / 64, size / 64);
  tile(ctx, square);
  ctx.clip();
  ctx.drawImage(c as CanvasImageSource, 0, 0, 64, 64);
  ctx.translate(32, 32);
  ctx.scale(inset, inset);
  ctx.translate(-32.75, -32.75);
  logo.fg(ctx, (size / 64) * inset, rng(8), () => {});
  ctx.restore();
}
