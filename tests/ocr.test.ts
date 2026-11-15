import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createWorker, OEM } from 'tesseract.js';
import { extractLines, groupLines, joinLines, mapToFrame, cleanWord, type RawBlock } from '@/ocr/result';
import { clampCrop, computeScale, grayscaleStretch, PSM } from '@/ocr/preprocess';
import { isBundled } from '@/ocr/languages';

const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe('OCR post-processing', () => {
  const blocks: RawBlock[] = [
    {
      paragraphs: [
        {
          lines: [
            { bbox: { x0: 100, y0: 100, x1: 300, y1: 130 }, words: [w("I'M", 100, 100, 150, 130), w('GONNA', 160, 100, 300, 130)] },
            { bbox: { x0: 90, y0: 140, x1: 310, y1: 170 }, words: [w('BECOME', 90, 140, 200, 170), w('|', 205, 140, 210, 170, 95), w('THE', 220, 140, 310, 170)] },
            { bbox: { x0: 95, y0: 180, x1: 300, y1: 210 }, words: [w('STRONG-', 95, 180, 300, 210)] },
            { bbox: { x0: 95, y0: 220, x1: 300, y1: 250 }, words: [w('EST', 95, 220, 160, 250), w('~~', 170, 220, 180, 250, 30)] },
          ],
        },
      ],
    },
    { paragraphs: [{ lines: [{ bbox: { x0: 600, y0: 500, x1: 760, y1: 530 }, words: [w('HELL', 600, 500, 700, 530), w('?!', 705, 500, 760, 530, 60)] }] }] },
    { paragraphs: [{ lines: [{ bbox: { x0: 10, y0: 10, x1: 20, y1: 20 }, words: [w('x', 10, 10, 20, 20, 40)] }] }] },
  ];
  it('filters noise / low confidence and normalises coordinates', () => {
    const lines = extractLines(blocks, 1000, 1000, 45);
    expect(lines.map((l) => l.text)).toEqual(["I'M GONNA", 'BECOME I THE', 'STRONG-', 'EST', 'HELL ?!']);
    expect(lines[0].box.x).toBeCloseTo(0.1);
    expect(lines[0].box.w).toBeCloseTo(0.2);
    expect(lines[0].box.h).toBeCloseTo(0.03);
  });
  it('groups nearby lines into speech bubbles and re-joins hyphenation', () => {
    const groups = groupLines(extractLines(blocks, 1000, 1000, 45));
    expect(groups).toHaveLength(2);
    expect(groups[0].text).toBe("I'M GONNA BECOME I THE STRONGEST");
    expect(groups[1].text).toBe('HELL ?!');
    expect(groups[0].box.y).toBeCloseTo(0.1);
  });
  it('maps partial-capture boxes back to full-image coordinates', () => {
    expect(mapToFrame({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { x: 0, y: 0.5, w: 1, h: 0.5 })).toEqual({ x: 0.5, y: 0.75, w: 0.1, h: 0.05 });
  });
  it('helpers', () => {
    expect(joinLines(['some-', 'thing here'])).toBe('something here');
    expect(cleanWord('“Hi”')).toBe('"Hi"');
    expect(computeScale(800, 1200)).toBe(1.5);
    expect(computeScale(2000, 3000)).toBe(1);
    expect(computeScale(10000, 10000)).toBeLessThan(1); // very large images are downscaled to 12 MP
    expect(clampCrop({ x: -10, y: 5, w: 5000, h: 50 }, 800, 600)).toEqual({ x: 0, y: 5, w: 800, h: 50 });
    expect(clampCrop({ x: 799, y: 0, w: 10, h: 10 }, 800, 600)).toBeNull();
    expect(PSM.sparse).toBe('11');
    expect(isBundled('eng')).toBe(true);
    expect(isBundled('jpn_vert')).toBe(false);
  });
  it('stretches contrast to full range', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255, 180, 180, 180, 255, 140, 140, 140, 255, 160, 160, 160, 255]);
    grayscaleStretch(px);
    expect(px[0]).toBe(0);
    expect(px[4]).toBe(255);
  });
});

