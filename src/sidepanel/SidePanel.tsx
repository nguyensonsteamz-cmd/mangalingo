/** Reading sidebar (Chrome Side Panel): Translation · Vocabulary · Grammar · Context · Saved. */
import { vietnameseMeaning } from '@/ui/meaning';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { crossfadeClass } from '@/ui/motion';
import { send, type PageEvent, type SidebarPayload } from '@/shared/messages';
import type { Chunk, LookupResult, OcrResult, SentenceAnalysis, VocabHint } from '@/shared/types';
import type { Settings, SidebarTab } from '@/shared/settings';
import { useSettings } from '@/ui/hooks';
import { MachineTranslation } from '@/ui/MachineTranslation';
import { Badge, Button, Empty, GlassIndicator, IconButton, Notice, SectionTitle, Spinner, cx, fastTap } from '@/ui/components';
import { IconBookmark, IconCompact, IconEdit, IconEraser, IconExpand, IconGear, IconInfo, IconLayers, IconLogo, IconPanel, IconScan, IconSearch, IconVolume } from '@/ui/icons';
import {
  ChunksView, GrammarView, NotesView, PosBadge, SourceLine, VocabHints, WordContextView, WordExamples, WordGrammar, WordMeaning,
} from '@/ui/views';
import { VocabManager, useVocab, vocabStore } from '@/ui/VocabManager';
import { canSpeak, speak } from '@/ui/speech';
import { notesStore } from '@/ui/notes';
import { CopyButton } from '@/ui/CopyButton';
import { ScanButtons } from '@/ui/ScanButtons';
import { DEFAULT_MAX_TOTAL } from '@/modules/translation';

const SIDEBAR_KEY = 'sidebar:current';

type Entry = { text: string; context?: string; result?: LookupResult; error?: string; loading: boolean; source?: { url?: string; title?: string } };

/** Chrome's on-device Translator API (absent e.g. in the Android app's WebView). */
const hasTranslator = typeof (globalThis as { Translator?: unknown }).Translator !== 'undefined';
/** Running inside the phone app (iPhone / Android) rather than the Chrome side panel. */
const IN_APP = !!(globalThis as { MangaLingoPlatform?: string; MangaLingoNative?: unknown }).MangaLingoPlatform || !!(globalThis as { MangaLingoNative?: unknown }).MangaLingoNative;

/**
 * Notes and the notebook are one page ("Sổ từ"): a note is a phrase with your own meaning, which "+ Thêm từ" does. Notes written before
 * the merge that are not in the notebook yet are copied there once.
 */
async function mergeNotesOnce() {
  const FLAG = 'notes:mergedIntoVocab';
  if ((await chrome.storage.local.get(FLAG))[FLAG]) return;
  for (const n of await notesStore.list()) {
    const w = n.phrase.trim();
    if (w) await vocabStore.add({ word: w, lemma: w.toLowerCase(), meaning: n.meaning.trim(), sentence: n.context }).catch(() => {});
  }
  await chrome.storage.local.set({ [FLAG]: true });
}

