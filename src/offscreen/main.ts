/**
 * Offscreen document: hosts the Tesseract worker (pages cannot spawn workers from extension URLs
 * and the service worker has no canvas). Only chrome.runtime is available here.
 */
import { TesseractEngine, CancelledError } from '@/ocr/tesseract-engine';
import { clampCrop, computeScale, grayscaleStretch } from '@/ocr/preprocess';
import { extractLines, groupLines, medianWordHeight, type RawBlock, type RawLine } from '@/ocr/result';
import { extendMask, findBalloons, floodBubble, mergeMasks, padRect, rectsIntersect, touchesBorder, unionRect, type BubbleRegion, type Rect } from '@/ocr/bubbles';
import { sha256 } from '@/storage/ocr-cache';
import { LocalMtEngine, LocalModelHost } from '@/modules/mt';
import type { OffscreenProgress, OffscreenRequest, PrepareResult, RecognizeResult, RefinedBubble } from './protocol';

const engine = new TesseractEngine({
  workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
  corePath: chrome.runtime.getURL('vendor/tesseract/core'),
  langPath: chrome.runtime.getURL('vendor/tesseract/lang'),
});

// Local translation model: the worker is created on first use and freed with the page (10 min idle).
const mtHost = new LocalModelHost(
  new LocalMtEngine(
    () => new Worker(new URL('../modules/mt/local/worker.ts', import.meta.url), { type: 'module' }) as never,
    chrome.runtime.getURL('vendor/ort/'),
  ),
);

const prepared = new Map<string, { blob: Blob; width: number; height: number; canvas: OffscreenCanvas }>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
// Kept warm while the user reads: every scan / warm-up request resets this timer.
const IDLE_MS = 10 * 60 * 1000;

function touch() {
  clearTimeout(idleTimer);
  // Free ~100 MB of WASM memory when OCR has not been used for a while.
  idleTimer = setTimeout(() => {
    void engine.terminate().then(() => window.close());
  }, IDLE_MS);
}

async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') throw new Error(`Không phải dữ liệu ảnh (${blob.type || 'unknown'}).`);
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('Không giải mã được ảnh (định dạng không hỗ trợ hoặc dữ liệu hỏng).');
  }
}

async function prepare(jobId: string, image: string, crop?: { x: number; y: number; w: number; h: number }): Promise<PrepareResult> {
  const bmp = await loadBitmap(image);
  const c = clampCrop(crop ?? { x: 0, y: 0, w: bmp.width, h: bmp.height }, bmp.width, bmp.height);
  if (!c) throw new Error('Vùng quét quá nhỏ.');
  const scale = computeScale(c.w, c.h);
  const w = Math.round(c.w * scale);
  const h = Math.round(c.h * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, c.x, c.y, c.w, c.h, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  grayscaleStretch(img.data);
  ctx.putImageData(img, 0, 0);

  // Perceptual-ish key: 32×32 thumbnail quantised to 16 grey levels → stable across recaptures.
  const thumb = new OffscreenCanvas(32, 32);
  const tctx = thumb.getContext('2d')!;
  tctx.drawImage(canvas, 0, 0, 32, 32);
  const td = tctx.getImageData(0, 0, 32, 32).data;
  let sig = `${c.w}x${c.h}:`;
  for (let i = 0; i < td.length; i += 4) sig += (td[i] >> 4).toString(16);
  const pixelKey = await sha256(sig);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  prepared.set(jobId, { blob, width: w, height: h, canvas });
  return { pixelKey, width: w, height: h };
}

function report(jobId: string, status: string, progress: number) {
  const msg: OffscreenProgress = { target: 'background', type: 'offscreen:progress', jobId, status, progress };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/** Tesseract lines → RawLine[] mapped from a crop (scaled by s, offset ox/oy) back to the full image. */
function mapLines(blocks: RawBlock[] | null | undefined, s: number, ox: number, oy: number): RawLine[] {
  const out: RawLine[] = [];
  const m = (b: RawLine['bbox']) => ({ x0: ox + b.x0 / s, y0: oy + b.y0 / s, x1: ox + b.x1 / s, y1: oy + b.y1 / s });
  for (const b of blocks ?? []) {
    for (const l of b.paragraphs ? b.paragraphs.flatMap((p) => p.lines) : (b.lines ?? [])) {
      out.push({ text: l.text, confidence: l.confidence, bbox: m(l.bbox), words: (l.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: m(w.bbox) })) });
    }
  }
  return out;
}

