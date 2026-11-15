/** Pure image preprocessing helpers for OCR (unit-tested; used by the offscreen document). */

/** Upscale small inputs so typical lettering reaches ~20–30 px x-height; cap total pixels. */
export function computeScale(width: number, height: number, maxPixels = 12_000_000): number {
  const longest = Math.max(width, height);
  if (!longest) return 1;
  let s = Math.min(3, Math.max(1, 1800 / longest));
  if (width * height * s * s > maxPixels) s = Math.sqrt(maxPixels / (width * height));
  return Math.max(0.25, Math.round(s * 100) / 100);
}

/**
 * Grayscale + percentile contrast stretch, in place on RGBA data. Speech bubbles are typically
 * dark text on light background; stretching helps with JPEG artefacts and screentones.
 */
export function grayscaleStretch(data: Uint8ClampedArray, lowPct = 0.01, highPct = 0.99): void {
  const n = data.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const g = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const v = g | 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    hist[v]++;
  }
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * lowPct) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * (1 - highPct)) {
      hi = v;
      break;
    }
  }
  if (hi - lo < 32) return; // flat image – stretching would amplify noise
  const scale = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.max(0, Math.min(255, (data[i] - lo) * scale));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** Clamp a crop rectangle (pixels) to image bounds. Returns null if empty. */
export function clampCrop(c: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  const x = Math.max(0, Math.floor(c.x));
  const y = Math.max(0, Math.floor(c.y));
  const w = Math.min(width - x, Math.ceil(c.w));
  const h = Math.min(height - y, Math.ceil(c.h));
  return w >= 4 && h >= 4 ? { x, y, w, h } : null;
}

export const PSM: Record<'sparse' | 'auto' | 'block', string> = { sparse: '11', auto: '3', block: '6' };