describe('Tesseract integration (same engine + model as the extension)', () => {
  it('recognises English manga lettering from a rendered speech-bubble image', async () => {
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: resolve(__dirname, '../node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
      cacheMethod: 'none',
      gzip: true,
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.sparse as never });
      const img = await readFile(resolve(__dirname, 'fixtures/bubble@2x.png'));
      const { data } = await worker.recognize(img, {}, { blocks: true, text: true });
      const groups = groupLines(extractLines((data.blocks ?? []) as never, 1520, 1120, 45));
      const text = groups.map((g) => g.text).join(' | ');
      for (const word of ['GONNA', 'STRONGEST', 'NINJA', 'HELL', 'GOING']) expect(text).toContain(word);
      expect(groups.length).toBe(2);
      // the first bubble sits in the top-left quadrant
      expect(groups[0].box.x).toBeLessThan(0.5);
      expect(groups[0].box.y).toBeLessThan(0.5);
    } finally {
      await worker.terminate();
    }
  }, 90_000);

  it('returns no blocks (not an error) for an image without text', async () => {
    const { encodePng } = await import('../scripts/make-icons.mjs');
    const blank = encodePng(200, 120, Buffer.alloc(200 * 120 * 4, 255));
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: resolve(__dirname, '../node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
      cacheMethod: 'none',
    });
    try {
      const { data } = await worker.recognize(blank, {}, { blocks: true });
      expect(groupLines(extractLines((data.blocks ?? []) as never, 200, 120, 45))).toEqual([]);
    } finally {
      await worker.terminate();
    }
  }, 60_000);
});

describe('bubble rows rebuilt from word boxes', () => {
  // Tesseract output seen on a real manga page: one "line" spanning 4 rows of a bubble with the
  // middle row ("MOVING FROM") reported as a separate line.
  const W = (text: string, x: number, y: number, w = 60) => ({ text, confidence: 92, bbox: { x0: x, y0: y, x1: x + w, y1: y + 20 } });
  const blocks: RawBlock[] = [
    {
      lines: [
        { bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, words: [W('THE', 410, 100, 40), W('PERPETRATOR', 380, 125, 110), W('MADE', 395, 150, 45), W('HIS', 445, 150, 30), W('ESCAPE', 390, 175, 55), W('BY', 450, 175, 25), W('WINDOW', 390, 225, 50), W('TO', 445, 225, 20), W('WINDOW', 410, 250, 60)] },
        { bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, words: [W('MOVING', 385, 200, 55), W('FROM', 445, 200, 45)] },
      ],
    },
    // a different bubble far to the left on the same rows must stay separate
    { lines: [{ bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, words: [W('WHO', 60, 125, 40), W('DID', 60, 150, 35), W('IT', 70, 175, 20)] }] },
  ];
  it('merges the split rows into one bubble in reading order', () => {
    const groups = groupLines(extractLines(blocks, 1000, 1000, 45));
    expect(groups.map((g) => g.text)).toEqual(['THE PERPETRATOR MADE HIS ESCAPE BY MOVING FROM WINDOW TO WINDOW', 'WHO DID IT']);
  });
});

describe('bubble grouping with inconsistent Tesseract word heights (real mangafire page)', () => {
  // Word boxes (×1000) recorded from a live scan; heights jump between 9 and 17 within one bubble.
  const B = (text: string, x: number, y: number, w: number, h: number) => ({ text, confidence: 93, box: { x: x / 1000, y: y / 1000, w: w / 1000, h: h / 1000 } });
  const L = (...words: ReturnType<typeof B>[]) => ({ text: words.map((w) => w.text).join(' '), confidence: 93, box: words[0].box, words });
  it('keeps the whole bubble together in reading order', () => {
    const lines = [
      L(B('PERPETRATOR', 766, 427, 118, 9)),
      L(B('MADE', 781, 438, 48, 17), B('HIS', 837, 438, 31, 17)),
      L(B('ESCAPE', 780, 453, 92, 9), B('BY', 849, 450, 25, 17)),
      L(B('WINDOW', 778, 479, 95, 9), B('TO', 851, 477, 23, 17)),
      L(B('WINDOW', 792, 492, 66, 9)),
      L(B('MOVING', 766, 466, 63, 9), B('FROM', 837, 466, 47, 9)),
      // another bubble elsewhere on the page
      L(B('WHO', 300, 700, 40, 10)),
      L(B('DID', 302, 713, 36, 10)),
    ];
    expect(groupLines(lines).map((g) => g.text)).toEqual(['PERPETRATOR MADE HIS ESCAPE BY MOVING FROM WINDOW TO WINDOW', 'WHO DID']);
  });
});

