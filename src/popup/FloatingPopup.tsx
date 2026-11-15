import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { LookupResult, ParagraphAnalysis, PhraseLookup, SentenceAnalysis, WordLookup } from '@/shared/types';
import type { Settings } from '@/shared/settings';
import { Badge, Button, IconButton, Notice, SectionTitle, Spinner, Tabs, cx } from '@/ui/components';
import { IconBack, IconBookmark, IconCheck, IconCopy, IconEdit, IconGear, IconPanel, IconVolume, IconX } from '@/ui/icons';
import {
  ChunksView, GlossBlock, GrammarView, NotesView, PosBadge, SourceLine, TagBadges, VocabHints, WordContextView, WordExamples, WordGrammar,
  WordMeaning,
} from '@/ui/views';
import { canSpeak, speak } from '@/ui/speech';
import { computePopupPosition } from './position';
import { OcrMeaning } from './OcrMeaning';
import { MachineTranslation } from '@/ui/MachineTranslation';
import { popupSurface, prefersDark, resolveTheme } from '@/ui/theme';
import { crossfadeClass } from '@/ui/motion';
import { findBlock, useStore, type PopupView } from '@/content/store';
import * as A from '@/content/actions';

const MODE_LABEL = { word: 'Từ', phrase: 'Cụm từ', sentence: 'Câu', paragraph: 'Đoạn văn', unsupported: 'Ngôn ngữ khác' } as const;

export function FloatingPopup({ shadow }: { shadow: ShadowRoot }) {
  const live = useStore((s) => s.popup);
  const s = useStore((s) => s.settings);
  const ref = useRef<HTMLDivElement>(null);
  // Exit animation: after closing, the last popup stays on screen (inert) while it fades out.
  const last = useRef(live);
  const [, rerender] = useState(0);
  if (live?.open) last.current = live;
  const leaving = !live?.open && !!last.current?.open && s.popup.animation;
  if (!live?.open && !s.popup.animation) last.current = null;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      last.current = null;
      rerender((n) => n + 1);
    }, 210);
    return () => clearTimeout(t);
  }, [leaving]);
  const popup = live?.open ? live : leaving ? last.current : null;
  const fade = useRef({});
  const [height, setHeight] = useState(320);
  const [vp, setVp] = useState({ width: window.innerWidth, height: window.innerHeight });

  useLayoutEffect(() => {
    const onResize = () => setVp({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => ref.current && setHeight(ref.current.scrollHeight));
    ro.observe(ref.current.firstElementChild ?? ref.current);
    return () => ro.disconnect();
  }, [popup?.open]);

  if (!popup?.open) return null;
  const pos = computePopupPosition(popup.anchor, { width: s.popup.width, height }, vp, popup.prefer ?? s.popup.position);
  const surface = popupSurface(s, resolveTheme(s.appearance.theme, prefersDark()));
  const view = popup.stack[popup.stack.length - 1];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="LingoLens"
      {...(leaving ? { 'data-ml-popup-leaving': '', 'aria-hidden': true } : { 'data-ml-popup': '' })}
      data-theme={surface.theme}
      data-placement={pos.placement}
      className={cx('ml-glass pointer-events-auto fixed flex flex-col overflow-hidden rounded-[20px] text-text', leaving ? 'ml-out' : s.popup.animation && 'animate-ml-in')}
      style={{ ...(surface.vars as React.CSSProperties), left: pos.left, top: pos.top, width: pos.width, maxHeight: Math.min(pos.maxHeight, 640), opacity: s.popup.opacity }}
    >
      <div className={cx('flex min-h-0 flex-1 flex-col', crossfadeClass(`${popup.stack.length}|${popup.tab}|${view.kind === 'lookup' ? view.req.text : view.kind}`, fade.current))}>
        {view.kind === 'lookup' ? <LookupView view={view} s={s} canBack={popup.stack.length > 1} tab={popup.tab} /> : <OcrView view={view} s={s} shadow={shadow} canBack={popup.stack.length > 1} />}
      </div>
    </div>
  );
}

