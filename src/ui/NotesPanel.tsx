/**
 * Notes: write a phrase + your own meaning. Everything is saved AUTOMATICALLY while typing (no Save button) in two places: the notes
 * list and the vocabulary notebook ("Sổ từ"), kept in step when you edit. The list is split by day ("Hôm nay", "Hôm qua", "Thứ Ba,
 * 17/11/2026"). Every card has a copy button.
 */
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/ui/components';
import { vocabStore } from '@/ui/VocabManager';
import { copyText } from '@/mobile/ios';
import { groupByDay } from './dates';
import { notesStore, useNotes, type Note } from './notes';

const STRIPES = ['border-l-accent', 'border-l-warn', 'border-l-ok', 'border-l-[rgb(var(--ml-box))]'];
const NOTE_TAG = 'Từ ghi chú';

/** Keeps the notebook entry of a note in step with the note (created, re-worded, or removed). */
export async function syncNoteToVocab(prev: { phrase: string; meaning: string } | null, next: { phrase: string; meaning: string; context?: string } | null) {
  const lemma = (p: string) => p.trim().toLowerCase();
  if (prev && (!next || lemma(prev.phrase) !== lemma(next.phrase))) {
    const old = await vocabStore.findByLemma(lemma(prev.phrase));
    if (old && old.notes === NOTE_TAG) await vocabStore.remove(old.id); // only entries this note created
  }
  if (!next || !next.phrase.trim()) return;
  const { entry, created } = await vocabStore.add({ word: next.phrase.trim(), lemma: lemma(next.phrase), meaning: next.meaning.trim(), sentence: next.context, notes: NOTE_TAG });
  if (!created && entry.notes === NOTE_TAG && entry.meaning !== next.meaning.trim()) await vocabStore.update(entry.id, { meaning: next.meaning.trim() });
}

type Draft = { id?: string; phrase: string; meaning: string };