describe('speech-bubble detection (flood fill over the balloon interior)', () => {
  // 60×40 image: dark artwork (40) with a light ellipse balloon (250) outlined in black; "text" (dark
  // strokes) inside the balloon; a second light area touching the border (page margin).
  const W = 60;
  const H = 40;
  const img = () => {
    const g = new Uint8Array(W * H).fill(40);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = ((x - 20) / 14) ** 2 + ((y - 20) / 10) ** 2;
        if (d < 1) g[y * W + x] = 250;
        if (x >= 50) g[y * W + x] = 250; // white margin at the right edge
      }
    for (let x = 12; x <= 28; x += 2) for (let y = 16; y <= 24; y++) g[y * W + x] = 10; // text strokes
    return g;
  };
  it('recovers the balloon interior from the text cluster and builds row spans', async () => {
    const { floodBubble, touchesBorder } = await import('@/ocr/bubbles');
    const r = floodBubble(img(), W, H, { x: 12, y: 16, w: 17, h: 9 })!;
    expect(r).not.toBeNull();
    expect(r.box.x).toBeGreaterThanOrEqual(6);
    expect(r.box.x + r.box.w).toBeLessThanOrEqual(35);
    expect(r.box.y).toBeGreaterThanOrEqual(10);
    expect(r.box.h).toBeGreaterThan(15);
    // the middle row spans (almost) the whole balloon width, covering the text strokes
    const mid = (20 - r.box.y) * 2;
    expect(r.spans[mid]).toBeLessThanOrEqual(12);
    expect(r.spans[mid + 1]).toBeGreaterThanOrEqual(28);
    expect(touchesBorder(r, W, H)).toBe(false);
  });
  it('reports leaks (too large / page margin) and dark seeds', async () => {
    const { floodBubble, touchesBorder } = await import('@/ocr/bubbles');
    expect(floodBubble(img(), W, H, { x: 12, y: 16, w: 17, h: 9 }, 200, 50)).toBeNull(); // maxArea exceeded
    expect(floodBubble(img(), W, H, { x: 0, y: 0, w: 4, h: 4 })).toBeNull(); // artwork: no light seed
    const margin = floodBubble(img(), W, H, { x: 52, y: 5, w: 5, h: 5 }, 200, W * H)!;
    expect(touchesBorder(margin, W, H)).toBe(true);
  });
  it('filters artwork read as characters, keeps real dialogue', async () => {
    const { plausibleText } = await import('@/ocr/bubbles');
    expect(plausibleText('WHO KILLED MY WIFE !?', 90, true)).toBe(true);
    expect(plausibleText("THAT'S RIGHT ...", 80, true)).toBe(true);
    expect(plausibleText('I', 90, true)).toBe(true);
    expect(plausibleText('RW', 57, false)).toBe(false);
    expect(plausibleText('fay', 47, false)).toBe(false);
    expect(plausibleText('|| =- ~', 90, true)).toBe(false);
    expect(plausibleText('nd', 57, true)).toBe(false);
    expect(plausibleText('RUMBLE', 85, false)).toBe(true);
  });
});

