/**
 * Notes: write a phrase + your own meaning and press "Lưu". Saving puts it in two places: the notes list and the vocabulary notebook
 * ("Sổ từ", with the pronunciation and part of speech filled from the dictionary for a single word). Nothing is saved while typing.
 * The list is split by day ("Hôm nay", "Hôm qua", "Thứ Ba, 17/11/2026"). Every card has a copy button.
 */
import { useRef, useState } from 'react';
import { cx } from '@/ui/components';
import { vocabStore } from '@/ui/VocabManager';
import { lookupWord } from './vocab-enrich';
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
  // a single word gets its pronunciation, part of speech (and a meaning when the user wrote none) from the dictionary
  const info = await lookupWord(next.phrase, next.context);
  const own = next.meaning.trim();
  const { entry, created } = await vocabStore.add({ word: next.phrase.trim(), lemma: lemma(next.phrase), meaning: own || info?.meaning || '', ipa: info?.ipa, pos: info?.pos, sentence: next.context, notes: NOTE_TAG });
  if (!created && entry.notes === NOTE_TAG && entry.meaning !== (own || info?.meaning || '')) await vocabStore.update(entry.id, { meaning: own || info?.meaning || '' });
}

type Draft = { id?: string; phrase: string; meaning: string };

export function NotesPanel({ context, className }: { context?: string; className?: string }) {
  const notes = useNotes();
  const [draft, setDraft] = useState<Draft>({ phrase: '', meaning: '' });
  const [status, setStatus] = useState<'' | 'saving' | 'saved'>('');
  const [flash, setFlash] = useState('');
  const [q, setQ] = useState('');
  const saved = useRef<Draft>({ phrase: '', meaning: '' }); // what is stored for the note being edited (empty for a new note)

  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 1800);
  };

  /** "Lưu": the note is stored AND added to the vocabulary notebook (with pronunciation / part of speech). Nothing happens before this. */
  const save = async () => {
    const d = draft;
    if (!d.phrase.trim() || status === 'saving') return;
    setStatus('saving');
    try {
      if (!d.id) await notesStore.add({ phrase: d.phrase, meaning: d.meaning, context });
      else await notesStore.update(d.id, { phrase: d.phrase.trim().slice(0, 500), meaning: d.meaning.trim().slice(0, 2000) });
      await syncNoteToVocab(saved.current.phrase ? saved.current : null, { phrase: d.phrase, meaning: d.meaning, context });
      saved.current = { phrase: '', meaning: '' };
      setDraft({ phrase: '', meaning: '' });
      setStatus('saved');
      say('Đã lưu vào ghi chú và Sổ từ ✓');
    } catch (e) {
      setStatus('');
      say((e as Error).message || 'Không lưu được.');
    }
  };

  const cancelEdit = () => {
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
          <span className="sr-only" data-ml-notes-status="">
            {status === 'saving' ? 'Đang lưu…' : status === 'saved' ? 'Đã lưu vào ghi chú và Sổ từ ✓' : 'Bấm Lưu để thêm vào Sổ từ'}
          </span>
        </div>
        <input
          value={draft.phrase}
          onChange={(e) => setDraft((d) => ({ ...d, phrase: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}
          placeholder="Câu / cụm từ tiếng Anh"
          className="ml-focus mb-1.5 block w-full rounded-xl border border-accent/35 bg-accent/10 px-2.5 py-2 text-[15px] font-semibold text-text placeholder:font-normal placeholder:text-subtle"
          data-ml-note-phrase=""
        />
        <textarea
          value={draft.meaning}
          onChange={(e) => setDraft((d) => ({ ...d, meaning: e.target.value }))}
          rows={2}
          placeholder="Nghĩa / ghi chú của bạn (để trống: tự điền nghĩa nếu là một từ)"
          className="ml-focus block w-full resize-none rounded-xl border border-ok/35 bg-ok/10 px-2.5 py-2 text-[15px] text-text placeholder:text-subtle"
          data-ml-note-meaning=""
        />
        <div className="mt-1.5 flex items-center gap-2">
          {draft.id && (
            <button type="button" onClick={cancelEdit} className="ml-press rounded-full bg-text/[0.07] px-3 py-1.5 text-[12.5px] font-semibold text-muted" data-ml-notes-cancel="">
              Hủy
            </button>
          )}
          <button type="button" disabled={!draft.phrase.trim() || status === 'saving'} onClick={() => void save()} className="ml-press ml-btn-primary ml-auto shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-semibold disabled:opacity-40" data-ml-notes-save="">
            {status === 'saving' ? 'Đang lưu…' : 'Lưu'}
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
