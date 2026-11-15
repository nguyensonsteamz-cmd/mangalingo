/**
 * Reader for an uploaded text document (.txt, subtitles…). Tap a paragraph to translate / analyse
 * it in Tra cứu. Highlight mode: select text and it is highlighted (kept while the document is
 * open); tap a highlight to look it up or remove it.
 */
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/ui/components';
import { IconBack } from '@/ui/icons';
import { openLookup } from './Scan';

export type TextRange = [number, number];

export function TextReader({
  name,
  text,
  highlightMode,
  highlights,
  onHighlights,
  onBack,
}: {
  name: string;
  text: string;
  highlightMode: boolean;
  highlights: TextRange[];
  onHighlights: (r: TextRange[]) => void;
  onBack: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  // paragraphs with their start offset in the text
  const paras: { start: number; text: string }[] = [];
  {
    let i = 0;
    for (const part of text.split(/(\n\s*\n)/)) {
      if (!/^\n\s*\n$/.test(part) && part.trim()) paras.push({ start: i, text: part });
      i += part.length;
    }
  }

  /** Character offset in the whole text of a DOM position inside the reader. */
  const offsetOf = (node: Node, off: number): number | null => {
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>('[data-start]');
    if (!el) return null;
    let n = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t === node) return Number(el.dataset.start) + n + off;
      n += t.textContent?.length ?? 0;
    }
    return Number(el.dataset.start) + Math.min(off, n);
  };

  // highlight mode: a finished selection becomes a highlight
  useEffect(() => {
    if (!highlightMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !box.current) return;
      const r = sel.getRangeAt(0);
      if (!box.current.contains(r.commonAncestorContainer)) return;
      const a = offsetOf(r.startContainer, r.startOffset);
      const b = offsetOf(r.endContainer, r.endOffset);
      if (a === null || b === null || b - a < 1) return;
      // merge with overlapping highlights
      let range: TextRange = [Math.min(a, b), Math.max(a, b)];
      const rest = highlights.filter(([s, e]) => {
        if (e < range[0] || s > range[1]) return true;
        range = [Math.min(s, range[0]), Math.max(e, range[1])];
        return false;
      });
      onHighlights([...rest, range].sort((x, y) => x[0] - y[0]));
      sel.removeAllRanges();
    };
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 650); // wait until the selection handles are released
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onChange);
    };
  }, [highlightMode, highlights, onHighlights]);

  /** A paragraph split into plain / highlighted pieces. */
  const pieces = (p: { start: number; text: string }) => {
    const out: { s: number; e: number; hl: number }[] = [];
    let cur = p.start;
    const end = p.start + p.text.length;
    highlights.forEach(([s, e], i) => {
      const a = Math.max(s, p.start);
      const b = Math.min(e, end);
      if (b <= a) return;
      if (a > cur) out.push({ s: cur, e: a, hl: -1 });
      out.push({ s: a, e: b, hl: i });
      cur = b;
    });
    if (cur < end) out.push({ s: cur, e: end, hl: -1 });
    return out;
  };

  return (
    <div className="mx-auto max-w-2xl pb-6" data-ml-text-reader="">
      {/* minimal top bar: back button + file name */}
      <div className="ml-glass-bar sticky top-0 z-10 flex h-11 items-center gap-1 border-b px-2">
        <button type="button" onClick={onBack} className="ml-press flex h-9 w-9 items-center justify-center rounded-full text-muted" aria-label="Quay lại">
          <IconBack size={22} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[15.5px] font-bold">📄 {name}</div>
      </div>
      <div className="px-4 pt-3">
      {highlightMode && <div className="ml-glass-select mb-3 rounded-2xl border px-3 py-2 text-[13px] font-semibold">Đang tô sáng: bôi đen một đoạn chữ để tô · chạm đoạn đã tô để tra hoặc bỏ tô</div>}
      <div ref={box} className={cx('ml-glass-card space-y-3 rounded-[24px] p-4 text-[17px] leading-relaxed', highlightMode ? 'select-text' : '')}>
        {paras.map((p) => (
          <p
            key={p.start}
            data-start={p.start}
            className="whitespace-pre-wrap"
            onClick={(e) => {
              if (highlightMode || (e.target as Element).closest('mark')) return;
              if (document.getSelection()?.isCollapsed !== false) openLookup(p.text.trim());
            }}
          >
            {pieces(p).map((x) =>
              x.hl < 0 ? (
                text.slice(x.s, x.e)
              ) : (
                <mark
                  key={x.s}
                  className="rounded bg-[#ffe066]/70 px-0.5 text-inherit"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({ i: x.hl, x: e.clientX, y: e.clientY });
                  }}
                  data-ml-hl=""
                >
                  {text.slice(x.s, x.e)}
                </mark>
              ),
            )}
          </p>
        ))}
      </div>
      {!highlightMode && <div className="mt-2 text-center text-[11.5px] text-subtle">Chạm vào một đoạn để dịch và phân tích.</div>}
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
          <div className="ml-glass animate-ml-in fixed z-[31] flex gap-1 rounded-full p-1" style={{ left: Math.max(8, Math.min(window.innerWidth - 220, menu.x - 100)), top: Math.max(60, menu.y - 60) }}>
            <button type="button" className="ml-press rounded-full px-3 py-1.5 text-[13px] font-semibold" onClick={() => { const [s, e] = highlights[menu.i]; setMenu(null); openLookup(text.slice(s, e).trim()); }}>
              Tra / dịch
            </button>
            <button type="button" className="ml-press rounded-full px-3 py-1.5 text-[13px] font-semibold text-danger" onClick={() => { onHighlights(highlights.filter((_, j) => j !== menu.i)); setMenu(null); }}>
              Bỏ tô
            </button>
          </div>
        </>
      )}
    </div>
  );
}