interface Region {
  box: Rect; // processed-image pixels
  enclosed: boolean;
  mask: BubbleRegion | null; // downsampled coordinates
  pass1: RawLine[];
  /** Found from the artwork only (no first-pass text inside). */
  fromArtwork?: boolean;
}

/**
 * Second pass for full-page scans: find the balloon around every text cluster of the first pass,
 * blank the artwork outside it, upscale and re-read it as one text block. Recovers lines the sparse
 * pass missed, keeps each bubble's sentence together, and drops characters "read" from artwork.
 */
async function refine(jobId: string, item: { canvas: OffscreenCanvas; width: number; height: number }, first: RawBlock[], lang: string): Promise<RefinedBubble[]> {
  const { canvas, width: W, height: H } = item;
  const lines = extractLines(first, W, H, 30);
  if (!lines.length) return [];

  const hRef = Math.max(6, medianWordHeight(lines.flatMap((l) => l.words)) * H);

  // Downsampled grayscale for the flood fill.
  const ds = Math.min(1, 1500 / Math.max(W, H));
  const gw = Math.max(1, Math.round(W * ds));
  const gh = Math.max(1, Math.round(H * ds));
  const small = new OffscreenCanvas(gw, gh);
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(canvas, 0, 0, gw, gh);
  const rgba = sctx.getImageData(0, 0, gw, gh).data;
  const gray = new Uint8Array(gw * gh);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];

  const toPx = (bx: { x: number; y: number; w: number; h: number }) => ({ x0: bx.x * W, y0: bx.y * H, x1: (bx.x + bx.w) * W, y1: (bx.y + bx.h) * H });
  const toRaw = (l: (typeof lines)[number]): RawLine => ({
    text: l.text,
    confidence: l.confidence,
    bbox: toPx(l.box),
    words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: toPx(w.box) })),
  });

  // Balloon membership is decided per text line by the drawn outline (flood fill from the line),
  // not by distances between lines: adjacent balloons stay apart even when their text is close.
  const enclosedRegions: Region[] = [];
  const openLines: typeof lines = [];
  for (const l of lines) {
    const px = { x: l.box.x * W, y: l.box.y * H, w: l.box.w * W, h: l.box.h * H };
    const seed = { x: px.x * ds, y: px.y * ds, w: px.w * ds, h: px.h * ds };
    const r = floodBubble(gray, gw, gh, seed, 200, gw * gh * 0.15);
    const enclosed = !!r && !touchesBorder(r, gw, gh) && r.box.w >= seed.w * 0.9 && r.box.h >= seed.h * 0.9;
    if (!enclosed) {
      openLines.push(l);
      continue;
    }
    const box = padRect({ x: r!.box.x / ds, y: r!.box.y / ds, w: r!.box.w / ds, h: r!.box.h / ds }, 4, W, H);
    enclosedRegions.push({ box, enclosed: true, mask: r, pass1: [toRaw(l)] });
  }
  // Text outside balloons (narration on artwork, open balloons): cluster by layout.
  // Clusters of outline-less text on the same row, close together, are one text (a chapter title
  // split by the first pass into "FILE 1: A MODERN-DAY" + "SHERLOCK HOLMES").
  let openGroups = groupLines(openLines);
  for (let again = true; again; ) {
    again = false;
    outerRow: for (let i = 0; i < openGroups.length; i++) {
      for (let j = i + 1; j < openGroups.length; j++) {
        const a = openGroups[i].box;
        const b = openGroups[j].box;
        const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
        if (vOverlap > Math.min(a.h, b.h) * 0.5 && gap * W < hRef * 3) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const box = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          openGroups[i] = { ...openGroups[i], box, lines: [...openGroups[i].lines, ...openGroups[j].lines] };
          openGroups = openGroups.filter((_, k) => k !== j);
          again = true;
          break outerRow;
        }
      }
    }
  }
  const openRegions: Region[] = openGroups.map((g) => ({
    // outline-less text: generous vertical margin (lines the first pass missed), small horizontal one
    box: (() => {
      const x0 = Math.max(0, g.box.x * W - hRef * 0.5);
      const x1 = Math.min(W, (g.box.x + g.box.w) * W + hRef * 0.5);
      const y0 = Math.max(0, g.box.y * H - hRef * 1.0);
      const y1 = Math.min(H, (g.box.y + g.box.h) * H + hRef * 2.3);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })(),
    enclosed: false,
    mask: null,
    pass1: g.lines.map(toRaw),
  }));
  let regions: Region[] = [...enclosedRegions, ...openRegions];


  // Merge clusters that belong to the same balloon. Two different balloons are never merged; a
  // cluster without a balloon joins the balloon that contains its centre, or another open cluster
  // it overlaps substantially.
  const sameMask = (x: Region, y: Region) => !!x.mask && !!y.mask && x.mask.box.x === y.mask.box.x && x.mask.box.y === y.mask.box.y && x.mask.area === y.mask.area;
  const centreIn = (x: Rect, y: Rect) => {
    const cx = x.x + x.w / 2;
    const cy = x.y + x.h / 2;
    return cx >= y.x && cx <= y.x + y.w && cy >= y.y && cy <= y.y + y.h;
  };
  const overlapRatio = (x: Rect, y: Rect) => {
    const w = Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x);
    const h = Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y);
    return w > 0 && h > 0 ? (w * h) / Math.min(x.w * x.h, y.w * y.h) : 0;
  };
  const belongs = (x: Region, y: Region) => {
    // a balloon split into pieces by thick lettering → one balloon
    if (x.mask && y.mask) return sameMask(x, y) || overlapRatio(x.box, y.box) > 0.5;
    if (x.mask) return centreIn(y.box, x.box) || overlapRatio(y.box, x.box) > 0.3;
    if (y.mask) return centreIn(x.box, y.box) || overlapRatio(x.box, y.box) > 0.3;
    return rectsIntersect(x.box, y.box) && overlapRatio(x.box, y.box) > 0.3;
  };
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const x = regions[i];
        const y = regions[j];
        if (!belongs(x, y)) continue;
        const mask = x.mask && y.mask ? (sameMask(x, y) ? x.mask : mergeMasks(x.mask, y.mask)) : (x.mask ?? y.mask);
        const box = x.mask && y.mask ? unionRect(x.box, y.box) : x.mask ? x.box : y.mask ? y.box : unionRect(x.box, y.box);
        regions[i] = { box, enclosed: x.enclosed || y.enclosed, mask, pass1: [...x.pass1, ...y.pass1] };
        regions = regions.filter((_, k) => k !== j);
        merged = true;
        break outer;
      }
    }
  }

  // Never blank text that belongs to the balloon: widen each mask to cover all its first-pass lines,
  // and make the crop cover them too.
  regions = regions.map((r) => {
    if (!r.mask) return r;
    let mask = r.mask;
    let box = r.box;
    for (const l of r.pass1) {
      const lr = { x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 };
      mask = extendMask(mask, { x: lr.x * ds - 1, y: lr.y * ds - 1, w: lr.w * ds + 2, h: lr.h * ds + 2 });
      box = unionRect(box, padRect(lr, 3, W, H));
    }
    return { ...r, mask, box };
  });

  // Split each light area into text columns: connected balloons (one speaker continuing) and
  // outline-less dialogue on a white panel are separate texts. Each column is cropped with some
  // vertical margin (to pick up lines the first pass missed) and read on its own; the balloon mask
  // still blanks the artwork around it.
  const toNorm = (l: RawLine) => ({
    text: l.text ?? '',
    confidence: l.confidence ?? 0,
    box: { x: l.bbox.x0 / W, y: l.bbox.y0 / H, w: (l.bbox.x1 - l.bbox.x0) / W, h: (l.bbox.y1 - l.bbox.y0) / H },
    words: (l.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, box: { x: w.bbox.x0 / W, y: w.bbox.y0 / H, w: (w.bbox.x1 - w.bbox.x0) / W, h: (w.bbox.y1 - w.bbox.y0) / H } })),
  });
  const split: Region[] = [];
  for (const r of regions) {
    if (!r.mask || r.pass1.length < 2) {
      split.push(r);
      continue;
    }
    let cols = groupLines(r.pass1.map(toNorm)).map((g) => {
      const px = { x: g.box.x * W, y: g.box.y * H, w: g.box.w * W, h: g.box.h * H };
      const padded = { x: px.x - hRef * 0.8, y: px.y - hRef * 2.2, w: px.w + hRef * 1.6, h: px.h + hRef * 4.4 };
      const x = Math.max(r.box.x, padded.x);
      const y = Math.max(r.box.y, padded.y);
      const box = { x, y, w: Math.min(r.box.x + r.box.w, padded.x + padded.w) - x, h: Math.min(r.box.y + r.box.h, padded.y + padded.h) - y };
      return { box, lines: g.lines };
    });
    // columns whose margins overlap a lot are the same column
    for (let again = true; again; ) {
      again = false;
      outer2: for (let i = 0; i < cols.length; i++)
        for (let j = i + 1; j < cols.length; j++)
          if (overlapRatio(cols[i].box, cols[j].box) > 0.35) {
            cols[i] = { box: unionRect(cols[i].box, cols[j].box), lines: [...cols[i].lines, ...cols[j].lines] };
            cols = cols.filter((_, k) => k !== j);
            again = true;
            break outer2;
          }
    }
    if (cols.length === 1) {
      split.push(r);
      continue;
    }
    for (const c of cols) {
      const raw = r.pass1.filter((l) => c.lines.some((x) => Math.abs(x.box.x * W - l.bbox.x0) < 1 && Math.abs(x.box.y * H - l.bbox.y0) < 1));
      split.push({ box: c.box, enclosed: true, mask: r.mask, pass1: raw });
    }
  }
  regions = split;

  // Balloons with no text found by the first pass ("THAT'S RIGHT…" in a small balloon): detect them
  // from the artwork and read them too.
  for (const b of findBalloons(gray, gw, gh)) {
    const box = padRect({ x: b.box.x / ds, y: b.box.y / ds, w: b.box.w / ds, h: b.box.h / ds }, 4, W, H);
    if (regions.some((r) => overlapRatio(r.box, box) > 0.25)) continue;
    regions.push({ box, enclosed: true, mask: b, pass1: [], fromArtwork: true });
  }

  const out: RefinedBubble[] = [];
  const s2 = Math.min(2.5, Math.max(1, 30 / hRef));
  for (let n = 0; n < regions.length; n++) {
    const r = regions[n];
    report(jobId, 'đang đọc từng bong bóng', n / regions.length);
    const cw = Math.max(8, Math.round(r.box.w * s2));
    const ch = Math.max(8, Math.round(r.box.h * s2));
    const crop = new OffscreenCanvas(cw, ch);
    const cctx = crop.getContext('2d')!;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(canvas, r.box.x, r.box.y, r.box.w, r.box.h, 0, 0, cw, ch);
    if (r.mask) {
      // Blank everything outside the balloon interior, row by row (the spans include the text inside).
      cctx.fillStyle = '#fff';
      const m = r.mask;
      for (let cy = 0; cy < ch; cy++) {
        const gy = Math.floor((r.box.y + cy / s2) * ds) - m.box.y;
        let lo = -1;
        let hi = -1;
        for (let k = gy - 1; k <= gy + 1; k++) {
          if (k < 0 || k >= m.box.h || m.spans[k * 2] < 0) continue;
          lo = lo < 0 ? m.spans[k * 2] : Math.min(lo, m.spans[k * 2]);
          hi = Math.max(hi, m.spans[k * 2 + 1]);
        }
        if (lo < 0) {
          cctx.fillRect(0, cy, cw, 1);
          continue;
        }
        const x0 = Math.max(0, Math.floor((lo / ds - r.box.x - 2) * s2));
        const x1 = Math.min(cw, Math.ceil((hi / ds - r.box.x + 3) * s2));
        if (x0 > 0) cctx.fillRect(0, cy, x0, 1);
        if (x1 < cw) cctx.fillRect(x1, cy, cw - x1, 1);
      }
    }
    const blob = await crop.convertToBlob({ type: 'image/png' });
    // "One text block" reads most balloons best; small balloons with one or two words per line are
    // often read better as sparse text – retry and keep whichever yields more confident words.
    const confident = (ls: RawLine[]) => ls.reduce((k, l) => k + (l.words ?? []).filter((w) => w.confidence >= 55 && /[A-Za-z]/.test(w.text)).length, 0);
    const blockRead = mapLines((await engine.recognize(blob, { lang, layout: 'block' }, () => {})).blocks as unknown as RawBlock[], s2, r.box.x, r.box.y);
    let lines2 = blockRead;
    // (not for balloons found only from the artwork: those are usually blank shapes, keep them cheap)
    if (confident(blockRead) < 2 && !r.fromArtwork) {
      const sparseRead = mapLines((await engine.recognize(blob, { lang, layout: 'sparse' }, () => {})).blocks as unknown as RawBlock[], s2, r.box.x, r.box.y);
      if (confident(sparseRead) > confident(blockRead)) lines2 = sparseRead;
    }
    const words2 = lines2.reduce((k, l) => k + (l.words?.length ?? 0), 0);
    const words1 = r.pass1.reduce((k, l) => k + l.words.length, 0);
    // Keep the second pass unless it found fewer confident words than the first pass had.
    const second = words2 >= Math.min(words1, 2) && confident(lines2) >= confident(r.pass1);
    out.push({ enclosed: r.enclosed, pass2: second, lines: second ? lines2 : r.pass1 });
  }
  report(jobId, 'đang đọc từng bong bóng', 1);
  return out;
}