describe('balloons from artwork, masks and ALL-CAPS cleanup', () => {
  it('finds a closed balloon with lettering, ignores blank shapes, page margins and solid artwork', async () => {
    const { findBalloons } = await import('@/ocr/bubbles');
    const W = 240;
    const H = 160;
    const g = new Uint8Array(W * H).fill(30);
    const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) g[y * W + x] = 250;
    };
    ellipse(30, 40, 20, 14); // balloon with text
    for (let x = 18; x <= 42; x += 3) for (let y = 34; y <= 46; y++) g[y * W + x] = 10;
    ellipse(80, 40, 14, 10); // blank light shape (no text)
    for (let y = 0; y < H; y++) for (let x = 232; x < W; x++) g[y * W + x] = 250; // margin
    const found = findBalloons(g, W, H);
    expect(found).toHaveLength(1);
    expect(found[0].box.x).toBeGreaterThanOrEqual(9);
    expect(found[0].box.x + found[0].box.w).toBeLessThanOrEqual(52);
  });
  it('merges and widens masks without losing rows', async () => {
    const { mergeMasks, extendMask } = await import('@/ocr/bubbles');
    const a = { box: { x: 10, y: 10, w: 10, h: 2 }, spans: Int32Array.from([10, 19, 12, 17]), area: 18 };
    const b = { box: { x: 15, y: 11, w: 10, h: 2 }, spans: Int32Array.from([15, 24, 16, 20]), area: 15 };
    const m = mergeMasks(a, b);
    expect(m.box).toEqual({ x: 10, y: 10, w: 15, h: 3 });
    expect(Array.from(m.spans)).toEqual([10, 19, 12, 24, 16, 20]);
    const e = extendMask(a, { x: 5, y: 11, w: 3, h: 3 });
    expect(e.box.x).toBe(5);
    expect(e.box.y + e.box.h).toBe(14);
    expect(Array.from(e.spans.slice(2, 4))).toEqual([5, 17]);
  });
  it('drops lower-case artwork tokens on an ALL-CAPS page', async () => {
    const { cleanCapsText, upperRatio } = await import('@/ocr/bubbles');
    expect(upperRatio("THAT'S RIGHT")).toBe(1);
    expect(cleanCapsText('Fda ay', 61)).toBeNull();
    expect(cleanCapsText('vv, WHO plas KILLED MY WIFE !?', 72)).toBe('WHO KILLED MY WIFE !?');
    expect(cleanCapsText("THERE'S FIVE METERS", 90)).toBe("THERE'S FIVE METERS");
  });
});

describe('dictionary check of OCR bubbles', () => {
  it('keeps dialogue (incl. short bubbles), drops artwork read as characters', async () => {
    const { looksLikeWords, longWords } = await import('@/ocr/bubbles');
    expect(longWords("THE PERPETRATOR MADE HIS ESCAPE BY")).toEqual(['THE', 'PERPETRATOR', 'MADE', 'HIS', 'ESCAPE']);
    expect(longWords("THAT'S RIGHT...")).toEqual(['THAT', 'RIGHT']);
    expect(looksLikeWords('THE PERPETRATOR MADE HIS', 4, true)).toBe(true);
    expect(looksLikeWords('Fda ay rnm', 0, false)).toBe(false);
    expect(looksLikeWords('WHO DlD IT', 1, false)).toBe(true); // 1 of 2 long words known
    expect(looksLikeWords('IT WAS ...', 1, true)).toBe(true);
    expect(looksLikeWords('IT ...', 0, true)).toBe(true);
    expect(looksLikeWords('Mi', 0, true)).toBe(false);
    expect(looksLikeWords('IT', 0, false)).toBe(false); // outside a balloon, too little evidence
  });
});

describe('lone short tokens', () => {
  it('drop "THe," / "A" but keep stand-alone utterances inside balloons', async () => {
    const { looksLikeWords } = await import('@/ocr/bubbles');
    expect(looksLikeWords('THe,', 1, true)).toBe(false);
    expect(looksLikeWords('A', 0, true)).toBe(false);
    expect(looksLikeWords('WHAT?!', 1, true)).toBe(true);
    expect(looksLikeWords('I...', 0, true)).toBe(true);
    expect(looksLikeWords('NO!', 0, false)).toBe(false);
  });
});

describe('artwork scraps at bubble edges', () => {
  it('drops "Fa" before a sentence but keeps a misread "My"', async () => {
    const { cleanCapsText } = await import('@/ocr/bubbles');
    expect(cleanCapsText('Fa THE PERPETRATOR MADE HIS ESCAPE', 91)).toBe('THE PERPETRATOR MADE HIS ESCAPE');
    expect(cleanCapsText('WHO KILLED My WIFE', 83)).toBe('WHO KILLED My WIFE');
  });
});
