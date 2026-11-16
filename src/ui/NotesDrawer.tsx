/**
 * Notes drawer: slides in from the right edge (right → left) over the scan page. Lists the reader's
 * notes (search, copy, save to the notebook, delete, copy all) and lets them write new ones as
 * phrase / meaning pairs – two differently tinted fields per numbered, colour-striped pair.
 */
import { useEffect, useState } from 'react';
import { cx } from '@/ui/components';
import { vocabStore } from '@/ui/VocabManager';
import { copyText } from '@/mobile/ios';
import { notesStore, useNotes } from './notes';

const STRIPES = ['border-l-accent', 'border-l-warn', 'border-l-ok', 'border-l-[rgb(var(--ml-box))]'];

export function NotesDrawer({ open, onClose, context }: { open: boolean; onClose: () => void; context?: string }) {
  const notes = useNotes();
  const [mounted, setMounted] = useState(open);
  const [q, setQ] = useState('');
  const [pairs, setPairs] = useState([{ phrase: '', meaning: '' }]);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!mounted) return null;

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1600);
  };
  const set = (i: number, k: 'phrase' | 'meaning', v: string) => setPairs((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const saveNew = async () => {
    const good = pairs.filter((p) => p.phrase.trim());
    for (const p of [...good].reverse()) await notesStore.add({ phrase: p.phrase, meaning: p.meaning, context });
    setPairs([{ phrase: '', meaning: '' }]);
    say(`Đã lưu ${good.length} ghi chú ✓`);
  };
  const shown = q.trim() ? notes.filter((n) => `${n.phrase} ${n.meaning}`.toLowerCase().includes(q.trim().toLowerCase())) : notes;

  return (
    <div className="fixed inset-0 z-[45]" data-ml-notes-drawer="">
      <div className={cx('absolute inset-0 bg-black/35 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <aside
        className={cx(
          'ml-glass absolute bottom-0 right-0 top-0 flex w-[88vw] max-w-[400px] flex-col rounded-l-[28px] pt-[calc(env(safe-area-inset-top)+12px)] transition-transform duration-[340ms] ease-[cubic-bezier(.22,1,.36,1)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ animation: open ? 'ml-drawer-in 340ms cubic-bezier(.22,1,.36,1)' : undefined }}
      >
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold">✏️ Ghi chú</div>
            <div className="text-[12px] text-subtle">{notes.length} ghi chú</div>
          </div>
          <button type="button" onClick={onClose} className="ml-press rounded-full bg-text/[0.08] px-3 py-1.5 text-[13px] font-semibold text-muted">
            Đóng
          </button>
        </div>

        <div className="ml-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {/* new note(s) */}
          <div className="space-y-2" data-ml-notes-new="">
            {pairs.map((p, i) => (
              <div key={i} className={cx('ml-glass-card rounded-2xl border-l-[4px] p-2', STRIPES[i % STRIPES.length])}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted">Ghi chú mới {pairs.length > 1 ? i + 1 : ''}</span>
                  {pairs.length > 1 && (
                    <button type="button" onClick={() => setPairs((x) => x.filter((_, j) => j !== i))} className="px-1 text-[13px] text-muted" aria-label="Xoá cụm">
                      ✕
                    </button>
                  )}
                </div>
                <input
                  value={p.phrase}
                  onChange={(e) => set(i, 'phrase', e.target.value)}
                  placeholder="Câu / cụm từ tiếng Anh"
                  className="ml-focus mb-1.5 block w-full rounded-xl border border-accent/35 bg-accent/10 px-2.5 py-2 text-[15px] font-semibold text-text placeholder:font-normal placeholder:text-subtle"
                  data-ml-note-phrase=""
                />
                <textarea
                  value={p.meaning}
                  onChange={(e) => set(i, 'meaning', e.target.value)}
                  rows={2}
                  placeholder="Nghĩa / ghi chú của bạn"
                  className="ml-focus block w-full resize-none rounded-xl border border-ok/35 bg-ok/10 px-2.5 py-2 text-[15px] text-text placeholder:text-subtle"
                  data-ml-note-meaning=""
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPairs((x) => [...x, { phrase: '', meaning: '' }])} className="ml-press ml-glass-card flex-1 rounded-full py-2 text-[13px] font-semibold">
                + Thêm cụm
              </button>
              <button type="button" disabled={!pairs.some((p) => p.phrase.trim())} onClick={() => void saveNew()} className="ml-press ml-btn-primary flex-1 rounded-full py-2 text-[13px] font-semibold disabled:opacity-40" data-ml-notes-save="">
                Lưu ghi chú
              </button>
            </div>
            {context && <div className="line-clamp-2 text-[11.5px] text-subtle">Kèm câu: {context}</div>}
          </div>

          {/* saved notes */}
          <div className="flex items-center gap-2 pt-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong ghi chú…" className="ml-focus ml-glass-field h-9 min-w-0 flex-1 rounded-full px-3 text-[13.5px] text-text placeholder:text-subtle" />
            <button
              type="button"
              disabled={!shown.length}
              onClick={() => void copyText(shown.map((n) => `${n.phrase} — ${n.meaning}`).join('\n')).then((ok) => ok && say('Đã chép tất cả ✓'))}
              className="ml-press shrink-0 rounded-full bg-text/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-muted disabled:opacity-40"
            >
              Chép tất cả
            </button>
          </div>
          {!shown.length && <div className="py-6 text-center text-[13px] text-subtle">{notes.length ? 'Không có ghi chú phù hợp.' : 'Chưa có ghi chú nào.'}</div>}
          <ul className="space-y-2" data-ml-notes-list="">
            {shown.map((n, i) => (
              <li key={n.id} className={cx('ml-glass-card rounded-2xl border-l-[4px] p-2.5', STRIPES[i % STRIPES.length])}>
                <div className="rounded-xl bg-accent/10 px-2.5 py-1.5 text-[14.5px] font-semibold">{n.phrase}</div>
                {n.meaning && <div className="mt-1 rounded-xl bg-ok/10 px-2.5 py-1.5 text-[14px]">{n.meaning}</div>}
                {n.context && <div className="mt-1 line-clamp-1 text-[11.5px] text-subtle">“{n.context}”</div>}
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" onClick={() => void copyText(`${n.phrase} — ${n.meaning}`).then((ok) => ok && say('Đã chép ✓'))} className="ml-press rounded-full bg-text/[0.07] px-2.5 py-1 text-[12px] font-semibold text-muted">
                    Chép
                  </button>
                  <button
                    type="button"
                    onClick={() => void vocabStore.add({ word: n.phrase, lemma: n.phrase.toLowerCase(), meaning: n.meaning, sentence: n.context, notes: 'Từ ghi chú' }).then((r) => say(r.created ? 'Đã lưu vào Sổ từ ✓' : 'Đã có trong Sổ từ'))}
                    className="ml-press rounded-full bg-text/[0.07] px-2.5 py-1 text-[12px] font-semibold text-muted"
                  >
                    Lưu vào Sổ từ
                  </button>
                  <button type="button" onClick={() => void notesStore.remove(n.id)} className="ml-press ml-auto rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger" aria-label={`Xoá ghi chú ${n.phrase}`}>
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {flash && <div className="ml-glass animate-ml-in absolute bottom-[calc(env(safe-area-inset-bottom)+20px)] left-4 right-4 rounded-full px-4 py-2 text-center text-[13px] font-semibold">{flash}</div>}
      </aside>
    </div>
  );
}