async function recognize(jobId: string, lang: string, layout: 'sparse' | 'auto' | 'block', doRefine = false): Promise<RecognizeResult> {
  const item = prepared.get(jobId);
  if (!item) throw new Error('Ảnh chưa được chuẩn bị cho OCR.');
  const t0 = performance.now();
  try {
    const data = await engine.recognize(item.blob, { lang, layout }, (p) => report(jobId, p.status, p.progress));
    const blocks = (data.blocks ?? []) as unknown as RawBlock[];
    const bubbles = doRefine ? await refine(jobId, item, blocks, lang) : undefined;
    return { blocks, bubbles, width: item.width, height: item.height, durationMs: Math.round(performance.now() - t0) };
  } finally {
    prepared.delete(jobId);
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  touch();
  const run = async () => {
    switch (msg.type) {
      case 'prepare':
        return prepare(msg.jobId, msg.image, msg.crop);
      case 'recognize':
        return recognize(msg.jobId, msg.lang, msg.layout, msg.refine);
      case 'warmup':
        await engine.warm(msg.lang);
        return true;
      case 'discard':
        prepared.delete(msg.jobId);
        return true;
      case 'cancel':
        prepared.delete(msg.jobId);
        await engine.cancel();
        return true;
      case 'mt-local':
        switch (msg.op) {
          case 'cached':
            return mtHost.cached(msg.modelId!);
          case 'start':
            return mtHost.start(msg.modelId!);
          case 'status':
            return mtHost.status(msg.modelId!);
          case 'translate':
            return mtHost.translate(msg.modelId!, msg.text ?? '');
          case 'release':
            await mtHost.release();
            return true;
          case 'cancel':
            return mtHost.cancel(msg.modelId!);
          case 'verify':
            return mtHost.verify(msg.modelId!);
          case 'remove':
            await mtHost.remove(msg.modelId!);
            return true;
        }
    }
  };
  run()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e), code: e instanceof CancelledError ? 'cancelled' : undefined }),
    );
  return true;
});

touch();
