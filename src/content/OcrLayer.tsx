/** In-page OCR UI: hover "scan" button, progress/cancel chip, recognised text boxes, region picker. */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, Spinner, cx } from '@/ui/components';
import { IconCrop, IconScan, IconX } from '@/ui/icons';
import { resizeRect, type Handle, type Rect } from '@/popup/position';
import { store, useStore, type OcrTarget } from './store';
import * as A from './actions';

const STATUS_VI: Record<string, string> = {
  'loading tesseract core': 'đang nạp lõi OCR',
  'initializing tesseract': 'đang khởi tạo Tesseract',
  'initialized tesseract': 'đã khởi tạo Tesseract',
  'loading language traineddata': 'đang nạp dữ liệu ngôn ngữ',
  'loaded language traineddata': 'đã nạp dữ liệu ngôn ngữ',
  'initializing api': 'đang khởi tạo API',
  'initialized api': 'đã khởi tạo API',
  'recognizing text': 'đang nhận diện chữ',
};

/** Re-render on scroll/resize so boxes follow their image. */
function useViewportTick(active: boolean) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(force);
    };
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    const iv = setInterval(on, 800); // lazy-loaded layouts can move images without scrolling
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
      clearInterval(iv);
      cancelAnimationFrame(raf);
    };
  }, [active]);
}

const targetRect = A.targetRect;

export function OcrLayer() {
  const targets = useStore((s) => s.targets);
  const hover = useStore((s) => s.hoverImage);
  const settings = useStore((s) => s.settings);
  const region = useStore((s) => s.regionSelect);
  useViewportTick(targets.length > 0 || !!hover);

  return (
    <>
      {settings.ocr.enabled && settings.ocr.trigger === 'hover' && hover && !targets.some((t) => t.el === hover.el && t.status === 'running') && <HoverButton el={hover.el} />}
      {targets.map((t) => (
        <TargetOverlay key={t.id} t={t} showBoxes={settings.ocr.showBoxes} />
      ))}
      {region && <RegionSelector />}
    </>
  );
}

function HoverButton({ el }: { el: Element }) {
  // Hovering a manga image: start the OCR engine now so the scan itself is quick.
  useEffect(() => A.warmOcr(), [el]);
  const r = el.getBoundingClientRect();
  const top = Math.max(8, r.top + 8);
  const left = Math.min(window.innerWidth - 120, r.left + r.width - 112);
  if (r.bottom < 40 || r.top > window.innerHeight - 40) return null;
  const done = store.get().targets.find((t) => t.el === el && t.status === 'done');
  return (
    <div className="pointer-events-auto fixed flex gap-1" style={{ top, left }} data-ml-hover="">
      <button
        type="button"
        onClick={(e) => e.nativeEvent.isTrusted && A.scanImageToSidebar(el)}
        className="ml-focus inline-flex items-center gap-1 rounded-lg border border-border bg-surface/95 px-2 py-1 text-[12px] font-medium text-text shadow-pop backdrop-blur hover:border-accent"
        title="Quét chữ trong ảnh này (OCR cục bộ)"
      >
        <IconScan size={14} /> {done ? 'Quét lại' : 'Quét OCR'}
      </button>
      <button
        type="button"
        onClick={(e) => e.nativeEvent.isTrusted && store.set({ regionSelect: true, hoverImage: null })}
        className="ml-focus inline-flex items-center rounded-lg border border-border bg-surface/95 px-1.5 py-1 text-text shadow-pop hover:border-accent"
        title="Chọn vùng để quét"
      >
        <IconCrop size={14} />
      </button>
    </div>
  );
}

