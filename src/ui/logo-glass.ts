/**
 * Transparent optical-glass renderer for the LingoLens magnifier (the "Liquid Glass" logo).
 *
 * The glass is not painted with a fill: every pixel of the lens, the ring and the handle is computed
 * from the background behind it, like a ray tracer with one bounce:
 *   - refraction: the lens magnifies what is behind it, the ring and handle (round glass tubes)
 *     bend the background towards their centre line;
 *   - dispersion: red / green / blue are refracted by slightly different amounts at the edges;
 *   - Fresnel reflection of a soft studio environment, growing towards grazing edges;
 *   - specular highlights from a top-left light, plus an internal reflection on the far side;
 *   - the glass casts a light shadow and focuses a caustic onto the background.
 * Everything else (the background, the two text lines) is drawn by logo-data.ts.
 * Units: the 64×64 logo grid (lens centre 28,28; ring radius 14; ring and handle 6 units thick).
 */

export interface Optics {
  /** Lens magnification (the background inside the lens appears this many times larger). */
  magnify: number;
  /** How strongly the round ring / handle bend the background towards their centre line (0–1). */
  bend: number;
  /** Colour separation at the edges (fraction of the refraction offset). */
  dispersion: number;
  /** Strength of the Fresnel reflection at grazing angles. */
  fresnel: number;
  /** Specular highlight strength. */
  spec: number;
  /** Internal reflection on the far (bottom-right) side of the tubes. */
  inner: number;
  /** Darkening of the very edge (light lost by total internal reflection) – defines the outline. */
  edge: number;
  /** Shadow cast on the background. */
  shadow: number;
  /** Light focused by the lens onto the background. */
  caustic: number;
  /** Thin grey hairline around the tile and the magnifier (0 = none) – keeps white glass visible on
   * white pages and light toolbars. */
  outline?: number;
}

/** Three levels of optical realism (compared in the design review; "optical" ships). */
export const GLASS_VARIANTS = {
  clear: { magnify: 1.12, bend: 0.35, dispersion: 0, fresnel: 0.45, spec: 0.6, inner: 0.15, edge: 0.22, shadow: 0.12, caustic: 0 },
  optical: { magnify: 1.28, bend: 0.6, dispersion: 0.18, fresnel: 0.7, spec: 0.9, inner: 0.35, edge: 0.3, shadow: 0.2, caustic: 0.22 },
  crystal: { magnify: 1.45, bend: 0.85, dispersion: 0.4, fresnel: 0.9, spec: 1.1, inner: 0.55, edge: 0.38, shadow: 0.28, caustic: 0.4 },
} satisfies Record<string, Optics>;
export type GlassVariant = keyof typeof GLASS_VARIANTS;

const C = 28;
const R_RING = 14;
const W = 3; // half thickness of the ring and the handle
const R_LENS = R_RING - W; // 11
const H0x = 38.5, H0y = 38.5, H1x = 51.5, H1y = 51.5;
// light from the top-left, towards the viewer
const LIGHT = norm3(-0.55, -0.65, 0.52);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
// where the shadow / caustic fall (units)
const SHADOW_DX = 1.4, SHADOW_DY = 2.2;

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Hairline along an edge: dist = distance (units) from the edge, inwards; px = units per pixel.
 * At least one pixel wide so it survives at 16 px.
 */
const hairline = (dist: number, px: number) => {
  const w = Math.max(0.42, px * 1.1);
  return 1 - smooth(w * 0.55, w * 1.25, dist);
};
const LINE_R = 72, LINE_G = 80, LINE_B = 98;

interface Hit {
  /** 0 = outside, 1 = inside (anti-aliased coverage). */
  cov: number;
  kind: 'tube' | 'lens' | 'none';
  /** tube: distance from the centre line / half thickness (0 centre … 1 edge); lens: r / R_LENS. */
  t: number;
  /** unit direction away from the centre line (tube) or from the lens centre (lens). */
  dx: number;
  dy: number;
  /** distance from the centre line (tube) or from the lens centre (lens), in units. */
  d: number;
}

/** Smooth minimum: ring and handle melt into one piece of glass instead of a hard seam. */
function smin(p: number, q: number, k: number) {
  const h = clamp01(0.5 + (0.5 * (q - p)) / k);
  return q * (1 - h) + p * h - k * h * (1 - h);
}

/** Signed distance (units) from the surface of the glass body (ring ∪ handle); < 0 = inside. */
function body(x: number, y: number) {
  const dRing = Math.abs(Math.hypot(x - C, y - C) - R_RING) - W;
  const hx = H1x - H0x, hy = H1y - H0y;
  const k = clamp01(((x - H0x) * hx + (y - H0y) * hy) / (hx * hx + hy * hy));
  const dH = Math.hypot(x - (H0x + hx * k), y - (H0y + hy * k)) - W;
  return smin(dRing, dH, 1.6);
}

