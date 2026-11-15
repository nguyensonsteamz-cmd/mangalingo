/**
 * Converts raw Tesseract output into LingoLens OCR blocks: confidence filtering, noise cleanup,
 * coordinate normalisation (0..1 of the scanned target) and grouping of nearby lines into
 * speech-bubble-like blocks.
 */
import type { Box, OcrBlock, OcrLine, OcrWord } from '@/shared/types';

export interface RawBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface RawWord {
  text: string;
  confidence: number;
  bbox: RawBBox;
}
export interface RawLine {
  text?: string;
  confidence?: number;
  bbox: RawBBox;
  words: RawWord[];
}
export interface RawBlock {
  paragraphs?: { lines: RawLine[] }[];
  lines?: RawLine[];
}

const NOISE = /^[|~_=\\/<>{}[\]^`°•·.,'"\-–—:;]+$/u;

export function cleanWord(text: string): string {
  return text
    .replace(/[|]/g, 'I') // common OCR confusion in manga fonts: "|" for "I"
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function norm(b: RawBBox, w: number, h: number): Box {
  return {
    x: Math.max(0, b.x0 / w),
    y: Math.max(0, b.y0 / h),
    w: Math.max(0, (b.x1 - b.x0) / w),
    h: Math.max(0, (b.y1 - b.y0) / h),
  };
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Flattens Tesseract blocks into filtered lines with normalised coordinates. */
export function extractLines(blocks: RawBlock[], width: number, height: number, threshold: number): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const b of blocks ?? []) {
    const rawLines = b.paragraphs ? b.paragraphs.flatMap((p) => p.lines) : (b.lines ?? []);
    for (const l of rawLines) {
      const words: OcrWord[] = [];
      for (const w of l.words ?? []) {
        const text = cleanWord(w.text ?? '');
        if (!text || NOISE.test(text)) continue;
        if (w.confidence < threshold) continue;
        // single letters other than I/A/O with mediocre confidence are usually screentone noise
        if (text.length === 1 && !/[IAOaio0-9!?]/.test(text) && w.confidence < 80) continue;
        // even "I"/"A" alone with low confidence is usually a bubble tail or panel border
        if (text.length === 1 && w.confidence < 75) continue;
        words.push({ text, confidence: Math.round(w.confidence), box: norm(w.bbox, width, height) });
      }
      if (!words.length) continue;
      const letters = words.map((w) => w.text).join('').replace(/[^\p{L}]/gu, '').length;
      if (letters === 0) continue;
      const box = words.slice(1).reduce((acc, w) => union(acc, w.box), words[0].box);
      lines.push({
        text: words.map((w) => w.text).join(' '),
        confidence: Math.round(words.reduce((s, w) => s + w.confidence, 0) / words.length),
        box,
        words,
      });
    }
  }
  return lines;
}

/** Median word height: a robust "text size" reference (Tesseract word boxes vary a lot in height). */
export function medianWordHeight(words: OcrWord[]): number {
  if (!words.length) return 0;
  const hs = words.map((w) => w.box.h).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)];
}

/**
 * Rebuilds text rows from individual word boxes. Tesseract sometimes reports one "line" that spans
 * several rows of a speech bubble (and puts a middle row in a separate line), which scrambles the
 * reading order and splits the bubble. Words are re-clustered into rows by vertical overlap and
 * horizontal proximity, then ordered left-to-right.
 */
export function relineWords(lines: OcrLine[], hRef = medianWordHeight(lines.flatMap((l) => l.words))): OcrLine[] {
  const words = lines.flatMap((l) => l.words).sort((a, b) => a.box.x - b.box.x);
  const rows: OcrWord[][] = [];
  const centre = (b: Box) => b.y + b.h / 2;
  for (const w of words) {
    const row = rows.find((r) => {
      const last = r[r.length - 1];
      // Compare vertical centres against the reference height: robust to over-tall word boxes.
      const rowCentre = r.reduce((s, x) => s + centre(x.box), 0) / r.length;
      const sameRow = Math.abs(centre(w.box) - rowCentre) < hRef * 0.6;
      const hMin = Math.min(last.box.h, w.box.h);
      const hMax = Math.max(last.box.h, w.box.h);
      const gapX = w.box.x - (last.box.x + last.box.w);
      return sameRow && hMin / hMax > 0.3 && gapX < hRef * 2.5;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }
  return rows.map((r) => ({
    text: r.map((w) => w.text).join(' '),
    confidence: Math.round(r.reduce((s, w) => s + w.confidence, 0) / r.length),
    box: r.slice(1).reduce((acc, w) => union(acc, w.box), r[0].box),
    words: r,
  }));
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Groups lines that belong to the same bubble: vertically adjacent (gap < 1.3 × typical text
 * height) and horizontally overlapping/centred, with comparable text size (titles and sound
 * effects stay apart from dialogue). Groups whose boxes overlap are then merged, because one bubble
 * is never drawn on top of another. Reading order inside a bubble: top-to-bottom.
 */
export function groupLines(input: OcrLine[], opts: { reline?: boolean } = {}): OcrBlock[] {
  const hRef = medianWordHeight(input.flatMap((l) => l.words)) || medianWordHeight(input.map((l) => ({ text: l.text, confidence: l.confidence, box: l.box })));
  // reline: false keeps the engine's own lines (Apple Vision lines are reliable and keep punctuation)
  const lines = opts.reline === false ? input : relineWords(input, hRef);
  const textH = (l: OcrLine) => medianWordHeight(l.words);
  const sorted = [...lines].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  let groups: OcrLine[][] = [];
  for (const line of sorted) {
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1];
      const gap = line.box.y - (last.box.y + last.box.h);
      const overlapX = Math.min(last.box.x + last.box.w, line.box.x + line.box.w) - Math.max(last.box.x, line.box.x);
      const centreDist = Math.abs(last.box.x + last.box.w / 2 - (line.box.x + line.box.w / 2));
      const similarSize = Math.min(textH(last), textH(line)) / Math.max(textH(last), textH(line)) > 0.4;
      return gap > -hRef * 1.5 && gap < hRef * 1.3 && similarSize && (overlapX > 0 || centreDist < hRef * 2);
    });
    if (g) g.push(line);
    else groups.push([line]);
  }
  // Merge groups whose bounding boxes overlap (repeat until stable).
  const boxOf = (g: OcrLine[]) => g.slice(1).reduce((acc, l) => union(acc, l.box), g[0].box);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (intersects(boxOf(groups[i]), boxOf(groups[j]))) {
          groups[i] = [...groups[i], ...groups[j]];
          groups = groups.filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
  }
  const centreY = (l: OcrLine) => l.box.y + l.box.h / 2;
  return groups
    .map((g) => g.sort((a, b) => centreY(a) - centreY(b) || a.box.x - b.box.x))
    .sort((a, b) => boxOf(a).y - boxOf(b).y || boxOf(a).x - boxOf(b).x)
    .map((g, i) => ({
      id: `b${i}`,
      text: joinLines(g.map((l) => l.text)),
      confidence: Math.round(g.reduce((s, l) => s + l.confidence, 0) / g.length),
      box: boxOf(g),
      lines: g,
    }));
}

/** Joins bubble lines, re-attaching words hyphenated across a line break ("some-" + "thing"). */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/i.test(l)) out = out.slice(0, -1) + l;
    else out += ` ${l}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Maps a box normalised to a sub-rectangle `frame` (also normalised) back to the full target. */
export function mapToFrame(b: Box, frame: Box): Box {
  return { x: frame.x + b.x * frame.w, y: frame.y + b.y * frame.h, w: b.w * frame.w, h: b.h * frame.h };
}

/**
 * One block per detected speech bubble (second OCR pass): words are re-clustered into rows and read
 * top-to-bottom, so the whole sentence of the balloon stays together.
 */
export function bubbleBlock(lines: OcrLine[], id: string, keepLines = false): OcrBlock | null {
  const rows = (keepLines ? [...lines] : relineWords(lines)).sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2) || a.box.x - b.box.x);
  if (!rows.length) return null;
  const box = rows.slice(1).reduce((acc, l) => union(acc, l.box), rows[0].box);
  const words = rows.flatMap((r) => r.words);
  return {
    id,
    text: joinLines(rows.map((r) => r.text)),
    confidence: Math.round(words.reduce((s, w) => s + w.confidence, 0) / Math.max(1, words.length)),
    box,
    lines: rows,
  };
}