export function NotesPanel({ context, className }: { context?: string; className?: string }) {
  const notes = useNotes();
  const [draft, setDraft] = useState<Draft>({ phrase: '', meaning: '' });
  const [status, setStatus] = useState<'' | 'saving' | 'saved'>('');
  const [flash, setFlash] = useState('');
  const [q, setQ] = useState('');
  const saved = useRef<Draft>({ phrase: '', meaning: '' }); // what is already stored for the draft
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(draft);
  latest.current = draft;

  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 1500);
  };

  const flush = async () => {
    const d = latest.current;
    if (!d.phrase.trim()) return;
    const prev = saved.current;
    if (prev.phrase === d.phrase && prev.meaning === d.meaning && d.id) return;
    setStatus('saving');
    let id = d.id;
    if (!id) {
      const n = await notesStore.add({ phrase: d.phrase, meaning: d.meaning, context });
      id = n.id;
      setDraft((x) => (x === latest.current ? { ...x, id } : { ...x, id: x.id ?? id }));
      latest.current = { ...latest.current, id };
    } else await notesStore.update(id, { phrase: d.phrase.trim().slice(0, 500), meaning: d.meaning.trim().slice(0, 2000) });
    await syncNoteToVocab(prev.phrase ? prev : null, { phrase: d.phrase, meaning: d.meaning, context });
    saved.current = { id, phrase: d.phrase, meaning: d.meaning };
    setStatus('saved');
  };

  const change = (k: 'phrase' | 'meaning', v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700); // auto-save shortly after the last keystroke
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const newNote = async () => {
    clearTimeout(timer.current);
    await flush();
    saved.current = { phrase: '', meaning: '' };
    setDraft({ phrase: '', meaning: '' });
    setStatus('');
  };

  const shown = q.trim() ? notes.filter((n) => `${n.phrase} ${n.meaning}`.toLowerCase().includes(q.trim().toLowerCase())) : notes;
  const groups = groupByDay(shown, (n) => n.createdAt);

  return (
    <div className={cx('space-y-3', className)} data-ml-notes-panel="">
      <div className="ml-glass-card rounded-2xl border-l-[4px] border-l-accent p-2.5" data-ml-notes-new="">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-accent">{draft.id ? 'Đang sửa ghi chú' : 'Ghi chú mới'}</span>
          <span className="ml-auto text-[11.5px] text-subtle" data-ml-notes-status="">
            {status === 'saving' ? 'Đang lưu…' : status === 'saved' ? 'Đã tự lưu vào ghi chú và Sổ từ ✓' : 'Tự động lưu khi bạn gõ'}
          </span>
        </div>
        <input
          value={draft.phrase}
          onChange={(e) => change('phrase', e.target.value)}
          onBlur={() => void flush()}
          placeholder="Câu / cụm từ tiếng Anh"
          className="ml-focus mb-1.5 block w-full rounded-xl border border-accent/35 bg-accent/10 px-2.5 py-2 text-[15px] font-semibold text-text placeholder:font-normal placeholder:text-subtle"
          data-ml-note-phrase=""
        />
        <textarea
          value={draft.meaning}
          onChange={(e) => change('meaning', e.target.value)}
          onBlur={() => void flush()}
          rows={2}
          placeholder="Nghĩa / ghi chú của bạn"
          className="ml-focus block w-full resize-none rounded-xl border border-ok/35 bg-ok/10 px-2.5 py-2 text-[15px] text-text placeholder:text-subtle"
          data-ml-note-meaning=""
        />
        <div className="mt-1.5 flex items-center gap-2">
          {context && <div className="line-clamp-1 min-w-0 flex-1 text-[11.5px] text-subtle">Kèm câu: {context}</div>}
          <button type="button" disabled={!draft.phrase.trim()} onClick={() => void newNote()} className="ml-press ml-btn-primary ml-auto shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40" data-ml-notes-save="">
            + Ghi chú mới
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
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
      {flash && <div className="text-center text-[12px] font-semibold text-ok">{flash}</div>}
      {!shown.length && <div className="py-6 text-center text-[13px] text-subtle">{notes.length ? 'Không có ghi chú phù hợp.' : 'Chưa có ghi chú nào.'}</div>}

      <div className="space-y-3" data-ml-notes-list="">
        {groups.map((g) => (
          <section key={g.key} data-ml-notes-day={g.key}>
            <div className="sticky top-0 z-[1] -mx-1 mb-1.5 flex items-center gap-2 bg-bg/80 px-1 py-1 backdrop-blur">
              <span className="text-[12px] font-bold uppercase tracking-wider text-muted">{g.label}</span>
              <span className="rounded-full bg-text/[0.07] px-1.5 text-[11px] font-semibold text-subtle">{g.items.length}</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>
            <ul className="space-y-2">
              {g.items.map((n, i) => (
                <NoteCard key={n.id} n={n} stripe={STRIPES[i % STRIPES.length]} onSay={say} onEdit={() => {
                  clearTimeout(timer.current);
                  saved.current = { id: n.id, phrase: n.phrase, meaning: n.meaning };
                  setDraft({ id: n.id, phrase: n.phrase, meaning: n.meaning });
                  setStatus('');
                }} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function NoteCard({ n, stripe, onSay, onEdit }: { n: Note; stripe: string; onSay: (m: string) => void; onEdit: () => void }) {
  const time = new Date(n.createdAt);
  return (
    <li className={cx('ml-glass-card rounded-2xl border-l-[4px] p-2.5', stripe)} data-ml-note-card="">
      <div className="rounded-xl bg-accent/10 px-2.5 py-1.5 text-[14.5px] font-semibold">{n.phrase}</div>
      {n.meaning && <div className="mt-1 rounded-xl bg-ok/10 px-2.5 py-1.5 text-[14px]">{n.meaning}</div>}
      {n.context && <div className="mt-1 line-clamp-1 text-[11.5px] text-subtle">“{n.context}”</div>}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button type="button" onClick={() => void copyText(`${n.phrase} — ${n.meaning}`).then((ok) => ok && onSay('Đã chép ✓'))} className="ml-press rounded-full bg-text/[0.07] px-2.5 py-1 text-[12px] font-semibold text-muted" data-ml-note-copy="">
          Chép
        </button>
        <button type="button" onClick={onEdit} className="ml-press rounded-full bg-text/[0.07] px-2.5 py-1 text-[12px] font-semibold text-muted">
          Sửa
        </button>
        <span className="text-[11px] text-subtle">{String(time.getHours()).padStart(2, '0')}:{String(time.getMinutes()).padStart(2, '0')}</span>
        <button
          type="button"
          onClick={() => void (async () => { await notesStore.remove(n.id); await syncNoteToVocab({ phrase: n.phrase, meaning: n.meaning }, null); })()}
          className="ml-press ml-auto rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger"
          aria-label={`Xoá ghi chú ${n.phrase}`}
        >
          Xoá
        </button>
      </div>
    </li>
  );
}
