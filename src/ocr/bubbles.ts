/**
 * Speech-bubble detection for full-page OCR (pure, unit-tested; used by the offscreen document).
 *
 * Manga dialogue sits in light balloons enclosed by a dark outline. Starting from the light pixels
 * inside a text cluster found by the first OCR pass, a flood fill over light pixels recovers the
 * balloon interior. Its per-row spans give a mask that keeps the whole balloon (including lines the
 * first pass missed) and blanks the artwork around it before the second, per-bubble OCR pass.
 * When the fill leaks (open balloon, text on a white page margin, text on artwork) the caller falls
 * back to a padded box around the text.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleRegion {
  /** Bounding box of the balloon interior (pixels of the analysed image). */
  box: Rect;
  /** For each row y in box: [minX, maxX] of the interior, or [-1, -1] when the row is empty. */
  spans: Int32Array;
  area: number;
}

/**
 * Flood-fills light pixels (gray >= threshold, 4-connected) from the light pixels inside `seed`.
 * Returns null when there is no light seed or the fill exceeds `maxArea` (it leaked out of a balloon).
 */
export function floodBubble(gray: Uint8Array, width: number, height: number, seed: Rect, threshold = 200, maxArea = width * height * 0.2): BubbleRegion | null {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const x0 = Math.max(0, Math.floor(seed.x));
  const y0 = Math.max(0, Math.floor(seed.y));
  const x1 = Math.min(width - 1, Math.ceil(seed.x + seed.w));
  const y1 = Math.min(height - 1, Math.ceil(seed.y + seed.h));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (gray[i] >= threshold && !seen[i]) {
        seen[i] = 1;
        stack.push(i);
      }
    }
  }
  if (!stack.length) return null;
  let area = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const filled: number[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    area++;
    if (area > maxArea) return null;
    filled.push(i);
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const push = (j: number) => {
      const jx = j % width;
      const jy = (j - jx) / width;
      const inSeed = jx >= x0 && jx <= x1 && jy >= y0 && jy <= y1;
      if (!seen[j] && (gray[j] >= threshold || inSeed)) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  const h = maxY - minY + 1;
  const spans = new Int32Array(h * 2).fill(-1);
  for (const i of filled) {
    const x = i % width;
    const r = ((i - x) / width - minY) * 2;
    if (spans[r] === -1 || x < spans[r]) spans[r] = x;
    if (x > spans[r + 1]) spans[r + 1] = x;
  }
  return { box: { x: minX, y: minY, w: maxX - minX + 1, h }, spans, area };
}

/** True when the region touches the image border on a long stretch (page margin, not a balloon). */
export function touchesBorder(r: BubbleRegion, width: number, height: number): boolean {
  const { x, y, w, h } = r.box;
  const tol = 1;
  const edges = [x <= tol ? h : 0, y <= tol ? w : 0, x + w >= width - tol ? h : 0, y + h >= height - tol ? w : 0];
  return edges.some((len) => len > Math.min(width, height) * 0.25);
}

/** Expands a rectangle by `pad` on every side, clamped to the image. */
export function padRect(r: Rect, pad: number, width: number, height: number): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return { x, y, w: Math.min(width, r.x + r.w + pad) - x, h: Math.min(height, r.y + r.h + pad) - y };
}

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Plausibility of recognised text (filters artwork read as characters): enough letters, at least
 * one real-looking word, decent confidence. `enclosed` = text was found inside a balloon.
 */
export function plausibleText(text: string, confidence: number, enclosed: boolean): boolean {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const visible = text.replace(/\s/g, '').length;
  if (!letters || letters / Math.max(1, visible) < 0.5) return false;
  const words = text.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
  // a "word": 2+ letters containing a vowel (or y), or the pronoun I / article A
  const real = words.filter((w) => (w.length >= 2 && /[aeiouy]/i.test(w)) || w === 'I' || w === 'A');
  if (!real.length) return false;
  if (letters <= 1) return confidence >= 70; // a lone "I" / "A"
  // short fragments ("fay", "NDE") are usually artwork: demand more confidence
  if (letters <= 3 && !/^(I|A|OK|NO|OH|AH|EH|HUH|HEY|WHO|WHY|YES|YOU|HIM|HER|WHAT)\W*$/i.test(text.trim())) return confidence >= 80;
  if (enclosed) return confidence >= 45 && (letters >= 2 || real.length > 0);
  // outside balloons (narration on art, sound effects): stricter
  return confidence >= 70 && letters >= 3;
}

