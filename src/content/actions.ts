/** In-page actions: lookups, popup navigation, vocabulary, sidebar and OCR scanning. */
import { send, MessageError, type ScanTarget, type SidebarPayload } from '@/shared/messages';
import type { LookupRequest, LookupResult, WordLookup } from '@/shared/types';
import type { Rect } from '@/popup/position';
import { chromeLocal } from '@/storage/kv';
import { VocabStore } from '@/storage/vocab-store';
import { OcrCache } from '@/storage/ocr-cache';
import { primaryMeaning } from '@/ui/views';
import { findBlock, store, toast, updateTarget, type OcrTarget, type PopupView } from './store';

const kv = chromeLocal();
const ocrCache = new OcrCache(kv);
export const vocab = new VocabStore(kv, () => ocrCache.evictOldest(60));

let lookupSeq = 0;

function defaultTab(result?: LookupResult): string {
  if (!result) return 'meaning';
  if (result.kind === 'sentence' || result.kind === 'paragraph') return 'translation';
  return 'meaning';
}

async function runLookup(req: LookupRequest, replaceTop: boolean, anchor?: Rect) {
  const seq = ++lookupSeq;
  // The sidebar mirrors what the popup is translating: same word / sentence, same moment (stored for the panel
  // and delivered live when it is open; nothing is opened here).
  if (req.text.trim()) void send({ type: 'sidebar:push', payload: { type: 'lookup', text: req.text, context: req.context, source: pageSource() } }).catch(() => {});
  const view: PopupView = { kind: 'lookup', req, loading: true };
  store.set((s) => {
    const prev = s.popup;
    const stack = prev && !replaceTop ? [...prev.stack, view] : [view];
    // A drill-down keeps the original anchor and placement (e.g. beside an OCR bubble).
    const prefer = replaceTop && anchor ? undefined : prev?.prefer;
    return { trigger: null, popup: { open: true, anchor: anchor ?? prev?.anchor ?? { left: 40, top: 40, width: 0, height: 0 }, stack, tab: 'meaning', prefer } };
  });
  try {
    const result = await send({ type: 'lookup', req });
    if (seq !== lookupSeq) return;
    patchTop({ result, loading: false }, defaultTab(result));
  } catch (e) {
    if (seq !== lookupSeq) return;
    patchTop({ error: (e as Error).message, loading: false });
  }
}

function patchTop(patch: Partial<Extract<PopupView, { kind: 'lookup' }>>, tab?: string) {
  store.set((s) => {
    if (!s.popup) return {};
    const stack = s.popup.stack.slice();
    const top = stack[stack.length - 1];
    if (top?.kind !== 'lookup') return {};
    stack[stack.length - 1] = { ...top, ...patch };
    return { popup: { ...s.popup, stack, tab: tab ?? s.popup.tab } };
  });
}

/** New lookup anchored at `anchor` (replaces the popup content). */
export function lookup(text: string, anchor: Rect, context?: string, force = false) {
  const s = store.get().settings;
  if (!s.popup.enabled && !force) {
    // Popup disabled → send straight to the sidebar if it is open/enabled.
    void send({ type: 'sidebar:push', payload: { type: 'lookup', text, context, source: pageSource() } }).catch(() => {});
    return;
  }
  void runLookup({ text, context, assumeEnglish: !s.reading.autoDetectLanguage || undefined }, true, anchor);
}

/** Lookup from inside the popup (word in a sentence, OCR word, synonym…) – pushes a view. */
export function drillDown(text: string, context?: string) {
  void runLookup({ text, context }, false);
}

export function back() {
  store.set((s) => (s.popup && s.popup.stack.length > 1 ? { popup: { ...s.popup, stack: s.popup.stack.slice(0, -1), tab: 'meaning' } } : {}));
}

export function closePopup() {
  lookupSeq++;
  store.set({ popup: null, trigger: null });
}

export function setTab(tab: string) {
  store.set((s) => (s.popup ? { popup: { ...s.popup, tab } } : {}));
}

export function pageSource() {
  return { url: location.href, title: document.title.slice(0, 140) };
}