export function SidePanel({ topBar }: { topBar?: ReactNode } = {}) {
  const { settings: s, loaded } = useSettings('sidebar');
  const [tab, setTabRaw] = useState<SidebarTab>('translation');
  // "Ghi chú" (old setting, the Reader's tools, older app pages) opens the merged notebook page
  const setTab = useCallback((t: SidebarTab) => setTabRaw(t === 'notes' ? 'saved' : t), []);
  useEffect(() => void mergeNotesOnce().catch(() => {}), []);
  const [compact, setCompact] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  // the pages the user came from (a word tapped inside a sentence analysis): "Quay lại" returns to the previous one, not to the bubble list
  const [trail, setTrail] = useState<Entry[]>([]);
  const requestedTab = useRef(false);
  // the phone's scan screen can ask for a tab ("Phân tích câu · từng từ" → Từ vựng)
  useEffect(() => {
    const g = globalThis as { __mlNextSidebarTab?: SidebarTab };
    if (entry && loaded && g.__mlNextSidebarTab) {
      requestedTab.current = true;
      setTab(g.__mlNextSidebarTab);
      g.__mlNextSidebarTab = undefined;
    }
  }, [entry, loaded]);
  // the Web Reader's native side can switch the tab (e.g. Ghi chú) of this sidebar
  useEffect(() => {
    const on = () => {
      const g = globalThis as { __mlNextSidebarTab?: SidebarTab };
      if (g.__mlNextSidebarTab) {
        setTab(g.__mlNextSidebarTab);
        g.__mlNextSidebarTab = undefined;
      }
    };
    window.addEventListener('ml-sidebar-tab', on);
    return () => window.removeEventListener('ml-sidebar-tab', on);
  }, []);
  const fade = useRef({});
  const [ocr, setOcr] = useState<OcrState | null>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!loaded) return;
    // a tab asked for by the phone's scan screen wins over the default tab
    if (!requestedTab.current && !(globalThis as { __mlNextSidebarTab?: string }).__mlNextSidebarTab) setTab(s.sidebar.defaultTab);
    setCompact(s.sidebar.defaultState === 'compact');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const entryRef = useRef<Entry | null>(null);
  entryRef.current = entry;
  const runLookup = useCallback(async (text: string, context?: string, source?: Entry['source'], preset?: LookupResult, fromEntry = false) => {
    if (!text.trim()) return;
    // opened from inside the current page: remember that page; a fresh look-up (from the web page, the scan list) starts a new trail
    const here = entryRef.current;
    setTrail((t) => (fromEntry && here ? [...t, here] : []));
    setEntry({ text, context, loading: !preset, result: preset, source });
    if (preset) return;
    try {
      const result = await send({ type: 'lookup', req: { text, context } });
      setEntry((e) => (e && e.text === text ? { ...e, result, loading: false } : e));
    } catch (e) {
      setEntry((cur) => (cur && cur.text === text ? { ...cur, error: (e as Error).message, loading: false } : cur));
    }
  }, []);

  const apply = useCallback(
    (p: SidebarPayload | null) => {
      if (!p) return;
      if (p.type === 'ocr') {
        setOcr({ result: p.result, pending: p.pending, error: p.error, source: p.source });
        setEntry(null);
        setTab('translation');
      } else {
        // a NEW lookup from the page (a selected word / sentence): start on the Dịch tab, like the popup does, instead of staying on
        // whichever tab the previous entry left open (that is what made a freshly translated sentence look out of sync)
        if (!(globalThis as { __mlNextSidebarTab?: string }).__mlNextSidebarTab) setTab('translation');
        void runLookup(p.text, p.context, p.source, p.result);
      }
    },
    [runLookup],
  );

  useEffect(() => {
    // Register with the background (lets the toggle shortcut close the panel) and load current content.
    void chrome.windows.getCurrent().then((w) => {
      if (w.id !== undefined) chrome.runtime.connect({ name: `sidepanel:${w.id}` });
    });
    void chrome.storage.session.get(SIDEBAR_KEY).then((r) => apply((r[SIDEBAR_KEY] as SidebarPayload) ?? null));
    const onMsg = (m: PageEvent) => {
      if (m?.type === 'sidebar:update') apply(m.payload);
      if (m?.type === 'sidebar:close') window.close();
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [apply]);

  const clear = () => {
    setEntry(null);
    setOcr(null);
    void chrome.storage.session.remove(SIDEBAR_KEY);
  };

  const width = s.sidebar.width === 'narrow' ? 'max-w-[400px]' : s.sidebar.width === 'comfortable' ? 'max-w-[540px]' : 'max-w-none';

  if (!s.sidebar.enabled) {
    return (
      <div className="p-4">
        <Notice tone="warn" title="Sidebar đang tắt">
          Bật lại trong Cài đặt → Sidebar.
        </Notice>
        <Button className="mt-2" size="sm" onClick={() => chrome.runtime.openOptionsPage()}>
          Mở Cài đặt
        </Button>
      </div>
    );
  }

  return (
    <div className={cx('mx-auto flex min-h-screen flex-col', width)}>
      <header className="ml-glass-bar sticky top-0 z-10 border-b" data-ml-sidebar-header="">
        {/* phone app: a minimal bar (back + page title) replaces the brand row */}
        {topBar ?? (
        <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-3">
          <IconLogo size={38} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-tight tracking-tight text-text">LingoLens</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-tight text-muted">
              <span className={cx('h-1.5 w-1.5 rounded-full', s.reading.translationMode === 'machine' && hasTranslator ? 'bg-ok' : 'bg-accent')} />
              {s.reading.translationMode === 'machine' && hasTranslator ? 'Dịch máy · chạy trên máy' : 'Từ điển · chạy trên máy'}
            </div>
          </div>
          <IconButton label="Sổ từ" onClick={() => setTab('saved')} active={tab === 'saved'} data-ml-notes-open="">
            <span aria-hidden="true">✏️</span>
          </IconButton>
          <IconButton label={compact ? 'Chế độ đầy đủ' : 'Chế độ thu gọn'} onClick={() => setCompact((v) => !v)} active={compact}>
            {compact ? <IconExpand /> : <IconCompact />}
          </IconButton>
          {IN_APP && (
            <label className="ml-focus ml-press inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-text/[0.07] hover:text-text" title="Tải tệp chữ lên (.txt, .srt)" aria-label="Tải tệp chữ lên" data-ml-text-upload="">
              📎
              <input
                type="file"
                accept=".txt,.md,.srt,.vtt,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  void f.text().then((t) => {
                    const text = t.replace(/^\uFEFF/, '').trim();
                    if (!text) return;
                    // no silent cut: the whole file is translated in chunks; only the application safety limit stops it, with a message
                    if (Array.from(text).length > DEFAULT_MAX_TOTAL) {
                      window.alert(`Tệp dài hơn giới hạn an toàn ${DEFAULT_MAX_TOTAL.toLocaleString('vi-VN')} ký tự, nên không được dịch. Hãy chia nhỏ tệp.`);
                      return;
                    }
                    setInput(text);
                    setOcr(null);
                    void runLookup(text);
                  });
                }}
              />
            </label>
          )}
          <IconButton label="Xóa nội dung" onClick={clear}>
            <IconEraser />
          </IconButton>
          <IconButton label="Cài đặt" onClick={() => chrome.runtime.openOptionsPage()}>
            <IconGear />
          </IconButton>
        </div>
        )}
        <form
          className={cx('px-3 pb-2', !!topBar && 'pt-2')}
          onSubmit={(e) => {
            e.preventDefault();
            setOcr(null);
            void runLookup(input);
          }}
        >
          {/* Large, high-contrast search box (16 px text: iPhone does not zoom the page on focus). */}
          <div className="flex items-stretch gap-2" data-ml-search="">
            <div className="relative min-w-0 flex-1">
              <IconSearch size={20} className="pointer-events-none absolute left-3.5 top-[15px] z-10 text-accent" />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setOcr(null);
                    void runLookup(input);
                  }
                }}
                rows={input.length > 40 ? 3 : 1}
                enterKeyHint="search"
                placeholder="Nhập từ hoặc câu tiếng Anh…"
                aria-label="Từ hoặc câu cần tra"
                className="ml-focus ml-glass block min-h-[52px] w-full resize-none rounded-[20px] py-3 pl-11 pr-10 text-[16px] font-medium leading-snug text-text transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-subtle hover:border-accent/40 focus:border-accent/70"
              />
              {input && (
                <button type="button" onClick={() => setInput('')} className="ml-press absolute right-2.5 top-[13px] z-10 flex h-7 w-7 items-center justify-center rounded-full bg-text/[0.08] text-muted hover:bg-text/[0.14] hover:text-text" aria-label="Xóa">
                  ×
                </button>
              )}
            </div>
            <button type="submit" data-ml-magnetic="" disabled={!input.trim()} className="ml-focus ml-press ml-btn-primary ml-sheen ml-ripple shrink-0 rounded-[20px] px-5 text-[15px] font-bold disabled:opacity-40">
              Tra
            </button>
          </div>
        </form>
        {/* the same page is the iPhone Reader's sidebar: there is no tab to scan there (Chrome only) */}
        {document.documentElement.dataset.app !== 'mobile' && <ScanButtons className="px-3 pb-1.5" />}
        <SidebarTabs value={tab} onChange={setTab} />
      </header>
      <main className={cx('ml-scroll flex-1 px-3 py-3', crossfadeClass(`${tab}|${entry?.text ?? ''}|${ocr ? 1 : 0}`, fade.current))}>
        {tab === 'saved' ? (
          <VocabManager compact={compact} />
        ) : ocr && !entry ? (
          <OcrPanel ocr={ocr} tab={tab} s={s} onAnalyze={(t) => void runLookup(t, undefined, ocr.source)} />
        ) : entry ? (
          <EntryView
            s={s}
            entry={entry}
            tab={tab}
            compact={compact}
            onLookup={(t, c) => void runLookup(t, c, entry.source, undefined, true)}
            backLabel={trail.length ? `← Quay lại “${trail[trail.length - 1].text.slice(0, 28)}${trail[trail.length - 1].text.length > 28 ? '…' : ''}”` : ocr ? '← Quay lại kết quả OCR' : undefined}
            onBack={
              trail.length
                ? () => {
                    const prev = trail[trail.length - 1];
                    setTrail(trail.slice(0, -1));
                    setEntry(prev);
                  }
                : ocr
                  ? () => setEntry(null)
                  : undefined
            }
          />
        ) : (
          <Empty title={IN_APP ? 'Tra từ hoặc câu tiếng Anh' : 'Chưa có nội dung'} icon={<IconLogo size={44} className="ml-float" />}>
            {IN_APP
              ? 'Nhập hoặc dán từ, câu, đoạn văn vào ô phía trên rồi bấm Tra: nghĩa tiếng Việt, phát âm, ngữ pháp và ngữ cảnh.'
              : 'Click hoặc bôi đen văn bản trên trang rồi bấm “Mở Sidebar” trong popup, hoặc nhập văn bản vào ô phía trên. Với manga, rê chuột lên ảnh và bấm “Quét OCR”.'}
          </Empty>
        )}
      </main>
      {/* the reader's own notes (phrase ↔ meaning), same as in the phone app */}
    </div>
  );
}