function Header({ title, sub, badges, actions, canBack }: { title: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode; canBack: boolean }) {
  return (
    <div className="flex items-start gap-1 border-b border-border/60 px-3.5 pb-2.5 pt-3">
      {canBack && (
        <IconButton label="Quay lại" onClick={A.back} className="-ml-1.5 mt-px">
          <IconBack />
        </IconButton>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">{title}</div>
        {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
        {badges && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
      </div>
      <div className="-mr-1.5 flex shrink-0 items-center">
        {actions}
        <IconButton label="Mở Sidebar" onClick={() => void A.openSidebar(A.currentPayload())}>
          <IconPanel />
        </IconButton>
        <IconButton label="Cài đặt" onClick={() => A.openSettings('popup')}>
          <IconGear />
        </IconButton>
        <IconButton label="Đóng (Esc)" onClick={A.closePopup}>
          <IconX />
        </IconButton>
      </div>
    </div>
  );
}

function SpeakButton({ text, s }: { text: string; s: Settings }) {
  if (!s.dictionary.showPronunciation) return null;
  const ok = canSpeak();
  return (
    <IconButton label={ok ? 'Phát âm' : 'Trình duyệt không hỗ trợ phát âm'} disabled={!ok} onClick={() => speak(text)}>
      <IconVolume />
    </IconButton>
  );
}

function SaveButton({ onSave, lemma }: { onSave: () => void; lemma: string }) {
  const [saved, setSaved] = useState(false);
  useLayoutEffect(() => {
    let alive = true;
    void A.vocab.findByLemma(lemma).then((e) => alive && setSaved(!!e));
    return () => {
      alive = false;
    };
  }, [lemma]);
  return (
    <IconButton
      label={saved ? 'Đã lưu trong sổ từ' : 'Lưu từ'}
      active={saved}
      onClick={() => {
        onSave();
        setSaved(true);
      }}
    >
      {saved ? <IconCheck /> : <IconBookmark />}
    </IconButton>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="ml-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3">{children}</div>;
}

function LookupView({ view, s, canBack, tab }: { view: Extract<PopupView, { kind: 'lookup' }>; s: Settings; canBack: boolean; tab: string }) {
  if (view.loading || (!view.result && !view.error)) {
    return (
      <>
        <Header canBack={canBack} title={<span className="truncate text-[15px] font-semibold text-text">{view.req.text.slice(0, 80)}</span>} />
        <div className="flex items-center gap-2 px-3 py-5 text-[13px] text-muted">
          <Spinner /> Đang tra cứu…
        </div>
      </>
    );
  }
  if (view.error) {
    return (
      <>
        <Header canBack={canBack} title={<span className="truncate text-[15px] font-semibold text-text">{view.req.text.slice(0, 80)}</span>} />
        <Body>
          <Notice tone="error" title="Không tra cứu được">
            {view.error}
          </Notice>
        </Body>
      </>
    );
  }
  const r = view.result as LookupResult;
  switch (r.kind) {
    case 'word':
      return <WordView r={r} s={s} canBack={canBack} tab={tab} />;
    case 'phrase':
      return <PhraseView r={r} s={s} canBack={canBack} tab={tab} context={view.req.context} />;
    case 'sentence':
      return <SentenceView r={r} s={s} canBack={canBack} tab={tab} />;
    case 'paragraph':
      return <ParagraphView r={r} s={s} canBack={canBack} tab={tab} />;
    case 'unsupported':
      return (
        <>
          <Header canBack={canBack} title={<span className="text-[15px] font-semibold text-text">Ngôn ngữ: {r.language.name}</span>} badges={<Badge tone="warn">{MODE_LABEL.unsupported}</Badge>} />
          <Body>
            <Notice tone="warn" title="Chưa hỗ trợ ngôn ngữ này">
              LingoLens nhận diện văn bản là <b>{r.language.name}</b> (độ tin cậy {Math.round(r.language.confidence * 100)}%, phương pháp: {r.language.method}). Dữ liệu từ điển hiện chỉ có tiếng Anh nên không hiển thị bản dịch để tránh sai.
            </Notice>
            <div className="mt-2">
              <Button size="sm" onClick={() => A.drillDown(r.text)} onMouseDown={() => undefined}>
                Vẫn tra như tiếng Anh
              </Button>
            </div>
          </Body>
        </>
      );
  }
}

function useTabs(s: Settings, defs: { id: string; label: string; section: keyof Settings['popup']['sections'] }[], tab: string) {
  const tabs = defs.filter((d) => s.popup.sections[d.section]);
  const active = tabs.find((t) => t.id === tab)?.id ?? tabs[0]?.id ?? '';
  return { tabs, active };
}

function WordView({ r, s, canBack, tab }: { r: WordLookup; s: Settings; canBack: boolean; tab: string }) {
  const { tabs, active } = useTabs(
    s,
    [
      { id: 'meaning', label: 'Nghĩa', section: 'meaning' },
      { id: 'context', label: 'Ngữ cảnh', section: 'context' },
      { id: 'examples', label: 'Ví dụ', section: 'examples' },
      { id: 'grammar', label: 'Ngữ pháp', section: 'grammar' },
    ],
    tab,
  );
  return (
    <>
      <Header
        canBack={canBack}
        title={
          <>
            <span className="text-[17px] font-semibold tracking-tight text-text">{r.lemma !== r.query.toLowerCase() && r.found ? r.lemma : r.query}</span>
            {s.dictionary.showIpa && r.ipa && <span className="ml-ipa text-[12.5px] text-muted" title={`IPA (General American) – ${r.ipaSource === 'cmudict' ? 'chuyển từ CMUdict' : r.ipaSource}`}>{r.ipa}</span>}
          </>
        }
        sub={r.lemma !== r.query.toLowerCase() && r.found ? <>từ gốc của “{r.query}”</> : undefined}
        badges={
          <>
            <Badge tone="accent">{MODE_LABEL.word}</Badge>
            {s.dictionary.showPos && r.posList.slice(0, 3).map((p) => <PosBadge key={p} pos={p} />)}
            <TagBadges tags={r.tags.filter((t) => t === 'slang' || t === 'vulgar' || t === 'informal')} />
          </>
        }
        actions={
          <>
            <SpeakButton text={r.query} s={s} />
            {r.found && <SaveButton lemma={r.lemma} onSave={() => void A.saveWord(r)} />}
          </>
        }
      />
      {!r.found ? (
        <Body>
          <Notice tone="warn" title={`Không tìm thấy “${r.query}”`}>
            Từ này không có trong WordNet, bộ Starter hoặc từ điển bạn đã nhập{r.ipa ? ' (chỉ có phát âm)' : ''}. Có thể là tên riêng, lỗi chính tả hoặc lỗi OCR.
          </Notice>
          {r.suggestions.length > 0 && (
            <div className="mt-2.5">
              <SectionTitle>Có phải bạn muốn tra</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {r.suggestions.map((w) => (
                  <Button key={w} size="sm" onClick={() => A.drillDown(w)}>
                    {w}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Body>
      ) : (
        <>
          {tabs.length > 1 && <Tabs className="px-2" tabs={tabs} value={active} onChange={A.setTab} />}
          <Body>
            {active === 'meaning' && <WordMeaning r={r} s={s} />}
            {active === 'context' && <WordContextView r={r} />}
            {active === 'examples' && <WordExamples r={r} s={s} onLookup={(t) => A.drillDown(t)} />}
            {active === 'grammar' && <WordGrammar r={r} />}
            <SourceLine sources={r.sources} />
          </Body>
        </>
      )}
    </>
  );
}

function PhraseView({ r, s, canBack, tab, context }: { r: PhraseLookup; s: Settings; canBack: boolean; tab: string; context?: string }) {
  const { tabs, active } = useTabs(
    s,
    [
      { id: 'meaning', label: 'Nghĩa', section: 'meaning' },
      { id: 'context', label: 'Ngữ cảnh', section: 'context' },
      { id: 'examples', label: 'Ví dụ', section: 'examples' },
      { id: 'grammar', label: 'Từng từ', section: 'grammar' },
    ],
    tab,
  );
  const vi = r.senses.filter((x) => x.vi?.length);
  const en = r.senses.filter((x) => x.en);
  const typeVi = { phrasal: 'cụm động từ', idiom: 'thành ngữ', slang: 'tiếng lóng', expression: 'cụm cố định', collocation: 'collocation', compound: 'từ ghép' };
  const examples = r.senses.flatMap((x) => x.examples ?? []);
  return (
    <>
      <Header
        canBack={canBack}
        title={<span className="text-[16px] font-semibold text-text">{r.phrase}</span>}
        sub={r.phrase !== r.query.toLowerCase() ? <>từ “{r.query}”</> : undefined}
        badges={
          <>
            <Badge tone="accent">{MODE_LABEL.phrase}</Badge>
            {r.phraseType && <Badge>{typeVi[r.phraseType]}</Badge>}
          </>
        }
        actions={
          <>
            <SpeakButton text={r.query} s={s} />
            <SaveButton lemma={r.phrase} onSave={() => void A.savePhrase(r.phrase, vi[0]?.vi?.join('; ') ?? en[0]?.en ?? '', context)} />
          </>
        }
      />
      {tabs.length > 1 && <Tabs className="px-2" tabs={tabs} value={active} onChange={A.setTab} />}
      <Body>
        {active === 'meaning' && (
          <div className="space-y-2">
            <MachineTranslation text={r.query} s={s} />
            {vi.length ? (
              <ul className="ml-tr space-y-0.5 text-text">
                {vi.map((x, i) => (
                  <li key={i}>• {x.vi!.join('; ')}</li>
                ))}
              </ul>
            ) : (
              <Notice tone="warn" title="Chưa có nghĩa tiếng Việt">Chỉ có định nghĩa tiếng Anh từ WordNet.</Notice>
            )}
            {s.dictionary.showEnglishDefinition && en.length > 0 && (
              <>
                <SectionTitle>English · WordNet</SectionTitle>
                <ol className="space-y-0.5 text-[13px] text-text">
                  {en.slice(0, 5).map((x, i) => (
                    <li key={i}>
                      {i + 1}. {x.en}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
        {active === 'context' && (
          <div className="space-y-2">
            {r.explanation && <Notice title="Cách dùng">{r.explanation}</Notice>}
            <NotesView notes={r.notes} empty={!r.explanation ? <Notice>Không có ghi chú ngữ cảnh cho cụm này.</Notice> : undefined} />
          </div>
        )}
        {active === 'examples' && (examples.length ? (
          <ul className="space-y-1.5">{examples.map((e, i) => <li key={i} className="ml-glass-card rounded-xl border-l-[3px] border-l-accent/50 px-2.5 py-1.5 text-[13px] italic">{e}</li>)}</ul>
        ) : <Notice>Không có ví dụ trong dữ liệu.</Notice>)}
        {active === 'grammar' && <ChunksView chunks={r.chunks} onLookup={(t) => A.drillDown(t)} />}
        <SourceLine sources={r.sources} />
      </Body>
    </>
  );
}

function SentenceView({ r, s, canBack, tab }: { r: SentenceAnalysis; s: Settings; canBack: boolean; tab: string }) {
  const { tabs, active } = useTabs(
    s,
    [
      { id: 'translation', label: 'Dịch', section: 'meaning' },
      { id: 'context', label: 'Ngữ cảnh', section: 'context' },
      { id: 'grammar', label: 'Ngữ pháp', section: 'grammar' },
      { id: 'vocab', label: 'Từ vựng', section: 'examples' },
    ],
    tab,
  );
  return (
    <>
      <Header
        canBack={canBack}
        title={<span className="line-clamp-3 text-[14px] font-medium leading-snug text-text">{r.text}</span>}
        badges={
          <>
            <Badge tone="accent">{MODE_LABEL.sentence}</Badge>
            {r.grammar.tense && <Badge>{r.grammar.tense.nameVi}</Badge>}
          </>
        }
        actions={<SpeakButton text={r.text} s={s} />}
      />
      {tabs.length > 1 && <Tabs className="px-2" tabs={tabs.map((t) => (t.id === 'context' ? { ...t, count: r.notes.length } : t.id === 'vocab' ? { ...t, count: r.vocabulary.length } : t))} value={active} onChange={A.setTab} />}
      <Body>
        {active === 'translation' && (
          <div className="space-y-2.5">
            <MachineTranslation text={r.text} s={s} />
            <GlossBlock gloss={r.gloss} coverage={r.coverage} />
            <SectionTitle>Từng cụm · click để tra</SectionTitle>
            <ChunksView chunks={r.chunks} onLookup={(t) => A.drillDown(t, r.text)} />
          </div>
        )}
        {active === 'context' && <NotesView notes={r.notes} empty={<Notice>Không phát hiện slang, thành ngữ hay sắc thái đặc biệt.</Notice>} />}
        {active === 'grammar' && <GrammarView g={r.grammar} compact />}
        {active === 'vocab' && <VocabHints items={r.vocabulary} onLookup={(t) => A.drillDown(t, r.text)} onSave={(v) => void A.savePhrase(v.lemma, v.vi ?? v.en ?? '', r.text)} />}
        <SourceLine sources={r.sources} />
      </Body>
    </>
  );
}

function ParagraphView({ r, s, canBack, tab }: { r: ParagraphAnalysis; s: Settings; canBack: boolean; tab: string }) {
  const { tabs, active } = useTabs(
    s,
    [
      { id: 'translation', label: 'Dịch', section: 'meaning' },
      { id: 'context', label: 'Ngữ cảnh', section: 'context' },
      { id: 'grammar', label: 'Ngữ pháp', section: 'grammar' },
      { id: 'vocab', label: 'Từ vựng', section: 'examples' },
    ],
    tab,
  );
  return (
    <>
      <Header
        canBack={canBack}
        title={<span className="text-[14px] font-medium text-text">Đoạn văn · {r.sentences.length} câu</span>}
        sub={<span className="line-clamp-2">{r.text}</span>}
        badges={<Badge tone="accent">{MODE_LABEL.paragraph}</Badge>}
        actions={<SpeakButton text={r.text} s={s} />}
      />
      {tabs.length > 1 && <Tabs className="px-2" tabs={tabs} value={active} onChange={A.setTab} />}
      <Body>
        {active === 'translation' && (
          <div className="space-y-2.5">
            <MachineTranslation text={r.text} s={s} />
            <div className="text-[11px] text-subtle">Ghép nghĩa từng cụm theo câu (Dictionary Mode) – không phải bản dịch tự nhiên. {Math.round(r.coverage * 100)}% từ/cụm có nghĩa tiếng Việt.</div>
            <ol className="space-y-2">
              {r.sentences.map((x, i) => (
                <li key={i} className="ml-glass-card rounded-xl p-2.5">
                  <button type="button" className="ml-focus block w-full text-left text-[13px] text-text hover:text-accent" onClick={() => A.drillDown(x.text)} title="Phân tích câu này">
                    {x.text}
                  </button>
                  <div className="ml-tr mt-1 text-muted">{x.gloss}</div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {active === 'context' && <NotesView notes={r.notes} empty={<Notice>Không phát hiện slang, thành ngữ hay sắc thái đặc biệt.</Notice>} />}
        {active === 'grammar' && (
          <ol className="space-y-3">
            {r.sentences.map((x, i) => (
              <li key={i}>
                <div className="mb-1 text-[12.5px] font-medium text-text">{i + 1}. {x.text}</div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone="accent">{x.grammar.sentenceType}</Badge>
                  {x.grammar.tense && <Badge>{x.grammar.tense.nameVi}</Badge>}
                  {x.grammar.voice === 'passive' && <Badge tone="warn">Bị động</Badge>}
                  {x.grammar.conditional && <Badge>Điều kiện {x.grammar.conditional.type}</Badge>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {active === 'vocab' && <VocabHints items={r.vocabulary} onLookup={(t) => A.drillDown(t)} onSave={(v) => void A.savePhrase(v.lemma, v.vi ?? v.en ?? '')} />}
        <SourceLine sources={r.sources} />
      </Body>
    </>
  );
}

function OcrView({ view, s, shadow, canBack }: { view: Extract<PopupView, { kind: 'ocr' }>; s: Settings; shadow: ShadowRoot; canBack: boolean }) {
  const found = findBlock(view.targetId, view.blockId);
  const [draft, setDraft] = useState(view.text);
  const textRef = useRef<HTMLDivElement>(null);
  if (!found) return null;
  const { block, target } = found;
  const edited = target.edits[view.blockId] !== undefined;
  const words = view.text.split(/(\s+)/);
  const lowConf = new Set(block.lines.flatMap((l) => l.words).filter((w) => w.confidence < 70).map((w) => w.text));

  const onMouseUp = () => {
    const sel = (shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection();
    const t = sel?.toString().trim();
    if (t && t.length > 1 && textRef.current?.contains(sel!.anchorNode)) A.drillDown(t, view.text);
  };

  return (
    <>
      <Header
        canBack={canBack}
        title={<span className="text-[14px] font-semibold text-text">Văn bản OCR</span>}
        badges={
          edited || target.result?.partial ? (
            <>
              {edited && <Badge>đã sửa</Badge>}
              {target.result?.partial && <Badge tone="warn">chỉ phần hiển thị</Badge>}
            </>
          ) : undefined
        }
        actions={<SpeakButton text={view.text} s={s} />}
      />
      <Body>
        {view.editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 40)))}
              className="ml-focus ml-glass-field w-full resize-y rounded-xl p-2.5 text-[13.5px] text-text"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="primary" onClick={() => A.editOcrBlock(view.targetId, view.blockId, draft.trim() || block.text)}>
                Lưu chỉnh sửa
              </Button>
              <Button size="sm" variant="ghost" onClick={() => A.setOcrEditing(false)}>
                Hủy
              </Button>
              {edited && (
                <Button size="sm" variant="ghost" onClick={() => A.editOcrBlock(view.targetId, view.blockId, block.text)}>
                  Khôi phục bản gốc
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="ml-card ml-glass-card rounded-2xl border-l-[4px] border-l-subtle px-3 py-2.5 hover:border-l-accent/70" data-ml-ocr-original="">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-subtle" /> Nguyên văn
            </div>
            <div ref={textRef} onMouseUp={onMouseUp} className="ml-tr select-text leading-relaxed text-text">
              {words.map((w, i) =>
                /\s+/.test(w) ? (
                  w
                ) : (
                  <span
                    key={i}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()?.toString().trim()) return;
                      e.stopPropagation();
                      A.drillDown(w.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '') || w, view.text);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && A.drillDown(w, view.text)}
                    className={cx('ml-word', lowConf.has(w) && 'underline decoration-warn decoration-dotted underline-offset-4')}
                    title={lowConf.has(w) ? 'Độ tin cậy thấp – có thể nhận diện sai' : undefined}
                  >
                    {w}
                  </span>
                ),
              )}
            </div>
            </div>
            <OcrMeaning text={view.text} s={s} />
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
              <Button size="sm" variant="primary" onClick={() => A.drillDown(view.text)}>
                Phân tích câu
              </Button>
              <Button size="sm" onClick={() => { setDraft(view.text); A.setOcrEditing(true); }}>
                <IconEdit size={14} /> Sửa
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(view.text)}>
                <IconCopy size={14} /> Sao chép
              </Button>
            </div>
          </>
        )}
      </Body>
    </>
  );
}

