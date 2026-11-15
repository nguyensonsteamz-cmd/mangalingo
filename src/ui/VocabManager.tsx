/** Vocabulary notebook UI: search, filter, status, notes, export/import, storage usage. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LearningStatus, VocabEntry } from '@/shared/types';
import { chromeLocal } from '@/storage/kv';
import { OcrCache } from '@/storage/ocr-cache';
import { filterVocab, VocabStore } from '@/storage/vocab-store';
import { Badge, Button, Empty, IconButton, Notice, Segmented, Select, cx } from './components';
import { IconBook, IconDownload, IconSearch, IconTrash, IconUpload, IconVolume } from './icons';
import { download, stamp } from './hooks';
import { canSpeak, speak } from './speech';

const kv = chromeLocal();
export const vocabStore = new VocabStore(kv, () => new OcrCache(kv).evictOldest(60));

const STATUS_VI: Record<LearningStatus, string> = { new: 'Mới', learning: 'Đang học', known: 'Đã thuộc' };

export function useVocab() {
  const [list, setList] = useState<VocabEntry[]>([]);
  const [usage, setUsage] = useState<{ bytes: number; total: number; quota: number; count: number } | null>(null);
  useEffect(() => {
    const load = () => {
      void vocabStore.list().then(setList);
      void vocabStore.usage().then(setUsage);
    };
    load();
    return vocabStore.subscribe(load);
  }, []);
  return { list, usage };
}

export function VocabManager({ compact }: { compact?: boolean }) {
  const { list, usage } = useVocab();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LearningStatus | 'all'>('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'az'>('newest');
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => filterVocab(list, { q, status, sort }), [list, q, status, sort]);
  const counts = useMemo(() => ({ all: list.length, new: list.filter((e) => e.status === 'new').length, learning: list.filter((e) => e.status === 'learning').length, known: list.filter((e) => e.status === 'known').length }), [list]);

  const onImport = async (file: File) => {
    const text = await file.text();
    const format = /\.csv$/i.test(file.name) || /^[^{[]/.test(text.trim()) ? 'csv' : 'json';
    try {
      const r = await vocabStore.importText(text, format);
      setMsg({ tone: r.errors.length ? 'warn' : 'info', text: `Đã nhập ${r.added} từ, bỏ qua ${r.skipped} (trùng hoặc không hợp lệ).${r.errors.length ? ` ${r.errors.join(' ')}` : ''}` });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  const pct = usage ? Math.round((usage.total / usage.quota) * 100) : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm từ, nghĩa, ghi chú…"
            className="ml-focus ml-glass-field h-9 w-full rounded-full pl-8 pr-3 text-[13px] text-text placeholder:text-subtle"
          />
        </div>
        <Select value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Mới nhất' }, { value: 'oldest', label: 'Cũ nhất' }, { value: 'az', label: 'A → Z' }]} />
      </div>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: `Tất cả ${counts.all}` },
          { value: 'new', label: `Mới ${counts.new}` },
          { value: 'learning', label: `Đang học ${counts.learning}` },
          { value: 'known', label: `Đã thuộc ${counts.known}` },
        ]}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={async () => download(`mangalingo-vocab-${stamp()}.json`, await vocabStore.exportJson(), 'application/json')} disabled={!list.length}>
          <IconDownload size={14} /> JSON
        </Button>
        <Button size="sm" onClick={async () => download(`mangalingo-vocab-${stamp()}.csv`, '﻿' + (await vocabStore.exportCsv()), 'text/csv')} disabled={!list.length}>
          <IconDownload size={14} /> CSV
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <IconUpload size={14} /> Nhập
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
        {usage && (
          <span className={cx('ml-auto text-[11px]', pct > 85 ? 'text-warn' : 'text-subtle')} title="Dung lượng chrome.storage.local đã dùng (giới hạn 10 MB)">
            {(usage.total / 1024).toFixed(0)} KB / {(usage.quota / 1048576).toFixed(0)} MB
          </span>
        )}
      </div>
      {pct > 85 && <Notice tone="warn">Bộ nhớ tiện ích sắp đầy. Hãy xuất sổ từ ra tệp hoặc xóa cache OCR trong Cài đặt → Dữ liệu.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!list.length ? (
        <Empty title="Sổ từ vựng trống" icon={<IconBook size={28} />}>
          Bấm biểu tượng dấu trang trong popup tra từ để lưu từ, kèm câu gốc và nguồn.
        </Empty>
      ) : !shown.length ? (
        <Empty title="Không có kết quả">Thử từ khóa hoặc bộ lọc khác.</Empty>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => (
            <VocabItem key={e.id} e={e} compact={compact} />
          ))}
        </ul>
      )}
    </div>
  );
}

function VocabItem({ e, compact }: { e: VocabEntry; compact?: boolean }) {
  const [notes, setNotes] = useState(e.notes ?? '');
  const [editing, setEditing] = useState(false);
  return (
    <li
      className={cx(
        'ml-card ml-glass-card rounded-2xl border-l-[4px] p-3 hover:shadow-[0_10px_24px_-14px_rgb(0_0_0/0.45)]',
        e.status === 'known' ? 'border-l-ok hover:border-ok/50' : e.status === 'learning' ? 'border-l-warn hover:border-warn/50' : 'border-l-accent hover:border-accent/50',
      )}
      data-ml-vocab-item=""
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[16px] font-bold tracking-tight text-text">{e.word}</span>
            {e.ipa && <span className="ml-ipa text-[12px] text-accent">{e.ipa}</span>}
            {e.pos && <span className="rounded-full bg-text/[0.06] px-1.5 text-[10.5px] font-medium text-muted">{e.pos}</span>}
          </div>
          <div className="ml-tr mt-0.5 font-semibold text-text">{e.meaning || <span className="font-normal text-subtle">—</span>}</div>
        </div>
        {canSpeak() && (
          <IconButton label="Phát âm" onClick={() => speak(e.word)}>
            <IconVolume size={14} />
          </IconButton>
        )}
        <IconButton label="Xóa" onClick={() => void vocabStore.remove(e.id)}>
          <IconTrash size={14} />
        </IconButton>
      </div>
      {!compact && e.sentence && <div className="mt-2 rounded-xl bg-text/[0.05] px-2.5 py-1.5 text-[12.5px] italic leading-snug text-muted">“{e.sentence}”</div>}
      {!compact && e.translation && <div className="mt-0.5 pl-2.5 text-[12px] text-subtle">{e.translation}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(['new', 'learning', 'known'] as LearningStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => void vocabStore.setStatus(e.id, st)}
            className={cx(
              'ml-focus rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition-colors',
              e.status === st
                ? st === 'known'
                  ? 'bg-ok text-white ring-ok'
                  : st === 'learning'
                    ? 'bg-warn text-white ring-warn'
                    : 'bg-accent text-accent-fg ring-accent'
                : 'text-muted ring-border hover:text-text',
            )}
          >
            {STATUS_VI[st]}
          </button>
        ))}
        <button type="button" className="ml-focus rounded-md px-1.5 py-0.5 text-[11px] text-subtle hover:text-text" onClick={() => setEditing((v) => !v)}>
          {e.notes ? 'Sửa ghi chú' : '+ Ghi chú'}
        </button>
        {e.sourceUrl && !compact && (
          <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-auto max-w-[45%] truncate text-[11px] text-subtle hover:text-accent" title={e.sourceTitle ?? e.sourceUrl}>
            {e.sourceTitle || new URL(e.sourceUrl).hostname}
          </a>
        )}
        <span className="text-[10.5px] text-subtle">{new Date(e.createdAt).toLocaleDateString()}</span>
      </div>
      {e.notes && !editing && <div className="mt-1 rounded-xl bg-text/[0.05] px-2 py-1 text-[12px] text-text">{e.notes}</div>}
      {editing && (
        <div className="mt-1.5 flex gap-1.5">
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} maxLength={1000} className="ml-focus ml-glass-field min-w-0 flex-1 rounded-xl p-1.5 text-[12.5px] text-text" placeholder="Ghi chú của bạn" />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void vocabStore.update(e.id, { notes });
              setEditing(false);
            }}
          >
            Lưu
          </Button>
        </div>
      )}
      {e.status === 'known' && compact && <Badge tone="ok">đã thuộc</Badge>}
    </li>
  );
}
