/**
 * Floating button on the scan page, like the iPhone's AssistiveTouch: drag it anywhere, release
 * and it snaps to the nearest side; when unused it fades and tucks half behind the edge. Tap it
 * to open its glass menu (notes, highlight…).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/ui/components';

export interface AssistItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}

const SIZE = 54;
const POS_KEY = 'mlapp:assistPos';
const IDLE_MS = 2500;

export function Assist({ items }: { items: AssistItem[] }) {
  const [pos, setPos] = useState<{ side: 'left' | 'right'; y: number }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { side: 'left' | 'right'; y: number };
      if ((p.side === 'left' || p.side === 'right') && Number.isFinite(p.y)) return p;
    } catch {
      /* first time */
    }
    return { side: 'right', y: 0.42 };
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const start = useRef<{ px: number; py: number; moved: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // fade + tuck in after a while without use (not while the menu is open)
  const wake = () => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (open) {
      clearTimeout(timer.current);
      setIdle(false);
    } else wake();
  }, [open]);

  const W = typeof window === 'undefined' ? 390 : window.innerWidth;
  const H = typeof window === 'undefined' ? 844 : window.innerHeight;
  const top = Math.min(H - SIZE - 190, Math.max(70, pos.y * H));
  const restX = pos.side === 'right' ? W - SIZE - 6 : 6;
  const tuck = idle && !open ? (pos.side === 'right' ? SIZE * 0.42 : -SIZE * 0.42) : 0;

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, moved: false };
    wake();
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.px, e.clientY - s.py) < 8) return;
    s.moved = true;
    setOpen(false);
    setDrag({ x: e.clientX - SIZE / 2, y: e.clientY - SIZE / 2 });
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      setOpen((o) => !o);
      return;
    }
    // snap to the nearest side
    const next = { side: e.clientX < W / 2 ? ('left' as const) : ('right' as const), y: Math.min(0.8, Math.max(0.08, (e.clientY - SIZE / 2) / H)) };
    setPos(next);
    setDrag(null);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    wake();
  };

  const x = drag ? drag.x : restX;
  const y = drag ? drag.y : top;
  return (
    <>
      {open && <div className="fixed inset-0 z-[29]" onClick={() => setOpen(false)} />}
      <button
        type="button"
        aria-label="Công cụ"
        aria-expanded={open}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={cx(
          'ml-glass fixed left-0 top-0 z-[31] flex touch-none select-none items-center justify-center rounded-full',
          !drag && 'transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,1.1,.36,1)]',
          idle && !open ? 'opacity-45' : 'opacity-100',
        )}
        style={{ width: SIZE, height: SIZE, transform: `translate(${x + tuck}px, ${y}px)` }}
        data-ml-assist=""
      >
        {/* the classic AssistiveTouch rings */}
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-text/15 ring-1 ring-white/30">
          <span className="h-6 w-6 rounded-full bg-text/25 ring-1 ring-white/40" />
        </span>
      </button>
      {open && (
        <div
          className="ml-glass animate-ml-in fixed z-[30] flex flex-col gap-1 rounded-[24px] p-1.5"
          style={{ top: Math.min(H - 240, y - 8), ...(pos.side === 'right' ? { right: SIZE + 14 } : { left: SIZE + 14 }) }}
          data-ml-assist-menu=""
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx('ml-press flex min-w-[168px] items-center gap-2.5 rounded-[18px] px-3 py-2.5 text-left text-[14.5px] font-semibold', it.active ? 'ml-glass-select border' : 'hover:bg-text/[0.06]')}
              data-ml-assist-item={it.id}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-text/[0.08] text-[17px]">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
