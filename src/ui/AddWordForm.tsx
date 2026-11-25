import { useState } from 'react';
import { Button } from './components';
import { lookupWord } from './vocab-enrich';
import type { VocabStore } from '@/storage/vocab-store';

/**
 * "Thêm từ" in the vocabulary notebook: type a word (or phrase) and, if you like, your own meaning; "Lưu" adds it. For a single word the
 * pronunciation, part of speech and (when the meaning is left empty) the Vietnamese meaning are filled from the dictionary.
 */
export function AddWordForm({ store, onDone }: { store: VocabStore; onDone: (message: string) => void }) {
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const w = word.trim();
    if (!w || busy) return;
    setBusy(true);
    setError('');
    try {
      const info = await lookupWord(w);
      const { created } = await store.add({ word: w, lemma: info?.lemma ?? w.toLowerCase(), ipa: info?.ipa, pos: info?.pos, meaning: meaning.trim() || info?.meaning || '' });
      onDone(
        !created ? `“${w}” đã có trong Sổ từ.` : info || /\s/.test(w) ? `Đã lưu “${w}” vào Sổ từ ✓` : `Đã lưu “${w}” ✓ (chưa có trong từ điển: bạn có thể tự thêm nghĩa).`,
      );
    } catch (e) {
      setError((e as Error).message || 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-glass-card space-y-1.5 rounded-2xl border-l-[4px] border-l-accent p-2.5" data-ml-add-word="">
      <div className="text-[12px] font-bold uppercase tracking-wider text-accent">Thêm từ mới</div>
      <input
        value={word}
        onChange={(e) => setWord(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}
        placeholder="Từ hoặc cụm từ tiếng Anh"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="ml-focus block w-full rounded-xl border border-accent/35 bg-accent/10 px-2.5 py-2 text-[15px] font-semibold text-text placeholder:font-normal placeholder:text-subtle"
        data-ml-add-word-input=""
      />
      <input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}
        placeholder="Nghĩa (để trống: tự điền từ từ điển)"
        className="ml-focus block w-full rounded-xl border border-ok/35 bg-ok/10 px-2.5 py-2 text-[15px] text-text placeholder:text-subtle"
        data-ml-add-word-meaning=""
      />
      {error && <div className="text-[12px] text-danger">{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={() => onDone('')} data-ml-add-word-cancel="">
          Hủy
        </Button>
        <Button size="sm" variant="primary" disabled={!word.trim() || busy} onClick={() => void save()} data-ml-add-word-save="">
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}
