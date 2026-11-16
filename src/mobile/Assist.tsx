/**
 * Tools drawer of the scan page: a glass panel docked to a screen edge. When not in use only its
 * arrow tab shows at the edge; tap the arrow and the panel slides out with the tools (notes,
 * highlight…); tap it again or outside and it slides back in. Drag the arrow up / down to move it,
 * or across the middle of the screen to dock it on the other side.
 */
import { useRef, useState, type ReactNode } from 'react';
import { cx } from '@/ui/components';

export interface AssistItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}

const TAB_W = 26; // visible arrow tab
const TAB_H = 64;
const PANEL_W = 196;
const POS_KEY = 'mlapp:assistPos';

export function Assist({ items }: { items: AssistItem[] }) {
  const [pos, setPos] = useState<{ side: 'left' | 'right'; y: number }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { side: 'left' | 'right'; y: number };
      if ((p.side === 'left' || p.side === 'right') && Number.isFinite(p.y)) return p;
    } catch {
      /* first time */
    }
    return { side: 'right', y: 0.36 };
  });
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const start = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  const H = typeof window === 'undefined' ? 844 : window.innerHeight;
  const W = typeof window === 'undefined' ? 390 : window.innerWidth;
  const panelH = Math.max(TAB_H, items.length * 52 + 16);
  const centerY = dragY ?? Math.min(H - 200 - panelH / 2, Math.max(80 + panelH / 2, pos.y * H));
  const right = pos.side === 'right';

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.px, e.clientY - s.py) < 8) return;
    s.moved = true;
    setDragY(e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      setOpen((o) => !o);
      return;
    }
    const next = { side: e.clientX < W / 2 ? ('left' as const) : ('right' as const), y: Math.min(0.8, Math.max(0.12, e.clientY / H)) };
    setPos(next);
    setDragY(null);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  // closed: the panel is pushed behind the edge, only the arrow tab stays visible
  const hidden = open ? 0 : PANEL_W;
  return (
    <>
      {open && <div className="fixed inset-0 z-[29]" onClick={() => setOpen(false)} data-ml-assist-backdrop="" />}
      <div
        className={cx('fixed z-[31] flex items-center', right ? 'right-0 flex-row' : 'left-0 flex-row-reverse', dragY === null && 'transition-[transform,top] duration-[360ms] ease-[cubic-bezier(.22,1.15,.36,1)]')}
        style={{ top: centerY - panelH / 2, height: panelH, transform: `translateX(${right ? hidden : -hidden}px)` }}
        data-ml-assist-drawer=""
        data-open={open ? '' : undefined}
      >
        {/* the arrow tab (always visible at the edge) */}
        <button
          type="button"
          aria-label={open ? 'Đóng công cụ' : 'Mở công cụ'}
          aria-expanded={open}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={cx('ml-glass flex touch-none select-none items-center justify-center text-[22px] font-bold text-muted', right ? 'rounded-l-[16px] border-r-0' : 'rounded-r-[16px] border-l-0')}
          style={{ width: TAB_W, height: TAB_H }}
          data-ml-assist=""
        >
          <span className={cx('transition-transform duration-300', open === right && 'rotate-180')}>‹</span>
        </button>
        {/* the panel with the tools */}
        <div className={cx('ml-glass flex h-full flex-col justify-center gap-1 p-2', right ? 'rounded-l-[24px] border-r-0' : 'rounded-r-[24px] border-l-0')} style={{ width: PANEL_W }} data-ml-assist-menu="">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx('ml-press flex h-[46px] items-center gap-2.5 rounded-[16px] px-2.5 text-left text-[14px] font-semibold', it.active ? 'ml-glass-select border' : 'border border-transparent hover:bg-text/[0.06]')}
              data-ml-assist-item={it.id}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text/[0.08] text-[17px]">{it.icon}</span>
              <span className="truncate">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