/** Which glass part covers the point (x, y) in logo units; aa = units per pixel. */
function hit(x: number, y: number, aa: number): Hit {
  const f = body(x, y);
  const cov = clamp01(-f / aa + 0.5);
  if (cov > 0) {
    // surface direction from the distance field's gradient (smooth through the ring–handle joint)
    const e = 0.04;
    let gx = body(x + e, y) - body(x - e, y);
    let gy = body(x, y + e) - body(x, y - e);
    const gl = Math.hypot(gx, gy) || 1;
    gx /= gl;
    gy /= gl;
    const d = Math.max(0, f + W); // distance from the centre line
    return { cov, kind: 'tube', t: Math.min(1, d / W), dx: gx, dy: gy, d };
  }
  const rx = x - C, ry = y - C;
  const r = Math.hypot(rx, ry) || 1e-6;
  if (r < R_LENS + aa) {
    return { cov: clamp01((R_LENS - r) / aa + 0.5), kind: 'lens', t: Math.min(1, r / R_LENS), dx: rx / r, dy: ry / r, d: r };
  }
  return { cov: 0, kind: 'none', t: 0, dx: 0, dy: 0, d: 0 };
}

/**
 * Renders the glass into `out` (RGBA, N×N) over the background `bg` (RGBA, N×N, the full square).
 * mode 'all' = background + glass; 'fg' = only the glass, its shadow and caustic (transparent
 * elsewhere – the Android foreground layer over the background layer).
 * inset scales the magnifier around the tile centre (Android safe zone).
 */
