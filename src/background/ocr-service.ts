/**
 * OCR orchestration in the service worker:
 *   cache lookup → acquire pixels (page-provided pixels | fetch original image | capture visible tab)
 *   → offscreen prepare (crop/upscale/contrast, pixel hash) → cache lookup → Tesseract → post-process.
 */
import type { ScanTarget } from '@/shared/messages';
import { MessageError } from '@/shared/messages';
import type { Box, OcrBlock, OcrLine, OcrResult } from '@/shared/types';
import { bubbleBlock, extractLines, groupLines, mapToFrame } from '@/ocr/result';
import { cleanCapsText, longWords, looksLikeWords, plausibleText, upperRatio } from '@/ocr/bubbles';

/**
 * Connected balloons are read with overlapping crops, so a line can end up in two blocks. Keep it in
 * the upper block only and rebuild the lower one from its remaining lines (no stacked boxes).
 */
export function resolveOverlaps(blocks: OcrBlock[]): OcrBlock[] {
  const out: OcrBlock[] = [];
  for (const b of blocks) {
    const inside = (l: OcrLine) => {
      const cx = l.box.x + l.box.w / 2;
      const cy = l.box.y + l.box.h / 2;
      return out.some((o) => cx >= o.box.x && cx <= o.box.x + o.box.w && cy >= o.box.y && cy <= o.box.y + o.box.h);
    };
    const keep = b.lines.filter((l) => !inside(l));
    if (keep.length === b.lines.length) {
      out.push(b);
      continue;
    }
    if (!keep.length) continue;
    const rebuilt = bubbleBlock(keep, b.id, true);
    if (rebuilt) out.push(rebuilt);
  }
  return out;
}

/** Overlap of two normalised boxes relative to the smaller one. */
function rectsOverlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h)) : 0;
}
import { isBundled } from '@/ocr/languages';
import { OcrCache, sha256 } from '@/storage/ocr-cache';
import type { PrepareResult, RecognizeResult } from '@/offscreen/protocol';
import { callOffscreen } from './offscreen-client';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface Job {
  tabId?: number;
  cancelled: boolean;
  stage: 'acquire' | 'prepare' | 'recognize' | 'done';
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchImage(src: string): Promise<string> {
  // No cookies: the extension never makes credentialed requests on the user's behalf.
  const res = await fetch(src, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn (> 25 MB).');
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') throw new Error(`Không phải ảnh (${type}).`);
  return `data:${type.startsWith('image/') ? type : 'image/png'};base64,${toBase64(buf)}`;
}

/**
 * chrome.tabs.captureVisibleTab is limited to 2 calls per second; scans in quick succession
 * (e.g. scanning another bubble right away) wait briefly and retry instead of failing.
 */
async function captureWithRetry(windowId: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      if (attempt >= 4 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 550));
    }
  }
}

export class OcrService {
  private jobs = new Map<string, Job>();

  constructor(
    private cache: OcrCache,
    private getThreshold: () => Promise<{ threshold: number; autoCache: boolean }>,
    private onProgress: (tabId: number, jobId: string, status: string, progress: number) => void,
    /** Lets the page hide its overlay UI before the screenshot and restore it afterwards. */
    private captureHooks?: { begin(tabId: number): Promise<void>; end(tabId: number): Promise<void> },
    /** Counts how many of the given words exist in the dictionary (filters artwork read as text). */
    private countKnown?: (words: string[]) => Promise<number>,
  ) {}

  progress(jobId: string, status: string, progress: number) {
    const job = this.jobs.get(jobId);
    if (job?.tabId !== undefined && !job.cancelled) this.onProgress(job.tabId, jobId, status, progress);
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    if (job.stage === 'recognize' || job.stage === 'prepare') {
      await callOffscreen({ target: 'offscreen', type: 'cancel', jobId }).catch(() => {});
    }
    return true;
  }

  private check(job: Job) {
    if (job.cancelled) throw new MessageError('Đã hủy OCR.', 'cancelled');
  }