export async function saveWord(r: WordLookup, sentence?: string, translation?: string) {
  try {
    const { created } = await vocab.add({
      word: r.query,
      lemma: r.lemma,
      ipa: r.ipa,
      meaning: primaryMeaning(r),
      pos: r.context?.likelyPos ?? r.posList[0],
      sentence: sentence ?? r.context?.sentence,
      translation,
      sourceUrl: location.href,
      sourceTitle: document.title,
    });
    toast(created ? `Đã lưu “${r.lemma}” vào sổ từ` : `“${r.lemma}” đã có trong sổ từ`, 'ok');
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

export async function savePhrase(phrase: string, meaning: string, sentence?: string) {
  try {
    const { created } = await vocab.add({ word: phrase, lemma: phrase.toLowerCase(), meaning, pos: 'phrase', sentence, sourceUrl: location.href, sourceTitle: document.title });
    toast(created ? `Đã lưu “${phrase}”` : `“${phrase}” đã có trong sổ từ`, 'ok');
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

export async function openSidebar(payload?: SidebarPayload) {
  try {
    await send({ type: 'sidebar:open', payload });
  } catch (e) {
    const msg = (e as Error).message;
    toast(/user gesture/i.test(msg) ? 'Hãy bấm biểu tượng LingoLens trên thanh công cụ để mở sidebar.' : msg, 'error');
  }
}

export function openSettings(section?: string) {
  void send({ type: 'options:open', section }).catch((e) => toast((e as Error).message, 'error'));
}

export function currentPayload(): SidebarPayload | undefined {
  const top = store.get().popup?.stack.at(-1);
  if (top?.kind === 'lookup') return { type: 'lookup', text: top.req.text, context: top.req.context, result: top.result, source: pageSource() };
  if (top?.kind === 'ocr') {
    const t = store.get().targets.find((x) => x.id === top.targetId);
    if (t?.result) return { type: 'ocr', result: t.result, source: pageSource() };
  }
  return undefined;
}

// ---------------------------------------------------------------- OCR

let targetSeq = 0;

function viewportRect(): Rect {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const l = Math.max(a.left, b.left);
  const t = Math.max(a.top, b.top);
  const r = Math.min(a.left + a.width, b.left + b.width);
  const btm = Math.min(a.top + a.height, b.top + b.height);
  return r - l > 4 && btm - t > 4 ? { left: l, top: t, width: r - l, height: btm - t } : null;
}

export function imageSource(el: Element): string | undefined {
  if (el instanceof HTMLImageElement) return el.currentSrc || el.src;
  if (el instanceof HTMLCanvasElement) return undefined;
  const bg = getComputedStyle(el).backgroundImage;
  return bg.match(/url\(["']?(.*?)["']?\)/)?.[1];
}

function pixelsIfReadable(el: Element): string | undefined {
  try {
    if (el instanceof HTMLCanvasElement) return el.width * el.height <= 30e6 ? el.toDataURL('image/png') : undefined;
    if (!(el instanceof HTMLImageElement) || !el.complete || !el.naturalWidth) return undefined;
    const src = el.currentSrc || el.src;
    const sameOrigin = src.startsWith('blob:') || src.startsWith('data:') || new URL(src, location.href).origin === location.origin;
    if (!sameOrigin || el.naturalWidth * el.naturalHeight > 30e6) return undefined;
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    c.getContext('2d')!.drawImage(el, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return undefined; // tainted canvas (cross-origin) → background will fetch or capture
  }
}

/** Finds a sufficiently large image (img / canvas / background-image) under a viewport point. */
export function imageAt(x: number, y: number, host: Element): Element | null {
  const min = store.get().settings.ocr.minImageSize;
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host || host.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < min * 0.6 || r.height < min * 0.6 || Math.max(r.width, r.height) < min) continue;
    if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) return el;
    if (el !== document.body && el !== document.documentElement && /url\(/.test(getComputedStyle(el).backgroundImage)) return el;
  }
  return null;
}

/** Largest visible image near the viewport centre (keyboard command fallback). */
export function mainImage(host: Element): Element | null {
  const min = store.get().settings.ocr.minImageSize;
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('img, canvas')) {
    if (host.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const v = intersect({ left: r.left, top: r.top, width: r.width, height: r.height }, viewportRect());
    if (!v || Math.max(r.width, r.height) < min) continue;
    const area = v.width * v.height;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best;
}

async function runScan(t: OcrTarget, target: ScanTarget, sidebarJob = false) {
  const jobId = `${t.id}-${Date.now()}`;
  updateTarget(t.id, { jobId, status: 'running', progress: 0, statusText: 'đang chuẩn bị', error: undefined });
  try {
    const result = await send({ type: 'ocr:scan', jobId, target });
    updateTarget(t.id, { status: 'done', result, progress: 1, statusText: '' });
    if (sidebarJob) {
      const edits = store.get().targets.find((x) => x.id === t.id)?.edits ?? {};
      void send({ type: 'sidebar:push', payload: { type: 'ocr', result: { ...result, blocks: result.blocks.map((b) => ({ ...b, text: edits[b.id] ?? b.text })) }, source: pageSource() } }).catch(() => {});
    }
    // A region scan targets one bubble: show its meaning popup right away (largest text block).
    if (t.kind === 'region' && result.blocks.length) {
      const done = store.get().targets.find((x) => x.id === t.id);
      const rect = done && targetRect(done);
      const main = result.blocks.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
      if (rect) openOcrBlock(t.id, main.id, blockRect(rect, main.box));
    }
    if (!result.blocks.length) toast('Không nhận diện được chữ nào. Thử chọn vùng nhỏ hơn quanh bong bóng thoại hoặc giảm ngưỡng tin cậy.', 'info');
    else toast(`OCR: ${result.blocks.length} vùng chữ${result.fromCache ? ' (từ cache)' : ''}${result.partial ? ' – chỉ phần ảnh đang hiển thị' : ''}`, 'ok');
  } catch (e) {
    const err = e as MessageError;
    // No error card over the page: a short toast, and the outline disappears.
    store.set((s) => ({ targets: s.targets.filter((x) => x.id !== t.id) }));
    if (err.code === 'cancelled') toast('Đã hủy OCR.', 'info');
    else toast(`OCR lỗi: ${err.message}`, 'error');
    if (sidebarJob) void send({ type: 'sidebar:push', payload: { type: 'ocr', pending: false, error: err.code === 'cancelled' ? 'Đã hủy quét.' : err.message, source: pageSource() } }).catch(() => {});
  }
}

/** Removes earlier OCR results (cancelling running scans) so only the newest scan is shown. */
function clearOtherTargets(keep?: Element) {
  const st = store.get();
  const isKept = (t: OcrTarget) => !!keep && t.el === keep;
  for (const t of st.targets) {
    if (!isKept(t) && t.status === 'running' && t.jobId) void send({ type: 'ocr:cancel', jobId: t.jobId }).catch(() => {});
  }
  const popupOnOld = st.popup?.stack.some((v) => v.kind === 'ocr');
  store.set((s) => ({ targets: s.targets.filter(isKept), popup: popupOnOld ? null : s.popup }));
}

/** Removes all OCR boxes from the page. */
export function clearOcr() {
  clearOtherTargets();
}

/**
 * Click outside the bubbles: hide finished OCR results (boxes, errors). A scan that is still running
 * is kept so a stray click does not cancel it. Results stay in the OCR cache, so rescanning is instant.
 */
export function dismissOcrResults() {
  const st = store.get();
  if (!st.targets.some((t) => t.status !== 'running')) return;
  store.set((s) => ({ targets: s.targets.filter((t) => t.status === 'running') }));
}

let lastWarm = 0;
/** Starts the OCR worker ahead of time (hover on a manga image, region selection) – at most every 2 min. */
export function warmOcr() {
  const s = store.get().settings;
  if (!s.ocr.enabled || Date.now() - lastWarm < 120_000) return;
  lastWarm = Date.now();
  void send({ type: 'ocr:warmup', lang: s.ocr.language }).catch(() => (lastWarm = 0));
}

/**
 * Full-page scan from the "Quét OCR" button: opens this tab's sidebar right away (inside the click,
 * Chrome requires the gesture) with a "scanning" state; the bubble list is pushed when done.
 */
export function scanImageToSidebar(el: Element) {
  const s = store.get().settings;
  if (!s.sidebar.enabled) return scanImage(el);
  clearOtherTargets(); // old boxes disappear right away, not after the panel has opened
  store.set({ hoverImage: null });
  // Opening the side panel narrows the page and the reader re-lays out its images. Measure and
  // capture only after that, otherwise the OCR boxes would not line up with the bubbles.
  const w0 = window.innerWidth;
  const opened = openSidebar({ type: 'ocr', pending: true, source: pageSource() });
  void opened.then(async () => {
    const t0 = Date.now();
    while (window.innerWidth === w0 && Date.now() - t0 < 350) await new Promise((r) => setTimeout(r, 50));
    if (window.innerWidth !== w0) await new Promise((r) => setTimeout(r, 300)); // let the page re-layout
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    scanImage(el, true);
  });
}

export function scanImage(el: Element, sidebarJob = false) {
  const s = store.get().settings;
  if (!s.ocr.enabled) return toast('OCR đang tắt trong Cài đặt.', 'info');
  clearOtherTargets(el);
  const r = el.getBoundingClientRect();
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const vis = intersect(rect, viewportRect());
  if (!vis) return toast('Ảnh không nằm trong vùng hiển thị.', 'error');
  const existing = store.get().targets.find((t) => t.el === el);
  if (existing?.status === 'running') return;
  const t: OcrTarget = existing ?? { id: `t${++targetSeq}`, kind: 'image', el, status: 'running', progress: 0, statusText: '', edits: {}, hidden: false };
  if (!existing) store.set((st) => ({ targets: [...st.targets, t] }));
  else updateTarget(t.id, { hidden: false });
  const src = imageSource(el);
  const natural = el instanceof HTMLImageElement ? `${el.naturalWidth}x${el.naturalHeight}` : '';
  const target: ScanTarget = {
    src: src && !src.startsWith('data:') ? src : undefined,
    dataUrl: pixelsIfReadable(el),
    viewportRect: { x: vis.left, y: vis.top, w: vis.width, h: vis.height },
    visibleFraction: { x: (vis.left - rect.left) / rect.width, y: (vis.top - rect.top) / rect.height, w: vis.width / rect.width, h: vis.height / rect.height },
    devicePixelRatio: window.devicePixelRatio || 1,
    cacheKey: src && !src.startsWith('data:') && !src.startsWith('blob:') ? `${src}|${natural}` : undefined,
    layout: s.ocr.layout,
    lang: s.ocr.language,
    useCache: s.ocr.autoCache,
  };
  void runScan(t, target, sidebarJob);
}

/** Region scan; `rect` in viewport coordinates. */
export function scanRegion(rect: Rect) {
  const s = store.get().settings;
  if (!s.ocr.enabled) return toast('OCR đang tắt trong Cài đặt.', 'info');
  clearOtherTargets();
  const t: OcrTarget = {
    id: `t${++targetSeq}`,
    kind: 'region',
    region: { left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height },
    status: 'running',
    progress: 0,
    statusText: '',
    edits: {},
    hidden: false,
  };
  store.set((st) => ({ targets: [...st.targets, t], regionSelect: false }));
  void runScan(t, {
    viewportRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    devicePixelRatio: window.devicePixelRatio || 1,
    layout: s.ocr.layout === 'sparse' && rect.width * rect.height < 250_000 ? 'block' : s.ocr.layout,
    lang: s.ocr.language,
    useCache: s.ocr.autoCache,
  });
}

export function cancelScan(t: OcrTarget) {
  if (t.jobId) void send({ type: 'ocr:cancel', jobId: t.jobId }).catch(() => {});
  updateTarget(t.id, { status: 'cancelled', statusText: 'đang hủy…' });
}

export function removeTarget(id: string) {
  store.set((s) => ({ targets: s.targets.filter((t) => t.id !== id), popup: s.popup?.stack.some((v) => v.kind === 'ocr' && v.targetId === id) ? null : s.popup }));
}

/** Viewport rectangle of a scan target (image element or document-anchored region). */
export function targetRect(t: OcrTarget): Rect | null {
  if (t.kind === 'image' && t.el) {
    if (!t.el.isConnected) return null;
    const r = t.el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  if (t.region) return { left: t.region.left - window.scrollX, top: t.region.top - window.scrollY, width: t.region.width, height: t.region.height };
  return null;
}

/** Viewport rectangle of an OCR block (normalised box inside the target), padded by 3px. */
export function blockRect(rect: Rect, b: { x: number; y: number; w: number; h: number }): Rect {
  return { left: rect.left + b.x * rect.width - 3, top: rect.top + b.y * rect.height - 3, width: b.w * rect.width + 6, height: b.h * rect.height + 6 };
}

export function openOcrBlock(targetId: string, blockId: string, anchor: Rect) {
  const found = findBlock(targetId, blockId);
  if (!found) return;
  const text = found.target.edits[blockId] ?? found.block.text;
  store.set({ trigger: null, popup: { open: true, anchor, stack: [{ kind: 'ocr', targetId, blockId, text, editing: false }], tab: 'ocr', prefer: 'side' } });
}

/**
 * The user dragged a bubble's border to cover words the scan missed: read just that rectangle again
 * and replace the bubble's text and box (same number, popup and sidebar updated).
 */
export async function rescanBlock(targetId: string, blockId: string, vp: Rect) {
  const s = store.get().settings;
  const t = store.get().targets.find((x) => x.id === targetId);
  const trect = t && targetRect(t);
  if (!t?.result || !trect) return;
  const r = {
    left: Math.max(0, vp.left),
    top: Math.max(0, vp.top),
    width: Math.min(window.innerWidth, vp.left + vp.width) - Math.max(0, vp.left),
    height: Math.min(window.innerHeight, vp.top + vp.height) - Math.max(0, vp.top),
  };
  if (r.width < 12 || r.height < 12) return toast('Vùng quá nhỏ để quét lại.', 'info');
  updateTarget(targetId, { rescanning: blockId });
  try {
    const res = await send({
      type: 'ocr:scan',
      jobId: `${targetId}-${blockId}-${Date.now()}`,
      target: { viewportRect: { x: r.left, y: r.top, w: r.width, h: r.height }, devicePixelRatio: window.devicePixelRatio || 1, layout: 'block', lang: s.ocr.language, useCache: false },
    });
    const cur = store.get().targets.find((x) => x.id === targetId);
    if (!cur?.result) return;
    const text = res.blocks.map((b) => b.text).join(' ').trim();
    if (!text) {
      toast('Không đọc được chữ nào trong vùng mới. Thử kéo rộng hơn một chút.', 'info');
      return;
    }
    // new box: the resized rectangle, normalised to the scanned image/region
    const box = { x: (r.left - trect.left) / trect.width, y: (r.top - trect.top) / trect.height, w: r.width / trect.width, h: r.height / trect.height };
    const lines = res.blocks.flatMap((b) =>
      b.lines.map((l) => ({
        ...l,
        box: { x: box.x + l.box.x * box.w, y: box.y + l.box.y * box.h, w: l.box.w * box.w, h: l.box.h * box.h },
        words: l.words.map((w) => ({ ...w, box: { x: box.x + w.box.x * box.w, y: box.y + w.box.y * box.h, w: w.box.w * box.w, h: w.box.h * box.h } })),
      })),
    );
    const confidence = Math.round(res.blocks.reduce((k, b) => k + b.confidence, 0) / Math.max(1, res.blocks.length));
    const blocks = cur.result.blocks.map((b) => (b.id === blockId ? { ...b, text, box, lines, confidence } : b));
    const result = { ...cur.result, blocks, text: blocks.map((b) => b.text).join('\n\n') };
    const edits = { ...cur.edits };
    delete edits[blockId];
    updateTarget(targetId, { result, edits });
    // refresh the open popup / sidebar list
    const anchor = blockRect(trect, box);
    openOcrBlock(targetId, blockId, anchor);
    if (cur.kind === 'image') void send({ type: 'sidebar:push', payload: { type: 'ocr', result, source: pageSource() } }).catch(() => {});
    toast('Đã quét lại bong bóng.', 'ok');
  } catch (e) {
    if ((e as MessageError).code !== 'cancelled') toast(`OCR lỗi: ${(e as Error).message}`, 'error');
  } finally {
    updateTarget(targetId, { rescanning: undefined });
  }
}

/**
 * Adds a bubble the scan missed: the user drags a rectangle over the text; ONLY that rectangle is read and a new numbered bubble is
 * appended (the other bubbles are not touched). When nothing can be read the bubble is still added, empty, and opened for typing.
 */
export async function addBlock(targetId: string, vp: Rect) {
  const s = store.get().settings;
  const t = store.get().targets.find((x) => x.id === targetId);
  const trect = t && targetRect(t);
  if (!t?.result || !trect) return;
  const r = {
    left: Math.max(trect.left, vp.left),
    top: Math.max(trect.top, vp.top),
    width: Math.min(trect.left + trect.width, vp.left + vp.width) - Math.max(trect.left, vp.left),
    height: Math.min(trect.top + trect.height, vp.top + vp.height) - Math.max(trect.top, vp.top),
  };
  store.set({ addBubble: null });
  if (r.width < 12 || r.height < 12) return toast('Vùng quá nhỏ để thêm bong bóng.', 'info');
  const box = { x: (r.left - trect.left) / trect.width, y: (r.top - trect.top) / trect.height, w: r.width / trect.width, h: r.height / trect.height };
  const id = `m${Date.now().toString(36)}`;
  type Block = NonNullable<OcrTarget['result']>['blocks'][number];
  // 1. the bubble exists at once (a dashed empty box) so the user sees it
  const base: Block = { id, text: '', confidence: 0, box, lines: [] };
  const put = (b: Block) => {
    const cur = store.get().targets.find((x) => x.id === targetId);
    if (!cur?.result) return;
    const blocks = cur.result.blocks.some((x) => x.id === id) ? cur.result.blocks.map((x) => (x.id === id ? b : x)) : [...cur.result.blocks, b];
    updateTarget(targetId, { result: { ...cur.result, blocks, text: blocks.map((x) => x.text).join('\n\n') } });
  };
  put(base);
  updateTarget(targetId, { rescanning: id });
  try {
    const res = await send({
      type: 'ocr:scan',
      jobId: `${targetId}-${id}`,
      target: { viewportRect: { x: r.left, y: r.top, w: r.width, h: r.height }, devicePixelRatio: window.devicePixelRatio || 1, layout: 'block', lang: s.ocr.language, useCache: false },
    });
    const text = res.blocks.map((b) => b.text).join(' ').trim();
    const lines = res.blocks.flatMap((b) =>
      b.lines.map((l) => ({
        ...l,
        box: { x: box.x + l.box.x * box.w, y: box.y + l.box.y * box.h, w: l.box.w * box.w, h: l.box.h * box.h },
        words: l.words.map((w) => ({ ...w, box: { x: box.x + w.box.x * box.w, y: box.y + w.box.y * box.h, w: w.box.w * box.w, h: w.box.h * box.h } })),
      })),
    );
    const confidence = Math.round(res.blocks.reduce((k, b) => k + b.confidence, 0) / Math.max(1, res.blocks.length));
    put({ id, text, confidence, box, lines });
    if (!text) toast('Không đọc được chữ trong vùng này: hãy gõ nội dung cho bong bóng.', 'info');
    else toast('Đã thêm bong bóng.', 'ok');
  } catch (e) {
    if ((e as MessageError).code !== 'cancelled') toast(`OCR lỗi: ${(e as Error).message}. Hãy gõ nội dung cho bong bóng.`, 'error');
  } finally {
    updateTarget(targetId, { rescanning: undefined });
  }
  const done = store.get().targets.find((x) => x.id === targetId);
  if (done?.result) {
    openOcrBlock(targetId, id, blockRect(trect, box));
    if (!done.result.blocks.find((b) => b.id === id)?.text) setOcrEditing(true); // nothing read: let the user type it
    if (done.kind === 'image') void send({ type: 'sidebar:push', payload: { type: 'ocr', result: done.result, source: pageSource() } }).catch(() => {});
  }
}

export function editOcrBlock(targetId: string, blockId: string, text: string) {
  const t = store.get().targets.find((x) => x.id === targetId);
  if (!t) return;
  updateTarget(targetId, { edits: { ...t.edits, [blockId]: text } });
  store.set((s) => {
    if (!s.popup) return {};
    const stack = s.popup.stack.map((v) => (v.kind === 'ocr' && v.blockId === blockId && v.targetId === targetId ? { ...v, text, editing: false } : v));
    return { popup: { ...s.popup, stack } };
  });
}

export function setOcrEditing(editing: boolean) {
  store.set((s) => {
    if (!s.popup) return {};
    const stack = s.popup.stack.map((v, i, a) => (i === a.length - 1 && v.kind === 'ocr' ? { ...v, editing } : v));
    return { popup: { ...s.popup, stack } };
  });
}