const TAB_ITEMS: { id: SidebarTab; label: string; icon: ReactNode }[] = [
  { id: 'translation', label: 'Dịch', icon: <IconPanel size={16} /> },
  { id: 'vocabulary', label: 'Từ vựng', icon: <IconLayers size={16} /> },
  { id: 'grammar', label: 'Ngữ pháp', icon: <IconEdit size={16} /> },
  { id: 'context', label: 'Ngữ cảnh', icon: <IconInfo size={16} /> },
  { id: 'saved', label: 'Sổ từ', icon: <IconBookmark size={16} /> },
];

/** Pill tabs: the active tab is a filled accent pill, easy to spot at a glance. */
function SidebarTabs({ value, onChange }: { value: SidebarTab; onChange: (v: SidebarTab) => void }) {
  return (
    <div className="px-3 pb-2.5">
      <div role="tablist" className="ml-glass-field relative grid grid-cols-5 gap-0.5 rounded-[18px] p-1">
        <GlassIndicator activeKey={value} className="rounded-[14px]" />
        {TAB_ITEMS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={value === t.id}
            data-ml-active={value === t.id}
            {...fastTap(() => onChange(t.id))}
            className={cx(
              'ml-focus ml-press relative z-[1] flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border border-transparent px-1 py-1.5 text-[11.5px] font-semibold leading-tight',
              value === t.id ? 'ml-sel-text' : 'text-muted hover:bg-surface/70 hover:text-text',
            )}
          >
            {t.icon}
            <span className="max-w-full truncate">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function useSavedLemmas() {
  const { list } = useVocab();
  return useMemo(() => new Set(list.map((e) => e.lemma)), [list]);
}

/** A phrase of the sentence analysis ("look forward to") goes to the notebook with its meaning. */
function savePhrase(c: Chunk, sentence?: string, source?: Entry['source']) {
  const w = (c.lemma ?? c.text).trim();
  void vocabStore.add({ word: w, lemma: w.toLowerCase(), meaning: c.vi ?? c.en ?? '', pos: 'phrase', sentence, sourceUrl: source?.url, sourceTitle: source?.title });
}

function saveHint(v: VocabHint, sentence?: string, source?: Entry['source']) {
  void vocabStore.add({ word: v.word, lemma: v.lemma, meaning: v.vi ?? v.en ?? '', pos: v.pos, sentence, sourceUrl: source?.url, sourceTitle: source?.title });
}

function EntryView({ s, entry, tab, compact, onLookup, onBack, backLabel }: { s: Settings; entry: Entry; tab: SidebarTab; compact: boolean; onLookup: (t: string, c?: string) => void; onBack?: () => void; backLabel?: string }) {
  const saved = useSavedLemmas();
  const r = entry.result;
  const back = onBack && (
    <button type="button" className="mb-2 text-[12px] text-accent hover:underline" onClick={onBack} data-ml-entry-back="">
      {backLabel ?? '← Quay lại'}
    </button>
  );
  if (entry.loading || (!r && !entry.error)) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <Spinner /> Đang phân tích…
      </div>
    );
  }
  if (entry.error || !r) return <Notice tone="error" title="Không tra cứu được">{entry.error}</Notice>;

  const Original = () => (
    <div className="ml-card ml-glass-card mb-3 rounded-2xl border-l-[4px] border-l-subtle p-3 hover:shadow-[0_10px_24px_-14px_rgb(0_0_0/0.45)]">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Văn bản gốc</span>
        <Badge tone="accent">{r.kind === 'word' ? 'Từ' : r.kind === 'phrase' ? 'Cụm từ' : r.kind === 'sentence' ? 'Câu' : r.kind === 'paragraph' ? 'Đoạn văn' : 'Khác'}</Badge>
        <span className="ml-auto flex items-center gap-0.5">
          <CopyButton text={entry.text} label="Sao chép văn bản gốc" className="h-6 w-6" />
          {canSpeak() && (
            <IconButton label="Đọc" className="h-6 w-6" onClick={() => speak(entry.text)}>
              <IconVolume size={14} />
            </IconButton>
          )}
        </span>
      </div>
      <div className="ml-tr whitespace-pre-wrap text-[1.05em] font-medium text-text">{entry.text}</div>
      {entry.source?.title && !compact && <div className="mt-1 truncate text-[11px] text-subtle">{entry.source.title}</div>}
    </div>
  );

  if (r.kind === 'unsupported') {
    return (
      <>
        {back}
        <Original />
        <Notice tone="warn" title={`Ngôn ngữ phát hiện: ${r.language.name}`}>
          Dữ liệu từ điển hiện chỉ hỗ trợ tiếng Anh, nên LingoLens không hiển thị bản dịch.
        </Notice>
      </>
    );
  }

  if (r.kind === 'word') {
    return (
      <>
        {back}
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-[20px] font-semibold tracking-tight text-text">{r.found ? r.lemma : r.query}</h2>
              {s.dictionary.showIpa && r.ipa && <span className="ml-ipa text-[13px] text-muted">{r.ipa}</span>}
              {r.posList.map((p) => <PosBadge key={p} pos={p} />)}
            </div>
            {r.found && r.lemma !== r.query.toLowerCase() && (
              <div className="mt-0.5 text-[12.5px] text-muted" data-ml-root-of={r.query}>
                Từ gốc của “{r.query}”: lưu từ sẽ lưu <b className="text-text">{r.lemma}</b> và nghĩa gốc của nó
              </div>
            )}
          </div>
          {canSpeak() && s.dictionary.showPronunciation && (
            <IconButton label="Phát âm" onClick={() => speak(r.query)}>
              <IconVolume />
            </IconButton>
          )}
          {r.found && (
            <Button size="sm" disabled={saved.has(r.lemma)} onClick={async () => void vocabStore.add({ word: r.lemma || r.query, lemma: r.lemma, ipa: r.ipa, meaning: await vietnameseMeaning(r, s.reading.targetLanguage), pos: r.context?.likelyPos ?? r.posList[0], sentence: r.context?.sentence, sourceUrl: entry.source?.url, sourceTitle: entry.source?.title })}>
              {saved.has(r.lemma) ? 'Đã lưu' : 'Lưu từ'}
            </Button>
          )}
        </div>
        {!r.found ? (
          <Notice tone="warn" title={`Không tìm thấy “${r.query}”`}>
            {r.suggestions.length ? <>Gợi ý: {r.suggestions.map((w) => <button key={w} type="button" className="ml-word text-accent" onClick={() => onLookup(w)}>{w}</button>)}</> : 'Không có trong dữ liệu hiện có.'}
          </Notice>
        ) : (
          <>
            {tab === 'translation' && <WordMeaning r={r} s={s} max={compact ? 4 : 20} posInHeader />}
            {tab === 'vocabulary' && <WordExamples r={r} s={s} onLookup={(t) => onLookup(t)} />}
            {tab === 'grammar' && <WordGrammar r={r} />}
            {tab === 'context' && <WordContextView r={r} />}
            {!compact && <SourceLine sources={r.sources} />}
          </>
        )}
      </>
    );
  }

  if (r.kind === 'phrase') {
    const vi = r.senses.filter((x) => x.vi?.length);
    return (
      <>
        {back}
        <Original />
        {tab === 'translation' && (
          <div className="space-y-2">
            <h2 className="text-[17px] font-semibold text-text">{r.phrase}</h2>
            <MachineTranslation text={r.query} s={s} />
            {vi.length ? <ul className="ml-tr space-y-0.5">{vi.map((x, i) => <li key={i}>• {x.vi!.join('; ')}</li>)}</ul> : <Notice tone="warn">Chưa có nghĩa tiếng Việt cho cụm này.</Notice>}
            {r.senses.filter((x) => x.en).slice(0, 6).map((x, i) => <div key={i} className="text-[13px] text-muted">{i + 1}. {x.en}</div>)}
          </div>
        )}
        {tab === 'vocabulary' && <ChunksView chunks={r.chunks} onLookup={(t) => onLookup(t, entry.text)} saved={saved} onSave={(c) => savePhrase(c, entry.text, entry.source)} />}
        {tab === 'grammar' && <Notice>Cụm từ cố định – xem từng thành phần ở tab Từ vựng.</Notice>}
        {tab === 'context' && (
          <div className="space-y-2">
            {r.explanation && <Notice title="Cách dùng">{r.explanation}</Notice>}
            <NotesView notes={r.notes} empty={!r.explanation ? <Notice>Không có ghi chú ngữ cảnh.</Notice> : undefined} />
          </div>
        )}
        {!compact && <SourceLine sources={r.sources} />}
      </>
    );
  }

  const sentences: SentenceAnalysis[] = r.kind === 'sentence' ? [r] : r.sentences;
  return (
    <>
      {back}
      <Original />
      {tab === 'translation' && (
        <div className="space-y-3">
          {/* the FULL text the user gave (the analysis below is limited to its first ~6,000 characters; the translation is not) */}
          <MachineTranslation text={r.fullText ?? r.text} s={s} />
          {r.fullText && (
            <div className="text-[11.5px] text-subtle" data-ml-analysis-limit="">Phân tích chi tiết (từ vựng, ngữ pháp) áp dụng cho {r.text.length.toLocaleString('vi-VN')} ký tự đầu; bản dịch bao gồm toàn bộ {r.fullText.length.toLocaleString('vi-VN')} ký tự.</div>
          )}
          {r.kind === 'paragraph' && <div className="text-[11.5px] text-subtle">{sentences.length} câu · {Math.round(r.coverage * 100)}% từ/cụm có nghĩa tiếng Việt</div>}
          {sentences.map((x, i) => (
            <div key={i} className="space-y-1.5">
              {r.kind === 'paragraph' && <div className="text-[13px] font-medium text-text">{i + 1}. {x.text}</div>}
              {/* word-by-word analysis (tap a word / phrase to look it up); the "ghép nghĩa" gloss box stays removed */}
              {!compact && <ChunksView chunks={x.chunks} onLookup={(t) => onLookup(t, x.text)} saved={saved} onSave={(c) => savePhrase(c, x.text, entry.source)} />}
            </div>
          ))}
        </div>
      )}
      {tab === 'vocabulary' && <VocabHints s={s} items={r.vocabulary} onLookup={(t) => onLookup(t, entry.text)} onSave={(v) => saveHint(v, entry.text, entry.source)} saved={saved} />}
      {tab === 'grammar' && (
        <div className="space-y-4">
          {sentences.map((x, i) => (
            <div key={i}>
              {sentences.length > 1 && <SectionTitle>{`Câu ${i + 1}: ${x.text.slice(0, 60)}${x.text.length > 60 ? '…' : ''}`}</SectionTitle>}
              <GrammarView g={x.grammar} compact={compact} />
            </div>
          ))}
        </div>
      )}
      {tab === 'context' && <NotesView notes={r.notes} empty={<Notice>Không phát hiện slang, thành ngữ hay sắc thái đặc biệt.</Notice>} />}
      {!compact && <SourceLine sources={r.sources} />}
    </>
  );
}

type OcrState = { result?: OcrResult; pending?: boolean; error?: string; source?: { url?: string; title?: string } };

/** Full-page OCR in the sidebar: one numbered card per speech bubble (same numbers as on the page). */
function OcrPanel({ ocr, tab, onAnalyze, s }: { ocr: OcrState; tab: SidebarTab; onAnalyze: (text: string) => void; s: Settings }) {
  const r = ocr.result;
  if (ocr.pending && !r) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-muted" data-ml-sidebar-ocr="pending">
        <Spinner />
        Đang quét chữ trên trang…
      </div>
    );
  }
  if (!r) return <Notice tone="warn" title="Không quét được">{ocr.error ?? 'Không có kết quả OCR.'}</Notice>;
  if (tab !== 'translation') {
    return <Notice>Bấm “Phân tích” ở một bong bóng trong tab “Dịch” để xem từ vựng, ngữ pháp và ngữ cảnh.</Notice>;
  }
  return (
    <div className="space-y-2.5" data-ml-sidebar-ocr="done">
      <div className="flex items-center gap-1.5">
        <IconScan size={16} className="text-accent" />
        <span className="text-[13px] font-semibold text-text">Chữ trên trang</span>
        <Badge>{r.blocks.length} bong bóng</Badge>
        {r.partial && <Badge tone="warn">phần đang hiển thị</Badge>}
      </div>
      {r.blocks.length === 0 ? (
        <Empty title="Không nhận diện được chữ nào" />
      ) : (
        <ol className="space-y-2">
          {r.blocks.map((b, i) => (
            <li
              key={b.id}
              className="ml-card ml-glass-card rounded-2xl border-l-[4px] border-l-[rgb(var(--ml-box))] p-2.5 hover:border-[rgb(var(--ml-box)/0.6)] hover:shadow-[0_8px_18px_-10px_rgb(var(--ml-box)/0.7)]"
              data-ml-sidebar-bubble=""
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[11px] font-bold text-white">{i + 1}</span>
                <div className="ml-tr min-w-0 flex-1 text-text">{b.text}</div>
                {canSpeak() && (
                  <IconButton label="Phát âm" onClick={() => speak(b.text)}>
                    <IconVolume size={15} />
                  </IconButton>
                )}
              </div>
              <MachineTranslation text={b.text} s={s} className="mt-2" />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => onAnalyze(b.text)}>
                  Phân tích
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {r.blocks.length > 1 && (
        <Button size="sm" onClick={() => onAnalyze(r.blocks.map((b) => b.text).join('\n\n'))}>
          Phân tích tất cả
        </Button>
      )}
    </div>
  );
}