  async scan(jobId: string, target: ScanTarget, tab: { id?: number; windowId?: number }): Promise<OcrResult> {
    if (!isBundled(target.lang)) throw new MessageError(`Ngôn ngữ OCR "${target.lang}" chưa được đóng gói.`, 'lang');
    const job: Job = { tabId: tab.id, cancelled: false, stage: 'acquire' };
    this.jobs.set(jobId, job);
    const t0 = Date.now();
    try {
      const { threshold, autoCache } = await this.getThreshold();
      const useCache = target.useCache && autoCache;
      // Full-page (sparse) scans use the per-bubble second pass; 'r3' invalidates older cached results.
      const refine = target.layout === 'sparse';
      const params = `${target.layout}|${target.lang}|${threshold}${refine ? '|r3' : ''}`;

      // 1. URL-keyed cache (full-image scans)
      let key = target.cacheKey ? await sha256(`url|${target.cacheKey}|${params}`) : '';
      if (key && useCache) {
        const hit = await this.cache.get(key);
        if (hit) return hit;
      }

      // 2. Acquire pixels
      this.progress(jobId, 'đang lấy ảnh', 0);
      let image: string | undefined = target.dataUrl;
      let acquisition: OcrResult['acquisition'] = 'image-pixels';
      let crop: Box | undefined;
      let frame: Box | undefined;
      if (!image && target.src && /^(https?:|data:)/.test(target.src)) {
        try {
          image = await fetchImage(target.src);
          acquisition = 'image-fetch';
        } catch (e) {
          console.info('[LingoLens OCR] fetch failed, falling back to visible capture:', (e as Error).message);
        }
      }
      if (!image) {
        if (tab.windowId === undefined) throw new MessageError('Không xác định được cửa sổ để chụp màn hình.', 'capture');
        if (tab.id !== undefined) await this.captureHooks?.begin(tab.id).catch(() => {});
        try {
          image = await captureWithRetry(tab.windowId);
        } catch (e) {
          throw new MessageError(`Không chụp được vùng hiển thị: ${(e as Error).message}`, 'capture');
        } finally {
          if (tab.id !== undefined) await this.captureHooks?.end(tab.id).catch(() => {});
        }
        acquisition = 'visible-capture';
        const r = target.viewportRect;
        const d = target.devicePixelRatio || 1;
        crop = { x: r.x * d, y: r.y * d, w: r.w * d, h: r.h * d };
        frame = target.visibleFraction;
        key = ''; // a partial capture must not be stored under the full-image key
      }
      this.check(job);

      // 3. Prepare in offscreen (also yields a pixel hash for capture-based cache keys)
      job.stage = 'prepare';
      const prep = await callOffscreen<PrepareResult>({ target: 'offscreen', type: 'prepare', jobId, image, crop });
      this.check(job);
      if (!key) key = await sha256(`px|${prep.pixelKey}|${params}|${JSON.stringify(frame ?? null)}`);
      if (useCache) {
        const hit = await this.cache.get(key);
        if (hit) {
          await callOffscreen({ target: 'offscreen', type: 'discard', jobId }).catch(() => {});
          return hit;
        }
      }

      // 4. Recognise
      job.stage = 'recognize';
      const raw = await callOffscreen<RecognizeResult>({ target: 'offscreen', type: 'recognize', jobId, lang: target.lang, layout: target.layout, refine });
      this.check(job);

      const toFrame = (ls: OcrLine[]) =>
        frame && (frame.w < 0.999 || frame.h < 0.999)
          ? ls.map((l) => ({ ...l, box: mapToFrame(l.box, frame!), words: l.words.map((w) => ({ ...w, box: mapToFrame(w.box, frame!) })) }))
          : ls;
      let blocks: OcrBlock[];
      if (raw.bubbles) {
        // One block per speech bubble; drop artwork that was "read" as characters.
        blocks = [];
        const built = raw.bubbles
          .map((b) => ({ b, block: bubbleBlock(toFrame(extractLines([{ lines: b.lines }], raw.width, raw.height, b.enclosed ? Math.min(threshold, 30) : Math.min(threshold, 40))), 'tmp', !!b.pass2) }))
          .filter((x): x is { b: (typeof raw.bubbles)[number]; block: OcrBlock } => !!x.block);
        const capsPage = upperRatio(built.map((x) => x.block.text).join(' ')) >= 0.8;
        for (const { b, block } of built) {
          const text = capsPage ? cleanCapsText(block.text, block.confidence) : block.text;
          if (!text || !plausibleText(text, block.confidence, b.enclosed)) continue;
          if (this.countKnown && !looksLikeWords(text, await this.countKnown(longWords(text)), b.enclosed)) continue;
          // the same balloon reached twice → keep one
          const dup = blocks.find((o) => o.text === text || (rectsOverlap(o.box, block.box) > 0.6 && (o.text.includes(text) || text.includes(o.text))));
          if (dup) {
            if (text.length > dup.text.length) Object.assign(dup, { ...block, text });
            continue;
          }
          blocks.push({ ...block, text });
        }
        blocks.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
        blocks = resolveOverlaps(blocks)
          .map((b) => (capsPage ? { ...b, text: cleanCapsText(b.text, b.confidence) ?? '' } : b))
          .filter((b) => b.text);
        blocks = blocks.map((b, i) => ({ ...b, id: `b${i}` }));
      } else {
        blocks = groupLines(toFrame(extractLines(raw.blocks, raw.width, raw.height, threshold)));
      }
      const result: OcrResult = {
        key,
        blocks,
        text: blocks.map((b) => b.text).join('\n\n'),
        meanConfidence: blocks.length ? Math.round(blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length) : 0,
        lang: target.lang,
        acquisition,
        partial: !!frame && (frame.w < 0.999 || frame.h < 0.999),
        durationMs: Date.now() - t0,
        fromCache: false,
        createdAt: Date.now(),
      };
      if (useCache && blocks.length) await this.cache.put(result).catch(() => {});
      return result;
    } finally {
      job.stage = 'done';
      this.jobs.delete(jobId);
    }
  }
}