/** Union of two balloon masks (row spans widened to cover both). */
export function mergeMasks(a: BubbleRegion, b: BubbleRegion): BubbleRegion {
  const x = Math.min(a.box.x, b.box.x);
  const y = Math.min(a.box.y, b.box.y);
  const x2 = Math.max(a.box.x + a.box.w, b.box.x + b.box.w);
  const y2 = Math.max(a.box.y + a.box.h, b.box.y + b.box.h);
  const h = y2 - y;
  const spans = new Int32Array(h * 2).fill(-1);
  for (const m of [a, b]) {
    for (let r = 0; r < m.box.h; r++) {
      const lo = m.spans[r * 2];
      if (lo < 0) continue;
      const k = (m.box.y + r - y) * 2;
      spans[k] = spans[k] < 0 ? lo : Math.min(spans[k], lo);
      spans[k + 1] = Math.max(spans[k + 1], m.spans[r * 2 + 1]);
    }
  }
  return { box: { x, y, w: x2 - x, h }, spans, area: a.area + b.area };
}

/** Share of upper-case letters (manga lettering is almost always ALL CAPS). */
export function upperRatio(text: string): number {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  return letters.length ? letters.filter((c) => c === c.toUpperCase()).length / letters.length : 0;
}

/**
 * On an ALL-CAPS page, lower-case tokens are almost always artwork read as letters ("vv,", "plas"):
 * drop short all-lower-case tokens, and report the block as noise when most of it is lower case.
 */
export function cleanCapsText(text: string, confidence: number): string | null {
  if (upperRatio(text) < 0.5 && confidence < 85) return null;
  let kept = text.split(/\s+/).filter((t) => !(/^[^A-Z]*[a-z][^A-Z]*$/.test(t) && t.replace(/[^a-z]/g, '').length <= 4));
  // mixed-case scraps at the edges of a bubble ("Fa THE PERPETRATOR…") come from the artwork around it
  const scrap = (t: string) => /[a-z]/.test(t) && t.replace(/[^A-Za-z]/g, '').length <= 3 && !SHORT_WORDS.has(t.replace(/[^A-Za-z]/g, '').toLowerCase());
  while (kept.length > 1 && scrap(kept[0])) kept = kept.slice(1);
  while (kept.length > 1 && scrap(kept[kept.length - 1])) kept = kept.slice(0, -1);
  const out = kept.join(' ').trim();
  return out || null;
}

/** Widens a mask so it fully contains `r` (e.g. a text line that belongs to the balloon). */
export function extendMask(m: BubbleRegion, r: Rect): BubbleRegion {
  const rx0 = Math.floor(r.x);
  const ry0 = Math.floor(r.y);
  const rx1 = Math.ceil(r.x + r.w);
  const ry1 = Math.ceil(r.y + r.h);
  const x = Math.min(m.box.x, rx0);
  const y = Math.min(m.box.y, ry0);
  const x2 = Math.max(m.box.x + m.box.w, rx1);
  const y2 = Math.max(m.box.y + m.box.h, ry1);
  const h = y2 - y;
  const spans = new Int32Array(h * 2).fill(-1);
  for (let row = 0; row < m.box.h; row++) {
    const k = (m.box.y + row - y) * 2;
    spans[k] = m.spans[row * 2];
    spans[k + 1] = m.spans[row * 2 + 1];
  }
  for (let yy = ry0; yy < ry1; yy++) {
    const k = (yy - y) * 2;
    spans[k] = spans[k] < 0 ? rx0 : Math.min(spans[k], rx0);
    spans[k + 1] = Math.max(spans[k + 1], rx1);
  }
  return { box: { x, y, w: x2 - x, h }, spans, area: m.area };
}

