/**
 * iPhone scan screen: the screenshot (from the Shortcuts action or the photo library) fitted to the
 * screen – pinch to zoom, drag to pan, double tap to zoom – with a frame to drag onto a bubble /
 * sentence / word: “Quét vùng này”, or “Quét toàn màn hình” for every bubble (numbered).
 * Results live in a bottom sheet: every bubble with its natural translation (Apple Translation,
 * all bubbles in one request), dictionary gloss and words (save each word, add your own notes).
 * Bubbles can be re-framed (drag the corners of the selected bubble → only that area is read
 * again). Text recognition is Apple Vision on the device.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LookupResult, OcrBlock } from '@/shared/types';
import { send } from '@/shared/messages';
import { bubbleBlock, groupLines } from '@/ocr/result';
import { plausibleText } from '@/ocr/bubbles';
import { ocrWords } from '@/ocr/words';
import { resizeRect, type Handle, type Rect } from '@/popup/position';
import { primaryMeaning } from '@/ui/views';
import { Spinner, cx } from '@/ui/components';
import { IconBack, IconScan, IconVolume } from '@/ui/icons';
import { canSpeak, speak } from '@/ui/speech';
import { useSettings } from '@/ui/hooks';
import { copyText, recognize, translateBatch } from './ios';
import { Assist, type AssistItem } from './Assist';
import { IconCopy } from '@/ui/icons';
import { prepareForMt } from '@/translation/chrome-mt';
import { isMostlyUpper, naturalCase } from '@/translation/casing';

type Box = { x: number; y: number; w: number; h: number }; // normalised 0..1 of the image
type Mt = { state: 'loading' | 'done' | 'error' | 'off'; text?: string; error?: string };

async function toBase64(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Không đọc được ảnh.'));
    r.readAsDataURL(blob);
  });
}

/** Opens the Lookup tab with a word / sentence (same content as the extension's sidebar). */
export function openLookup(text: string, tab?: 'translation' | 'vocabulary' | 'grammar' | 'context') {
  if (tab) (globalThis as { __mlNextSidebarTab?: string }).__mlNextSidebarTab = tab;
  void send({ type: 'sidebar:push', payload: { type: 'lookup', text } }).then(() => {
    location.hash = 'lookup';
  });
}

const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];
// 36 px touch area (easy to grab) around a small 12 px dot (does not hide the text)
const CORNER_POS: Record<string, string> = { nw: '-left-[18px] -top-[18px]', ne: '-right-[18px] -top-[18px]', sw: '-left-[18px] -bottom-[18px]', se: '-right-[18px] -bottom-[18px]' };

const wordLookup = (w: string, context?: string) =>
  send({ type: 'lookup', req: { text: w, context, mode: 'word', assumeEnglish: true } }).then((r: LookupResult) => (r.kind === 'word' ? r : null));

/**
 * Proper names of the given texts (lower case): words of ALL CAPS bubbles that are not in the
 * dictionary. Lookups run in parallel and are capped at 700 ms so translation never waits long.
 */
async function findNames(texts: string[]): Promise<Set<string>> {
  const words = [...new Set(texts.filter(isMostlyUpper).flatMap((t) => ocrWords(t)))];
  if (!words.length) return new Set();
  const results = await Promise.race([
    Promise.all(words.map((w) => wordLookup(w).catch(() => null))),
    new Promise<null>((r) => setTimeout(() => r(null), 700)),
  ]);
  if (!results) return new Set();
  return new Set(words.filter((_, i) => !results[i]?.found).map((w) => w.toLowerCase()));
}

/**
 * Natural translations of the bubbles: all new texts go to the phone in ONE request; results are
 * cached by text (re-framing a bubble only translates that bubble again).
 */