function TargetOverlay({ t, showBoxes }: { t: OcrTarget; showBoxes: boolean }) {
  const rect = targetRect(t);
  if (!rect || t.hidden) return null;
  const visible = rect.top < window.innerHeight && rect.top + rect.height > 0;
  if (!visible) return null;
  const progress = t.status === 'running' ? t.progress : 1;
  const numbered = t.kind === 'image' && (t.result?.blocks.length ?? 0) > 1;
  return (
    <>
      {t.status === 'running' && (
        <>
          {/* No progress card over the page: an animated outline marks what is being read. */}
          <div className="ml-scan-outline pointer-events-none fixed rounded-md" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
          <div
            className="pointer-events-auto fixed flex items-center gap-1.5 rounded-full border border-border bg-surface/95 py-0.5 pl-1.5 pr-0.5 text-[11px] text-muted shadow-pop"
            style={{ top: Math.min(Math.max(6, rect.top + 6), window.innerHeight - 30), left: Math.max(6, Math.min(rect.left + rect.width - 92, window.innerWidth - 98)) }}
            data-ml-ocr-status=""
            title={STATUS_VI[t.statusText] ?? t.statusText}
          >
            <Spinner />
            <span className="font-mono">{Math.round(progress * 100)}%</span>
            <button type="button" className="rounded-full p-0.5 hover:bg-elevated hover:text-text" onClick={() => A.cancelScan(t)} aria-label="Hủy quét (Esc)" title="Hủy quét (Esc)">
              <IconX size={12} />
            </button>
          </div>
        </>
      )}
      {t.status === 'done' && t.result && (
        <>
          {showBoxes &&
            t.result.blocks.map((b, i) => {
              const box = A.blockRect(rect, b.box);
              return <ResizableBox key={b.id} t={t} b={b} box={box} n={numbered ? i + 1 : 0} />;
            })}
          <ResultChip t={t} rect={rect} />
        </>
      )}
    </>
  );
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_POS: Record<Handle, string> = {
  nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
  n: 'left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize',
  ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
  e: '-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize',
  se: '-right-1.5 -bottom-1.5 cursor-nwse-resize',
  s: 'left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize',
  sw: '-left-1.5 -bottom-1.5 cursor-nesw-resize',
  w: '-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize',
};

/**
 * An OCR bubble box. Click → meaning popup. Drag a handle (shown on hover) to cover words the scan
 * missed → only that rectangle is read again and replaces the bubble.
 */
function ResizableBox({ t, b, box, n }: { t: OcrTarget; b: NonNullable<OcrTarget['result']>['blocks'][number]; box: Rect; n: number }) {
  const [drag, setDrag] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number; h: Handle; r: Rect } | null>(null);
  const moved = useRef(false);
  const edited = t.edits[b.id] !== undefined;
  const busy = t.rescanning === b.id;
  const shown = drag ?? box;
  const onDown = (h: Handle) => (e: React.PointerEvent) => {
    if (!e.nativeEvent.isTrusted || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, h, r: box };
    moved.current = false;
    setDrag(box);
  };
  const onMove = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0) return;
    const dx = e.clientX - s0.x;
    const dy = e.clientY - s0.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    setDrag(resizeRect(s0.r, s0.h, dx, dy));
  };
  const onUp = (e: React.PointerEvent) => {
    const s0 = start.current;
    start.current = null;
    const final = drag;
    setDrag(null);
    if (!s0 || !final || !moved.current || !e.nativeEvent.isTrusted) return;
    void A.rescanBlock(t.id, b.id, final);
  };
  return (
    <div className="group pointer-events-auto fixed" style={shown} data-ml-ocr-box-wrap="">
      <button
        type="button"
        data-ml-ocr-box=""
        title={`${t.edits[b.id] ?? b.text}\n(tin cậy ${b.confidence}%) – click để tra · kéo viền để quét lại vùng rộng hơn`}
        onClick={() => !moved.current && A.openOcrBlock(t.id, b.id, box)}
        className={cx(
          'ml-focus absolute inset-0 rounded-md border-2 transition-colors',
          busy || drag
            ? 'ml-scan-outline border-transparent'
            : edited
              ? 'border-ok/80 bg-ok/10 hover:bg-ok/20'
              : cx('border-[rgb(var(--ml-box)/0.9)] bg-[rgb(var(--ml-box)/0.1)] hover:bg-[rgb(var(--ml-box)/0.28)]', b.confidence < 65 && 'border-dashed'),
        )}
      />
      {n > 0 && (
        <span className="pointer-events-none absolute -left-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[10px] font-bold leading-none text-white shadow" data-ml-ocr-num="">
          {n}
        </span>
      )}
      {!busy &&
        HANDLES.map((h) => (
          <span
            key={h}
            data-ml-ocr-handle={h}
            onPointerDown={onDown(h)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            className={cx(
              'absolute h-3 w-3 rounded-sm border-2 border-white bg-[rgb(var(--ml-box))] shadow transition-opacity',
              HANDLE_POS[h],
              drag ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          />
        ))}
      {drag && (
        <span className="pointer-events-none absolute -bottom-6 left-0 whitespace-nowrap rounded bg-surface/95 px-1.5 py-0.5 text-[10.5px] text-text shadow-pop">
          Thả để quét lại vùng này
        </span>
      )}
      {busy && (
        <span className="pointer-events-none absolute -top-6 right-0 flex items-center gap-1 rounded-full bg-surface/95 px-1.5 py-0.5 text-[10.5px] text-muted shadow-pop">
          <Spinner /> đang quét lại
        </span>
      )}
    </div>
  );
}

/** No visible bar (it covered bubbles); an invisible marker keeps the result metadata for tests/debugging. */
function ResultChip({ t }: { t: OcrTarget; rect: Rect }) {
  const r = t.result!;
  return <span hidden data-ml-ocr-chip="" data-acquisition={r.acquisition} data-cache={r.fromCache ? '1' : '0'} data-blocks={r.blocks.length} />;
}

function RegionSelector() {
  // Refs hold the live drag state so fast drags are never lost between React renders.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const curRef = useRef<{ x: number; y: number } | null>(null);
  const [, rerender] = useState(0);
  const start = startRef.current;
  const cur = curRef.current;
  const setStart = (p: { x: number; y: number } | null) => {
    startRef.current = p;
    rerender((n) => n + 1);
  };
  const setCur = (p: { x: number; y: number } | null) => {
    curRef.current = p;
    rerender((n) => n + 1);
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => A.warmOcr(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.set({ regionSelect: false });
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const rect = start && cur ? { left: Math.min(start.x, cur.x), top: Math.min(start.y, cur.y), width: Math.abs(cur.x - start.x), height: Math.abs(cur.y - start.y) } : null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-ml-region=""
      className="pointer-events-auto fixed inset-0 cursor-crosshair bg-black/30 outline-none"
      onMouseDown={(e) => {
        e.preventDefault();
        if (!e.nativeEvent.isTrusted) return; // OCR only on real user input
        setStart({ x: e.clientX, y: e.clientY });
        setCur({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={(e) => startRef.current && setCur({ x: e.clientX, y: e.clientY })}
      onMouseUp={(e) => {
        if (!e.nativeEvent.isTrusted) return;
        const s0 = startRef.current;
        const r = s0 ? { left: Math.min(s0.x, e.clientX), top: Math.min(s0.y, e.clientY), width: Math.abs(e.clientX - s0.x), height: Math.abs(e.clientY - s0.y) } : null;
        if (r && r.width > 12 && r.height > 12) A.scanRegion(r);
        else {
          setStart(null);
          setCur(null);
        }
      }}
    >
      {rect && <div className="absolute rounded-sm border-2 border-accent bg-accent/10" style={rect} />}
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        Kéo để chọn vùng cần OCR
        <Button size="sm" onClick={(e) => e.nativeEvent.isTrusted && A.scanRegion({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight })}>
          Quét toàn màn hình
        </Button>
        <Button size="sm" variant="ghost" onClick={() => store.set({ regionSelect: false })}>
          Hủy (Esc)
        </Button>
      </div>
    </div>
  );
}