/**
 * Finds closed speech balloons directly from the artwork (light blobs of balloon size and shape
 * that contain dark strokes), so balloons whose text the first OCR pass missed entirely are read too.
 */
export function findBalloons(gray: Uint8Array, width: number, height: number, threshold = 200): BubbleRegion[] {
  const total = width * height;
  const label = new Int32Array(total);
  const out: BubbleRegion[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < total; start++) {
    if (label[start] || gray[start] < threshold) continue;
    const id = next++;
    label[start] = id;
    stack.push(start);
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !label[i - 1] && gray[i - 1] >= threshold) (label[i - 1] = id), stack.push(i - 1);
      if (x < width - 1 && !label[i + 1] && gray[i + 1] >= threshold) (label[i + 1] = id), stack.push(i + 1);
      if (y > 0 && !label[i - width] && gray[i - width] >= threshold) (label[i - width] = id), stack.push(i - width);
      if (y < height - 1 && !label[i + width] && gray[i + width] >= threshold) (label[i + width] = id), stack.push(i + width);
    }
    const area = pixels.length;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (area < total * 0.0015 || area > total * 0.06) continue;
    if (minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2) continue; // page margin
    if (w / h > 4 || h / w > 4) continue;
    const spans = new Int32Array(h * 2).fill(-1);
    for (const i of pixels) {
      const x = i % width;
      const r = ((i - x) / width - minY) * 2;
      if (spans[r] === -1 || x < spans[r]) spans[r] = x;
      if (x > spans[r + 1]) spans[r + 1] = x;
    }
    // area inside the outline (row spans) vs light area → the rest are holes = lettering
    let inside = 0;
    for (let r = 0; r < h; r++) if (spans[r * 2] >= 0) inside += spans[r * 2 + 1] - spans[r * 2] + 1;
    const fill = inside / (w * h);
    const ink = 1 - area / Math.max(1, inside);
    if (fill < 0.55 || ink < 0.03 || ink > 0.45) continue; // not balloon-shaped / no text / mostly artwork
    out.push({ box: { x: minX, y: minY, w, h }, spans, area });
  }
  return out;
}

/** Common 1–2 letter English words (short bubbles like "IT WAS…", "NO!", "OH"). */
const SHORT_WORDS = new Set(
  'a i am an as at be by do go he hi if in is it me my no of oh ok on or so to up us we ah eh uh um ha yo ya'.split(' '),
);

/** Words that make a whole speech bubble on their own. */
const STANDALONE = new Set('i it no oh ah eh huh hey yes yeah what who why hmm uh ok okay wow ha hah wha eek ugh hm'.split(' '));

/** Words of 3+ letters in an OCR text (contractions reduced to their stem). */
export function longWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z'’]*/g) ?? []).map((w) => w.replace(/['’](s|re|ve|ll|d|m|t)$/i, '').replace(/['’]/g, '')).filter((w) => w.length >= 3);
}

/**
 * Dictionary check of a bubble: `known` = how many of its 3+ letter words exist in the bundled
 * lexicon. Keeps real dialogue, drops artwork that Tesseract "read" (tree texture, chandeliers…).
 */
export function looksLikeWords(text: string, known: number, enclosed: boolean): boolean {
  const tokens0 = text.match(/[A-Za-z]+/g) ?? [];
  // a lone short token ("THe,", "A") is only dialogue when it can stand alone ("I…", "NO!", "WHAT?!")
  if (tokens0.length === 1 && tokens0[0].length <= 4) return enclosed && STANDALONE.has(tokens0[0].toLowerCase());
  const long = longWords(text);
  if (long.length) return known / long.length >= 0.5;
  // only 1–2 letter tokens: keep "IT", "NO!", "OH" inside a balloon
  const tokens = (text.match(/[A-Za-z]+/g) ?? []).map((t) => t.toLowerCase());
  return enclosed && tokens.length > 0 && tokens.every((t) => SHORT_WORDS.has(t));
}