export function renderGlass(bg: Uint8ClampedArray, out: Uint8ClampedArray, N: number, o: Optics, mode: 'all' | 'fg', inset = 1) {
  const s = (N / 64) * inset; // pixels per glass unit
  const aa = 1 / s;
  const small = N / 64 <= 0.6; // toolbar sizes: stronger outline so the silhouette survives
  const edgeK = small ? Math.min(1, o.edge * 2.2) : o.edge;
  const fresK = small ? Math.min(1.2, o.fresnel * 1.5) : o.fresnel;
  // 0 at ≥ 64 px, up to 0.55 at 16 px
  const rimK = clamp01((64 - N) / 48) * 0.55;
  // glass units → pixel position in the background
  const toPx = (u: number) => ((u - 32.75) * inset + 32) * (N / 64);
  const toUnit = (p: number) => (p / (N / 64) - 32) / inset + 32.75;

  // 1) background lit by the glass: shadow + caustic (pre-pass, so refraction also sees it)
  const lit = new Float32Array(N * N * 3);
  const over = new Float32Array(N * N * 2); // fg mode: [darken, brighten] overlay
  for (let j = 0; j < N; j++) {
    const uy = toUnit(j + 0.5);
    for (let i = 0; i < N; i++) {
      const ux = toUnit(i + 0.5);
      const p = (j * N + i) * 4;
      let dark = 0, light = 0;
      if (o.shadow > 0 || o.caustic > 0) {
        const sx = ux - SHADOW_DX, sy = uy - SHADOW_DY;
        const h = hit(sx, sy, 1.6); // soft: wide anti-aliasing = penumbra
        if (h.kind === 'tube') dark = h.cov * o.shadow * (1 - h.t * 0.5);
        else if (h.kind === 'lens') {
          dark = h.cov * o.shadow * 0.35;
          light = h.cov * o.caustic * (1 - h.t) ** 2;
        }
      }
      const q = (j * N + i) * 3;
      for (let c = 0; c < 3; c++) lit[q + c] = bg[p + c] * (1 - dark) + 255 * light * (1 - bg[p + c] / 255) * 0.9;
      over[(j * N + i) * 2] = dark;
      over[(j * N + i) * 2 + 1] = light;
    }
  }
  const sample = (x: number, y: number, c: number) => {
    // bilinear, clamped
    const fx = Math.min(N - 1.001, Math.max(0, x - 0.5));
    const fy = Math.min(N - 1.001, Math.max(0, y - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const a = lit[(y0 * N + x0) * 3 + c], b = lit[(y0 * N + x0 + 1) * 3 + c];
    const d = lit[((y0 + 1) * N + x0) * 3 + c], e = lit[((y0 + 1) * N + x0 + 1) * 3 + c];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  };

  // 2) glass
  for (let j = 0; j < N; j++) {
    const uy = toUnit(j + 0.5);
    for (let i = 0; i < N; i++) {
      const ux = toUnit(i + 0.5);
      const p = (j * N + i) * 4;
      const q = (j * N + i) * 3;
      const h = hit(ux, uy, aa);
      const baseR = lit[q], baseG = lit[q + 1], baseB = lit[q + 2];
      if (h.cov <= 0) {
        if (mode === 'all') {
          out[p] = baseR;
          out[p + 1] = baseG;
          out[p + 2] = baseB;
          out[p + 3] = 255;
        } else {
          const dk = over[(j * N + i) * 2], li = over[(j * N + i) * 2 + 1];
          // shadow as black, caustic as white, whichever dominates
          if (li > dk) {
            out[p] = out[p + 1] = out[p + 2] = 255;
            out[p + 3] = Math.round(li * 160);
          } else {
            out[p] = out[p + 1] = out[p + 2] = 0;
            out[p + 3] = Math.round(dk * 255);
          }
        }
        continue;
      }

      // surface normal + refraction offset (in units)
      let nx: number, ny: number, nz: number, offU: number;
      if (h.kind === 'tube') {
        const t = h.t;
        nz = Math.sqrt(Math.max(0, 1 - t * t));
        nx = h.dx * t;
        ny = h.dy * t;
        // a round glass rod shows the background compressed towards its centre line
        offU = -h.d * o.bend * (0.55 + 0.45 * t * t);
      } else {
        const t = h.t;
        const slope = t * 0.42; // gentle dome
        nz = Math.sqrt(1 - slope * slope);
        nx = h.dx * slope;
        ny = h.dy * slope;
        // magnifier: sample closer to the lens centre (+ a touch of barrel distortion at the rim)
        offU = -h.d * (1 - 1 / o.magnify) * (1 + 0.18 * t * t);
      }
      const ox = h.dx * offU * s, oy = h.dy * offU * s;
      const cx = i + 0.5, cy = j + 0.5;
      const disp = o.dispersion * (h.kind === 'tube' ? 0.5 + h.t : h.t * h.t);
      let r = sample(cx + ox * (1 + disp), cy + oy * (1 + disp), 0);
      let g = sample(cx + ox, cy + oy, 1);
      let b = sample(cx + ox * (1 - disp), cy + oy * (1 - disp), 2);

      // clear glass absorbs very little: a faint cool tint and slight brightening
      r = r * 0.97 + 4;
      g = g * 0.985 + 5;
      b = b * 1.0 + 7;

      // grey hairline along the glass edge
      if (o.outline && h.kind === 'tube') {
        const k = hairline(W - h.d, aa) * o.outline;
        r = r * (1 - k) + LINE_R * k;
        g = g * (1 - k) + LINE_G * k;
        b = b * (1 - k) + LINE_B * k;
      }
      // light lost at the very edge of the rod (total internal reflection) – the glass outline
      if (h.kind === 'tube') {
        const e = smooth(0.72, 1, h.t) * edgeK;
        r *= 1 - e;
        g *= 1 - e;
        b *= 1 - e * 0.85;
      } else {
        const e = smooth(0.86, 1, h.t) * edgeK * 0.5;
        r *= 1 - e;
        g *= 1 - e;
        b *= 1 - e * 0.85;
      }

      // Fresnel reflection of a soft studio environment (bright above-left, dimmer below)
      const cosT = nz;
      const fres = Math.min(1, fresK * (1 - cosT) ** 3 + 0.03);
      const envUp = clamp01(0.5 - 0.6 * (nx * 0.6 + ny * 0.8));
      const envR = 140 + 115 * envUp, envG = 150 + 105 * envUp, envB = 190 + 65 * envUp;
      r = r * (1 - fres) + envR * fres;
      g = g * (1 - fres) + envG * fres;
      b = b * (1 - fres) + envB * fres;

      // specular highlights (Blinn): a sharp key light + a broad soft one
      const nh = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
      let spec = o.spec * (nh ** (h.kind === 'tube' ? 90 : 220) * 1.1 + nh ** 14 * (h.kind === 'tube' ? 0.12 : 0.06));
      // internal reflection: light that bounced inside shows on the far side of the rod
      if (h.kind === 'tube') {
        const far = Math.max(0, h.dx * 0.7071 + h.dy * 0.7071);
        spec += o.inner * far * smooth(0.45, 0.85, h.t) * (1 - smooth(0.9, 1, h.t)) * 0.75;
      }
      // tiny icons: a light rim along the edge (fine reflections vanish at 16–48 px)
      if (rimK > 0) spec += rimK * (h.kind === 'tube' ? smooth(0.5, 0.95, h.t) : smooth(0.8, 1, h.t) * 0.6);
      r += 255 * spec;
      g += 255 * spec;
      b += 255 * spec;

      const a = h.cov;
      if (mode === 'all') {
        out[p] = baseR * (1 - a) + r * a;
        out[p + 1] = baseG * (1 - a) + g * a;
        out[p + 2] = baseB * (1 - a) + b * a;
        out[p + 3] = 255;
      } else {
        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
        out[p + 3] = Math.round(255 * a);
      }
    }
  }
  return toPx; // (exposed for callers that need the mapping)
}

// ---------------------------------------------------------------- clear glass tile ("transparent background")

/** Signed distance (units) to the rounded-square tile (64×64, corner radius 15); < 0 = inside. */
function tileSd(x: number, y: number, square: boolean) {
  const r = square ? 0.001 : 15;
  const qx = Math.abs(x - 32) - (32 - r), qy = Math.abs(y - 32) - (32 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * The icon tile as a slab of clear glass: whatever is behind the icon (wallpaper, web page) shows
 * through, bent at the rounded bevel along the edge, with Fresnel reflection, a specular edge light
 * and a faint studio reflection across the face. `backdrop` and `out` are RGBA N×N (the area under
 * the icon); pixels outside the rounded tile keep the backdrop.
 */
/** Box blur (3 passes ≈ gaussian) of an RGBA image, radius in pixels. */
function blurRGBA(src: Uint8ClampedArray, N: number, radius: number): Float32Array {
  const rad = Math.max(1, Math.round(radius));
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      for (let line = 0; line < N; line++) {
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          const idx = (k: number) => {
            const kk = k < 0 ? 0 : k >= N ? N - 1 : k;
            return (horizontal ? line * N + kk : kk * N + line) * 4 + c;
          };
          for (let k = -rad; k <= rad; k++) acc += a[idx(k)];
          for (let k = 0; k < N; k++) {
            b[idx(k)] = acc / (2 * rad + 1);
            acc += a[idx(k + rad + 1)] - a[idx(k - rad)];
          }
        }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

/**
 * frost (0…1) = opacity of the tile: the backdrop is blurred and covered by a LingoLens
 * blue→violet tint of that strength (0 = perfectly clear glass).
 */
export function renderSlab(backdrop: Uint8ClampedArray, out: Uint8ClampedArray, N: number, o: Optics, square = false, frost = 0) {
  const s = N / 64;
  const aa = 1 / s;
  const BEVEL = 3.2;
  const src: ArrayLike<number> = frost > 0 ? blurRGBA(backdrop, N, 2.4 * s * Math.min(1, frost * 2)) : backdrop;
  const sample = (x: number, y: number, c: number) => {
    const fx = Math.min(N - 1.001, Math.max(0, x - 0.5));
    const fy = Math.min(N - 1.001, Math.max(0, y - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const at = (xx: number, yy: number) => src[(yy * N + xx) * 4 + c];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  for (let j = 0; j < N; j++) {
    const uy = (j + 0.5) / s;
    for (let i = 0; i < N; i++) {
      const ux = (i + 0.5) / s;
      const p = (j * N + i) * 4;
      const sd = tileSd(ux, uy, square);
      const cov = clamp01(-sd / aa + 0.5);
      const br = backdrop[p], bgc = backdrop[p + 1], bb = backdrop[p + 2];
      if (cov <= 0) {
        out[p] = br;
        out[p + 1] = bgc;
        out[p + 2] = bb;
        out[p + 3] = 255;
        continue;
      }
      const depth = -sd; // distance from the edge, inwards
      const t = clamp01(1 - depth / BEVEL); // 1 at the edge … 0 where the flat face starts
      // outward direction (gradient of the distance field)
      const e = 0.05;
      let gx = tileSd(ux + e, uy, square) - tileSd(ux - e, uy, square);
      let gy = tileSd(ux, uy + e, square) - tileSd(ux, uy - e, square);
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl;
      gy /= gl;
      // rounded bevel: quarter-circle profile
      const slope = t > 0 ? Math.sqrt(1 - (1 - t) * (1 - t)) : 0;
      const nx = gx * slope * 0.9, ny = gy * slope * 0.9;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      // the bevel bends the backdrop inwards (compressed band along the edge)
      const offU = -(BEVEL * 0.9) * o.bend * t * t;
      const ox = gx * offU * s, oy = gy * offU * s;
      const disp = o.dispersion * t;
      let r = sample(i + 0.5 + ox * (1 + disp), j + 0.5 + oy * (1 + disp), 0);
      let g = sample(i + 0.5 + ox, j + 0.5 + oy, 1);
      let b = sample(i + 0.5 + ox * (1 - disp), j + 0.5 + oy * (1 - disp), 2);
      // clear glass: almost no absorption, a faint cool lift
      r = r * 0.97 + 5;
      g = g * 0.98 + 6;
      b = b * 0.99 + 10;
      if (frost > 0) {
        // white frosted glass (milky): brightest at the top-left, a touch greyer towards the
        // bottom-right so the slab keeps some depth; no colour cast
        const d = clamp01((ux + uy) / 128);
        const w = 255 - 22 * d;
        r = r * (1 - frost) + w * frost;
        g = g * (1 - frost) + w * frost;
        b = b * (1 - frost) + Math.min(255, w + 3) * frost;
      }
      // grey hairline along the tile edge
      if (o.outline) {
        const k = hairline(depth, aa) * o.outline;
        r = r * (1 - k) + LINE_R * k;
        g = g * (1 - k) + LINE_G * k;
        b = b * (1 - k) + LINE_B * k;
      }
      // light lost at the very rim
      const dark = smooth(0.75, 1, t) * o.edge * 0.8;
      r *= 1 - dark;
      g *= 1 - dark;
      b *= 1 - dark * 0.85;
      // Fresnel + soft studio environment
      const fres = Math.min(1, o.fresnel * 0.8 * (1 - nz) ** 2.5 + 0.025);
      const envUp = clamp01(0.5 - 0.6 * (gx * 0.6 + gy * 0.8));
      r = r * (1 - fres) + (140 + 115 * envUp) * fres;
      g = g * (1 - fres) + (150 + 105 * envUp) * fres;
      b = b * (1 - fres) + (190 + 65 * envUp) * fres;
      // specular edge light (top-left) + faint reflection across the face
      const nh = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
      let spec = o.spec * (nh ** 60 * 0.9 + nh ** 10 * 0.06) * smooth(0.05, 0.4, t);
      const diag = (ux + uy) / 128; // 0 top-left … 1 bottom-right
      spec += 0.07 * (1 - smooth(0.15, 0.55, diag)) * (1 - t);
      r += 255 * spec;
      g += 255 * spec;
      b += 255 * spec;
      out[p] = br * (1 - cov) + r * cov;
      out[p + 1] = bgc * (1 - cov) + g * cov;
      out[p + 2] = bb * (1 - cov) + b * cov;
      out[p + 3] = 255;
    }
  }
}

/** Clear glass icon over a known backdrop: glass tile, then the glass magnifier on top of it. */
export function renderClear(backdrop: Uint8ClampedArray, out: Uint8ClampedArray, N: number, o: Optics, inset = 1, square = false, frost = 0) {
  const slab = new Uint8ClampedArray(N * N * 4);
  renderSlab(backdrop, slab, N, o, square, frost);
  renderGlass(slab, out, N, o, 'all', inset);
}

/**
 * The clear icon as a PNG with real alpha, for when the backdrop is unknown (toolbar icon, files):
 * rendered over black and over white, then un-composited (difference matting). Transparency,
 * reflections and highlights survive; refraction of the unknown backdrop cannot be baked in.
 */
export function renderClearAlpha(out: Uint8ClampedArray, N: number, o: Optics, inset = 1, square = false, frost = 0) {
  const black = new Uint8ClampedArray(N * N * 4), white = new Uint8ClampedArray(N * N * 4);
  for (let p = 0; p < N * N * 4; p += 4) {
    black[p + 3] = 255;
    white[p] = white[p + 1] = white[p + 2] = white[p + 3] = 255;
  }
  const onBlack = new Uint8ClampedArray(N * N * 4), onWhite = new Uint8ClampedArray(N * N * 4);
  renderClear(black, onBlack, N, { ...o, shadow: 0, caustic: 0 }, inset, square, frost);
  renderClear(white, onWhite, N, { ...o, shadow: 0, caustic: 0 }, inset, square, frost);
  for (let p = 0; p < N * N * 4; p += 4) {
    const a = clamp01(1 - (onWhite[p] - onBlack[p] + onWhite[p + 1] - onBlack[p + 1] + onWhite[p + 2] - onBlack[p + 2]) / (3 * 255));
    out[p + 3] = Math.round(a * 255);
    for (let c = 0; c < 3; c++) out[p + c] = a > 0.004 ? Math.min(255, onBlack[p + c] / a) : 0;
  }
}

/** Approved "Kính trong" logo: optical glass + grey hairline, white frosted tile at 12 % opacity. */
export const CLEAR_OPTICS: Optics = { ...GLASS_VARIANTS.optical, outline: 0.55 };
export const CLEAR_FROST = 0.12;