function useBatchTranslation(blocks: OcrBlock[]): Record<string, Mt> {
  const cache = useRef(new Map<string, Mt>());
  const [, bump] = useState(0);
  const key = blocks.map((b) => b.text).join('\u0001');
  useEffect(() => {
    const todo = [...new Set(blocks.map((b) => b.text))].filter((t) => !cache.current.has(t));
    if (!todo.length) return;
    for (const t of todo) cache.current.set(t, { state: 'loading' });
    bump((n) => n + 1);
    void (async () => {
      const names = await findNames(todo);
      try {
        const out = await translateBatch(todo.map((t) => prepareForMt(naturalCase(t, (w) => names.has(w)))));
        todo.forEach((t, i) => cache.current.set(t, out ? { state: 'done', text: out[i] } : { state: 'off' }));
      } catch (e) {
        todo.forEach((t) => cache.current.set(t, { state: 'error', error: (e as Error).message }));
      }
      bump((n) => n + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return Object.fromEntries(blocks.map((b) => [b.id, cache.current.get(b.text) ?? { state: 'loading' }]));
}

export type HlBox = { x: number; y: number; w: number; h: number };

export function Scan({
  src,
  onBack,
  onNewFile,
  extraItems = [],
  highlightMode = false,
  highlights = [],
  onHighlights,
  onActiveText,
  pager,
  title = 'Quét chữ',
}: {
  src: string;
  onBack: () => void;
  onNewFile?: (f: File) => void;
  /** Items the app adds to the floating button (notes, highlight…). */
  extraItems?: AssistItem[];
  highlightMode?: boolean;
  highlights?: HlBox[];
  onHighlights?: (h: HlBox[]) => void;
  /** Text of the selected bubble (context for notes). */
  onActiveText?: (t: string | undefined) => void;
  /** PDF: current page / page count / go to a page. */
  pager?: { page: number; total: number; go: (p: number) => void };
  /** Title in the top bar (file name, …). */
  title?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box>({ x: 0.15, y: 0.38, w: 0.7, h: 0.18 });
  const [showFrame, setShowFrame] = useState(true);
  const [busy, setBusy] = useState<false | 'region' | 'full'>(false);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState<OcrBlock[]>([]);
  const [mode, setMode] = useState<'region' | 'full'>('region'); // how the current bubbles were scanned
  const [active, setActive] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null); // jump + flash in the sheet
  const [edit, setEdit] = useState<{ id: string; box: Box } | null>(null); // bubble being re-framed
  const [rescanning, setRescanning] = useState<string | null>(null);
  const [sheetKey, setSheetKey] = useState(0); // bumps → the result sheet rises to its middle height
  const fileInput = useRef<HTMLInputElement>(null);
  const [hlDraft, setHlDraft] = useState<HlBox | null>(null); // highlight being drawn
  const hlStart = useRef<{ x: number; y: number } | null>(null);
  const [hlMenu, setHlMenu] = useState<number | null>(null); // tapped highlight
  const b64 = useRef<Promise<string> | null>(null);
  const drag = useRef<{ kind: 'move' | Handle; target: 'frame' | string; x: number; y: number; start: Rect; moved: boolean } | null>(null);
  const translations = useBatchTranslation(blocks);

  // ---------------------------------------------------------------- zoom / pan of the screenshot
  const [aspect, setAspect] = useState(9 / 19.5);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const fit = (() => {
    const w = Math.min(vp.w, vp.h * aspect);
    return { w, h: w / aspect };
  })();
  /** Keeps the image on screen: centred while smaller than the viewport, edge-to-edge otherwise. */
  const clampView = (s: number, x: number, y: number) => {
    const W = fit.w * s;
    const H = fit.h * s;
    return {
      s,
      x: W <= vp.w ? (vp.w - W) / 2 : Math.min(0, Math.max(vp.w - W, x)),
      y: H <= vp.h ? (vp.h - H) / 2 : Math.min(0, Math.max(vp.h - H, y)),
    };
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => setView(clampView(1, 0, 0)), [vp.w, vp.h, aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearBubbles = () => {
    setBlocks([]);
    setActive(null);
    setFocus(null);
    setEdit(null);
    setError('');
    setShowFrame(true);
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'pinch'; x: number; y: number; dist: number; view: typeof view; onBubble: boolean } | null>(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const local = (e: React.PointerEvent) => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startGesture = (onBubble = false) => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { kind: 'pinch', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, view, onBubble: false };
    } else if (pts.length === 1) {
      gesture.current = { kind: 'pan', x: pts[0].x, y: pts[0].y, dist: 0, view, onBubble };
    } else gesture.current = null;
  };
  /** Pointer position as a fraction of the image (0..1). */
  const onImage = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onViewDown = (e: React.PointerEvent) => {
    viewport.current?.setPointerCapture(e.pointerId);
    if (highlightMode && pointers.current.size === 0 && !(e.target instanceof Element && e.target.closest('[data-ml-hl-box]'))) {
      hlStart.current = onImage(e);
      setHlDraft({ ...hlStart.current, w: 0, h: 0 });
      return;
    }
    pointers.current.set(e.pointerId, local(e));
    startGesture(e.target instanceof Element && !!e.target.closest('[data-ml-bubble-box]'));
  };
  const onViewMove = (e: React.PointerEvent) => {
    if (drag.current) return onMove(e); // dragging the scan frame / a bubble's corners
    if (hlStart.current) {
      const p = onImage(e);
      const s = hlStart.current;
      setHlDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(5, Math.max(1, (g.view.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const cx = (g.x - g.view.x) / g.view.s;
      const cy = (g.y - g.view.y) / g.view.s;
      setView(clampView(s, mid.x - cx * s, mid.y - cy * s));
    } else if (g.kind === 'pan' && pts.length === 1) {
      setView(clampView(g.view.s, g.view.x + (pts[0].x - g.x), g.view.y + (pts[0].y - g.y)));
    }
  };
  const onViewUp = (e: React.PointerEvent) => {
    if (drag.current) return onUp();
    if (hlStart.current) {
      hlStart.current = null;
      if (hlDraft && hlDraft.w > 0.015 && hlDraft.h > 0.008) onHighlights?.([...highlights, hlDraft]);
      setHlDraft(null);
      return;
    }
    const p = pointers.current.get(e.pointerId);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (p && g?.kind === 'pan' && Math.hypot(p.x - g.x, p.y - g.y) < 8) {
      const now = performance.now();
      if (now - lastTap.current.t < 300 && Math.hypot(p.x - lastTap.current.x, p.y - lastTap.current.y) < 30) {
        // double tap: zoom in at the finger / back to fit
        clearTimeout(tapTimer.current);
        if (view.s > 1.05) setView(clampView(1, 0, 0));
        else {
          const s = 2.5;
          const cx = (p.x - view.x) / view.s;
          const cy = (p.y - view.y) / view.s;
          setView(clampView(s, p.x - cx * s, p.y - cy * s));
        }
        lastTap.current = { t: 0, x: 0, y: 0 };
      } else {
        lastTap.current = { t: now, x: p.x, y: p.y };
        // single tap outside the bubble of a one-sentence scan: close it (after the double-tap window)
        if (!g.onBubble && mode === 'region' && blocks.length && !showFrame) {
          clearTimeout(tapTimer.current);
          tapTimer.current = setTimeout(clearBubbles, 300);
        }
      }
    }
    startGesture();
  };
  const animating = !gesture.current && !drag.current;

  useEffect(() => {
    b64.current = toBase64(src);
    b64.current.catch(() => setError('Không đọc được ảnh.'));
    clearBubbles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ---------------------------------------------------------------- scan frame / bubble corners (drag / resize)
  const size = () => {
    const r = wrap.current?.getBoundingClientRect();
    return { w: r?.width ?? 1, h: r?.height ?? 1 };
  };
  const onDown = (kind: 'move' | Handle, target: 'frame' | string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    viewport.current?.setPointerCapture(e.pointerId);
    const { w, h } = size();
    const b = target === 'frame' ? frame : (edit?.id === target ? edit.box : blocks.find((x) => x.id === target)?.box);
    if (!b) return;
    drag.current = { kind, target, x: e.clientX, y: e.clientY, start: { left: b.x * w, top: b.y * h, width: b.w * w, height: b.h * h }, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { w, h } = size();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    let r = d.kind === 'move' ? { ...d.start, left: d.start.left + dx, top: d.start.top + dy } : resizeRect(d.start, d.kind, dx, dy);
    r = { ...r, width: Math.min(r.width, w), height: Math.min(r.height, h) };
    r.left = Math.min(Math.max(0, r.left), w - r.width);
    r.top = Math.min(Math.max(0, r.top), h - r.height);
    const box = { x: r.left / w, y: r.top / h, w: r.width / w, h: r.height / h };
    if (d.target === 'frame') setFrame(box);
    else setEdit({ id: d.target, box });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.target !== 'frame' && d.moved && edit) void rescanBubble(edit.id, edit.box);
  };

  /** The user re-framed a bubble: read only that area again and replace its text. */
  const rescanBubble = async (id: string, box: Box) => {
    setRescanning(id);
    try {
      const image = await (b64.current ?? toBase64(src));
      const lines = await recognize(image, box);
      const one = lines.length ? bubbleBlock(lines, id, true) : null;
      if (!one) {
        setError('Không thấy chữ trong vùng vừa chỉnh. Kéo góc để khung trùng lên chữ.');
        return;
      }
      setBlocks((list) => list.map((b) => (b.id === id ? { ...one, id, box } : b)));
      setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEdit(null);
      setRescanning(null);
    }
  };

  const runId = useRef(0);
  /** Stops waiting for the scan in progress (its result is ignored when it arrives). */
  const cancel = () => {
    runId.current++;
    setBusy(false);
  };
  const run = async (scanMode: 'region' | 'full', box?: HlBox) => {
    const id = ++runId.current;
    setBusy(scanMode);
    setError('');
    try {
      const image = await (b64.current ?? toBase64(src));
      const lines = await recognize(image, scanMode === 'region' ? (box ?? frame) : undefined);
      if (id !== runId.current) return; // cancelled
      let found: OcrBlock[];
      if (scanMode === 'region') {
        // the user framed one bubble / sentence / word: everything inside is one text
        const one = lines.length ? bubbleBlock(lines, 'b0', true) : null;
        found = one ? [one] : [];
      } else {
        found = groupLines(lines, { reline: false }).filter((b) => plausibleText(b.text, b.confidence, true));
      }
      setMode(scanMode);
      setBlocks(found);
      setActive(found[0]?.id ?? null);
      setFocus(null);
      setEdit(null);
      setShowFrame(false);
      setSheetKey((k) => k + 1);
      if (!found.length) setError(scanMode === 'region' ? 'Không thấy chữ trong khung. Kéo khung trùng lên chữ rồi quét lại.' : 'Không nhận ra chữ nào trong ảnh.');
    } catch (e) {
      if (id === runId.current) setError((e as Error).message);
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const inv = 1 / view.s; // keeps dots, labels and borders the same size while zoomed
  // the selected bubble's text is the context of new notes
  useEffect(() => onActiveText?.(blocks.find((b) => b.id === active)?.text), [active, blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectBubble = (id: string) => {
    setActive(id);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };

  return (
    <div className="mx-auto max-w-2xl" data-ml-scan="">
      {/* minimal top bar: back button + page title (+ the page switcher of a PDF); tools are in the floating button */}
      <div className="ml-glass-bar sticky top-0 z-10 flex h-11 items-center gap-1 border-b px-2" data-ml-scan-bar="">
        <button type="button" onClick={onBack} className="ml-press flex h-9 w-9 items-center justify-center rounded-full text-muted" aria-label="Quay lại" data-ml-scan-back="">
          <IconBack size={22} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[15.5px] font-bold">{title}</div>
      </div>
      {pager && pager.total > 1 && (
        <div className="fixed right-2 top-[calc(env(safe-area-inset-top)+4px)] z-[11] flex items-center gap-0.5 text-[13px] font-semibold" data-ml-pager="">
          <button type="button" disabled={pager.page <= 0} onClick={() => pager.go(pager.page - 1)} className="ml-press h-8 w-8 rounded-full disabled:opacity-30" aria-label="Trang trước">
            ‹
          </button>
          <span className="min-w-[64px] text-center tabular-nums">
            {pager.page + 1} / {pager.total}
          </span>
          <button type="button" disabled={pager.page >= pager.total - 1} onClick={() => pager.go(pager.page + 1)} className="ml-press h-8 w-8 rounded-full disabled:opacity-30" aria-label="Trang sau">
            ›
          </button>
        </div>
      )}
      {onNewFile && (
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.heic,.heif,.pdf,application/pdf,.txt,.srt,.vtt,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onNewFile(file);
            e.target.value = '';
          }}
        />
      )}
      <Assist
        items={[
          ...extraItems,
          ...(onNewFile ? [{ id: 'file', label: 'Tệp khác', icon: '📎', onClick: () => fileInput.current?.click() }] : []),
          ...(!showFrame && blocks.length ? [{ id: 'clear', label: 'Xoá bóng', icon: '🧹', onClick: clearBubbles }] : []),
          ...(!showFrame && !blocks.length ? [{ id: 'frame', label: 'Khung mới', icon: '⬚', onClick: () => setShowFrame(true) }] : []),
          ...(view.s > 1.05 ? [{ id: 'fit', label: 'Vừa khung', icon: '⤢', onClick: () => setView(clampView(1, 0, 0)) }] : []),
        ]}
      />

      {/* the screenshot fits the screen; pinch to zoom, drag to move, double tap to zoom in / out */}
      <div
        ref={viewport}
        className="relative h-[calc(100dvh-env(safe-area-inset-top)-44px-164px-env(safe-area-inset-bottom))] select-none touch-none overflow-hidden"
        onPointerDown={onViewDown}
        onPointerMove={onViewMove}
        onPointerUp={onViewUp}
        onPointerCancel={onViewUp}
        data-ml-scan-viewport=""
      >
        <div
          ref={wrap}
          className={cx('absolute left-0 top-0 origin-top-left', animating && 'transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)]')}
          style={{ width: fit.w, height: fit.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          data-ml-scan-image=""
        >
          <img
            src={src}
            alt="Ảnh cần quét"
            className="block h-full w-full"
            draggable={false}
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
            }}
            onError={() => setError('Không mở được ảnh.')}
          />
          {!showFrame &&
            blocks.map((b, i) => {
              const box = edit?.id === b.id ? edit.box : b.box;
              const on = b.id === active;
              return (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectBubble(b.id)}
                  onPointerDown={on ? onDown('move', b.id) : undefined}
                  className={cx(
                    'absolute rounded-md',
                    on ? 'border-accent bg-accent/15' : 'border-[rgb(var(--ml-box))] bg-[rgb(var(--ml-box)/0.12)]',
                    on && focus?.id === b.id && (focus.n % 2 ? 'ml-box-pulse-a' : 'ml-box-pulse-b'),
                  )}
                  style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, borderWidth: 2 * inv, borderStyle: 'solid' }}
                  aria-label={`Bong bóng ${i + 1}`}
                  data-ml-bubble-box=""
                >
                  {blocks.length > 1 && (
                    <span className="absolute -left-2 -top-2 flex h-5 min-w-5 origin-top-left items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[11px] font-bold text-white" style={{ scale: String(inv) }}>
                      {i + 1}
                    </span>
                  )}
                  {rescanning === b.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Spinner />
                    </span>
                  )}
                  {/* the selected bubble can be re-framed: drag its corners (or the bubble) */}
                  {on &&
                    !rescanning &&
                    CORNERS.map((h) => (
                      <span key={h} onPointerDown={onDown(h, b.id)} className={cx('absolute flex h-9 w-9 items-center justify-center', CORNER_POS[h])} style={{ scale: String(inv) }} data-ml-bubble-corner="">
                        <span className="pointer-events-none h-3 w-3 rounded-full border-2 border-white bg-accent shadow-[0_1px_3px_rgb(0_0_0/0.4)]" />
                      </span>
                    ))}
                </div>
              );
            })}
          {/* highlights (yellow marker); tap one to translate it or remove it */}
          {[...highlights, ...(hlDraft ? [hlDraft] : [])].map((h, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => i < highlights.length && setHlMenu(i)}
              className={cx('absolute rounded-[3px] bg-[#ffd43b]/45 mix-blend-multiply', hlMenu === i && 'ring-2 ring-[#f59f00]')}
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%` }}
              data-ml-hl-box=""
            />
          ))}
          {showFrame && !highlightMode && (
            <div
              className="absolute rounded-lg border-accent bg-accent/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%`, borderWidth: 2 * inv, borderStyle: 'solid' }}
              onPointerDown={onDown('move', 'frame')}
              data-ml-scan-frame=""
            >
              <span className="pointer-events-none absolute bottom-full left-0 mb-1 origin-bottom-left whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-fg" style={{ scale: String(inv) }}>
                Kéo khung vào chữ cần đọc
              </span>
              {CORNERS.map((h) => (
                <span key={h} onPointerDown={onDown(h, 'frame')} className={cx('absolute flex h-9 w-9 items-center justify-center', CORNER_POS[h])} style={{ scale: String(inv) }} data-ml-scan-corner="">
                  <span className="pointer-events-none h-3 w-3 rounded-full border-2 border-white bg-accent shadow-[0_1px_3px_rgb(0_0_0/0.4)]" />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {highlightMode && (
        <div className="ml-glass-select fixed left-1/2 top-[calc(env(safe-area-inset-top)+56px)] z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold" data-ml-hl-hint="">
          🖍 Kéo trên ảnh để tô sáng
        </div>
      )}
      {hlMenu !== null && highlights[hlMenu] && (
        <>
          <div className="fixed inset-0 z-[26]" onClick={() => setHlMenu(null)} />
          <div className="ml-glass animate-ml-in fixed left-1/2 top-[calc(env(safe-area-inset-top)+56px)] z-[27] flex -translate-x-1/2 gap-1 rounded-full p-1" data-ml-hl-menu="">
            <button
              type="button"
              className="ml-press rounded-full px-3 py-1.5 text-[13px] font-semibold"
              onClick={() => {
                const box = highlights[hlMenu];
                setHlMenu(null);
                void run('region', box);
              }}
            >
              Dịch vùng tô
            </button>
            <button
              type="button"
              className="ml-press rounded-full px-3 py-1.5 text-[13px] font-semibold text-danger"
              onClick={() => {
                onHighlights?.(highlights.filter((_, j) => j !== hlMenu));
                setHlMenu(null);
              }}
            >
              Bỏ tô
            </button>
          </div>
        </>
      )}

      {error && (
        <button type="button" onClick={() => setError('')} className="ml-glass animate-ml-in fixed inset-x-3 bottom-[calc(max(10px,env(safe-area-inset-bottom))+154px)] z-[25] rounded-[22px] px-4 py-3 text-left text-[13.5px] text-text" data-ml-scan-error="">
          ⚠️ {error} <span className="text-subtle">(chạm để ẩn)</span>
        </button>
      )}

      <ResultSheet
        open={!!blocks.length && !showFrame}
        riseKey={sheetKey}
        focus={focus ? `${focus.id}:${focus.n}` : null}
        title={blocks.length > 1 ? `${blocks.length} bong bóng · chạm khung trên ảnh để tới` : 'Kết quả dịch · chạm ra ngoài để đóng'}
      >
        {blocks.map((b, i) => (
          <div key={b.id}>
            {/* a dashed line between bubbles, so each one reads as its own group */}
            {i > 0 && <div className="mx-2 my-3 border-t-2 border-dashed border-text/40" aria-hidden="true" data-ml-divider="" />}
            <div data-ml-block={b.id} className="rounded-[22px]">
              <ScanResult text={b.text} n={blocks.length > 1 ? i + 1 : 0} mt={translations[b.id]} />
            </div>
          </div>
        ))}
        {blocks.length > 0 && (
          <div className="mx-3 mt-3 text-center text-[11.5px] leading-snug text-subtle">
            Chọn một bong bóng rồi kéo 4 chấm ở góc để chỉnh lại vùng – chỉ vùng đó được đọc lại.
          </div>
        )}
      </ResultSheet>

      <div className="ml-glass fixed inset-x-3 bottom-[calc(max(10px,env(safe-area-inset-bottom))+92px)] z-20 flex gap-2 rounded-[26px] p-2">
        {busy ? (
          <>
            <div className="flex flex-1 items-center justify-center gap-2 rounded-[20px] py-2.5 text-[14px] font-semibold text-muted" data-ml-scan-busy="">
              <Spinner /> {busy === 'full' ? 'Đang quét toàn màn hình…' : 'Đang quét vùng này…'}
            </div>
            <button type="button" onClick={cancel} className="ml-press ml-glass-card rounded-[20px] px-5 py-2.5 text-[14px] font-bold text-danger" data-ml-scan-cancel="">
              Hủy quét
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={!showFrame} onClick={() => void run('region')} data-ml-magnetic="" className="ml-press ml-btn-primary ml-ripple flex flex-1 items-center justify-center gap-1.5 rounded-[20px] py-2.5 text-[14px] font-bold disabled:opacity-40">
              <IconScan size={16} /> Quét vùng này
            </button>
            <button type="button" onClick={() => void run('full')} className="ml-press ml-glass-card ml-ripple flex flex-1 items-center justify-center gap-1.5 rounded-[20px] py-2.5 text-[14px] font-semibold text-text">
              Quét toàn màn hình
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Bottom sheet for the result: rises from the bottom edge of the screen (behind the glass button
 * bars) and slides back down when closed. Drag its handle up / down – it snaps to three heights
 * (peek · half · tall) following the swipe direction; tapping the handle toggles half ↔ peek.
 * Performance: the sheet always has its tall height and is moved with transform (GPU only) – a
 * drag never re-renders React or re-lays-out the content; the scroll area is resized once, when
 * the sheet settles. `focus` ("id:n") scrolls to a bubble's card (raising the sheet if needed).
 */
const BARS = 'calc(164px + env(safe-area-inset-bottom))'; // height of the button bar + tab bar area

/** Two pulses of a glowing border around a card (restarts if called again). */
function glow(el: HTMLElement) {
  el.classList.remove('ml-glow');
  void el.offsetWidth; // restart the animation
  el.classList.add('ml-glow');
  el.addEventListener('animationend', () => el.classList.remove('ml-glow'), { once: true });
}

function ResultSheet({ open, riseKey, title, children, focus }: { open: boolean; riseKey: number; title: string; children: ReactNode; focus?: string | null }) {
  const snaps = () => {
    const H = window.innerHeight;
    return [56, Math.round(H * 0.42), Math.round(H * 0.7)];
  };
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(() => snaps()[1]); // settled visible height (above the bars)
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ y: number; h: number; lastY: number; lastT: number; v: number; moved: boolean; cur: number } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
    } else if (mounted) {
      setLeaving(true);
      const id = setTimeout(() => {
        setMounted(false);
        setLeaving(false);
      }, 320);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setH(snaps()[1]), [riseKey]);
  // Jump to a bubble's card: raise the sheet if it is at its peek height (wait for that), scroll
  // smoothly to the card, and only once the scroll has come to rest the card's border glows twice.
  useEffect(() => {
    if (!focus || !body.current) return;
    const id = focus.slice(0, focus.lastIndexOf(':'));
    const s = snaps();
    const raise = h < s[1] - 10;
    if (raise) setH(s[1]);
    let cancelled = false;
    let raf = 0;
    const t = setTimeout(
      () => {
        const b = body.current;
        const card = b?.querySelector<HTMLElement>(`[data-ml-block="${id}"]`);
        if (!b || !card) return;
        b.scrollTo({ top: Math.max(0, card.offsetTop - 8), behavior: 'smooth' });
        let last = -1;
        let still = 0;
        const started = performance.now();
        const settle = () => {
          if (cancelled) return;
          const cur = b.scrollTop;
          still = Math.abs(cur - last) < 0.5 ? still + 1 : 0;
          last = cur;
          // 5 frames without movement (or 1.5 s at most) = arrived
          if (still >= 5 || performance.now() - started > 1500) glow(card);
          else raf = requestAnimationFrame(settle);
        };
        raf = requestAnimationFrame(settle);
      },
      raise ? 440 : 40,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  if (!mounted) return null;
  const max = snaps()[2];
  /** Moves the sheet so that `v` px are visible (transform only). */
  const show = (v: number, animated: boolean) => {
    const el = sheet.current;
    if (!el) return;
    el.style.transition = animated ? 'transform 420ms cubic-bezier(.22,1.1,.36,1)' : 'none';
    el.style.transform = `translate3d(0, ${Math.round(max - v)}px, 0)`;
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h, lastY: e.clientY, lastT: performance.now(), v: 0, moved: false, cur: h };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [lo, , hi] = snaps();
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 4) d.moved = true;
    let next = d.h - dy;
    if (next > hi) next = hi + (next - hi) * 0.25;
    if (next < lo) next = lo - (lo - next) * 0.25;
    const t = performance.now();
    if (t > d.lastT) d.v = 0.7 * ((e.clientY - d.lastY) / (t - d.lastT)) + 0.3 * d.v; // px/ms, + = down
    d.lastY = e.clientY;
    d.lastT = t;
    d.cur = next;
    show(next, false);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = snaps();
    let target: number;
    if (!d.moved) target = h > s[0] + 10 ? s[0] : s[1];
    else if (d.v > 0.4) target = [...s].reverse().find((x) => x < d.cur - 8) ?? s[0];
    else if (d.v < -0.4) target = s.find((x) => x > d.cur + 8) ?? s[2];
    else target = s.reduce((a, b) => (Math.abs(b - d.cur) < Math.abs(a - d.cur) ? b : a));
    show(target, true);
    setH(target);
  };

  return (
    <div key={riseKey} className={cx('pointer-events-none fixed inset-x-0 bottom-0 z-[15]', leaving ? 'ml-sheet-out' : 'ml-sheet-in')} data-ml-scan-sheet="" style={{ height: `calc(${max}px + ${BARS})` }}>
      <div
        ref={sheet}
        // the wrapper is as tall as the fully raised sheet: only the sheet itself takes touches
        className="ml-glass pointer-events-auto flex h-full flex-col rounded-t-[28px] border-b-0 will-change-transform"
        style={{ transform: `translate3d(0, ${max - h}px, 0)`, transition: 'transform 420ms cubic-bezier(.22,1.1,.36,1)', paddingBottom: BARS }}
      >
        <div className="shrink-0 cursor-grab touch-none select-none px-4 pb-1 pt-2" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-ml-sheet-handle="">
          <div className="mx-auto mb-1.5 h-1.5 w-11 rounded-full bg-text/25" />
          <div className="flex items-center justify-between text-[12px] font-bold uppercase tracking-wider text-muted">
            <span className="truncate">{title}</span>
            <span className="shrink-0 pl-2 text-[11px] font-semibold normal-case tracking-normal text-subtle">kéo lên / xuống</span>
          </div>
        </div>
        <div ref={body} className="ml-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ marginBottom: max - h }}>
          <div className="pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** "Sao chép" button with a short "Đã chép ✓" confirmation. */
function CopyButton({ text, label = 'Sao chép' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => {
          setDone(ok);
          if (ok) setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cx('ml-press inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold', done ? 'bg-ok/15 text-ok' : 'bg-text/[0.07] text-muted')}
      aria-label={label}
      data-ml-copy=""
    >
      {done ? '✓ Đã chép' : <><IconCopy size={13} /> {label}</>}
    </button>
  );
}

/** Speed chip next to the speaker: 0.6× · 0.8× · 1× · 1.2× (saved in Settings → Tốc độ giọng đọc). */
const SPEEDS = [0.6, 0.8, 1, 1.2];
function SpeedChip() {
  const { settings, update } = useSettings('page');
  const cur = settings.reading.speechRate;
  const i = SPEEDS.reduce((best, v, k) => (Math.abs(v - cur) < Math.abs(SPEEDS[best] - cur) ? k : best), 0);
  return (
    <button
      type="button"
      onClick={() => update({ reading: { speechRate: SPEEDS[(i + 1) % SPEEDS.length] } })}
      className="ml-press rounded-full bg-text/[0.08] px-2 py-0.5 text-[11.5px] font-bold normal-case tracking-normal text-muted"
      aria-label={`Tốc độ đọc ${SPEEDS[i]}× – chạm để đổi`}
      data-ml-speed=""
    >
      {String(SPEEDS[i]).replace('.', ',')}×
    </button>
  );
}

/**
 * Result card of one bubble: original text and its natural translation (copy buttons). The word by
 * word details (IPA, meanings, save) are in "Phân tích câu" → Từ vựng, to keep this card light.
 */
function ScanResult({ text, n, mt }: { text: string; n: number; mt?: Mt }) {
  const [gloss, setGloss] = useState<string | null | undefined>(undefined);
  const m = mt ?? { state: 'loading' };

  // dictionary gloss: only shown when the phone cannot translate
  const needGloss = m.state === 'off' || m.state === 'error';
  useEffect(() => {
    if (!needGloss) return;
    let alive = true;
    if (text.trim().split(/\s+/).length > 1) {
      void send({ type: 'lookup', req: { text, assumeEnglish: true } })
        .then((r: LookupResult) => {
          if (!alive) return;
          if (r.kind === 'sentence') setGloss(r.gloss);
          else if (r.kind === 'paragraph') setGloss(r.sentences.map((x) => x.gloss).join(' '));
          else if (r.kind === 'phrase') setGloss(r.senses.find((x) => x.vi?.length)?.vi?.join('; ') ?? r.gloss);
          else setGloss(null);
        })
        .catch(() => alive && setGloss(null));
    } else
      void wordLookup(text, text)
        .then((r) => alive && setGloss(r?.found ? primaryMeaning(r) : null))
        .catch(() => alive && setGloss(null));
    return () => {
      alive = false;
    };
  }, [text, needGloss]);

  return (
    <div className="mx-3 mt-3 space-y-3" data-ml-scan-result="">
      <div className="ml-glass-card rounded-[20px] border-l-[4px] border-l-subtle p-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          {n > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[11px] text-white">{n}</span>}
          Nguyên văn
          {canSpeak() && (
            <span className="ml-auto flex items-center gap-1">
              <SpeedChip />
              <button type="button" className="p-1 text-muted" onClick={() => speak(text)} aria-label="Đọc cả câu" data-ml-speak="">
                <IconVolume size={18} />
              </button>
            </span>
          )}
        </div>
        <div className="ml-tr leading-relaxed">
          {text.split(/(\s+)/).map((w, i) =>
            /\s+/.test(w) ? (
              w
            ) : (
              <button key={i} type="button" className="rounded px-0.5 active:bg-accent/20" onClick={() => openLookup(w.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '') || w)}>
                {w}
              </button>
            ),
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" className="rounded-lg bg-accent/15 px-2.5 py-1 text-[12.5px] font-semibold text-accent" onClick={() => openLookup(text, 'vocabulary')} data-ml-analyse="">
            Phân tích câu · từng từ
          </button>
          <CopyButton text={text} label="Chép nguyên văn" />
        </div>
      </div>

      {m.state !== 'off' && (
        <div className="rounded-[20px] border border-accent/30 border-l-[4px] border-l-accent bg-accent/[0.1] p-3" data-ml-scan-mt="">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-accent">Bản dịch</div>
          {m.state === 'loading' ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> Đang dịch…
            </div>
          ) : m.state === 'done' ? (
            <>
              <div className="ml-tr text-[16px] font-semibold leading-snug" data-ml-mt-text="">{m.text}</div>
              <div className="mt-2 flex gap-1.5">
                <CopyButton text={m.text ?? ''} label="Chép bản dịch" />
                <CopyButton text={`${text}\n${m.text ?? ''}`} label="Chép cả hai" />
              </div>
            </>
          ) : (
            <div className="text-[13px] text-muted">Chưa dịch được ({m.error}). Kiểm tra Cài đặt → Ứng dụng → Dịch thuật → đã tải tiếng Việt.</div>
          )}
        </div>
      )}

      {gloss && needGloss && (
        <div className="ml-glass-card rounded-[20px] border-l-[4px] border-l-subtle p-3">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Nghĩa (từ điển)</div>
          <div className="ml-tr font-semibold">{gloss}</div>
        </div>
      )}
    </div>
  );
}
