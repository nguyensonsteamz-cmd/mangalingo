/**
 * Result renderers shared by the floating popup and the side panel. Data provenance is always
 * visible: Vietnamese meanings from curated data, English definitions from WordNet, rule-based
 * analysis marked as such, and missing data shown as missing.
 */
import { Fragment, type ReactNode } from 'react';
import type { Chunk, ContextNote, GrammarReport, Pos, Sense, SourceInfo, VocabHint, WordLookup } from '@/shared/types';
import type { Settings } from '@/shared/settings';
import { Badge, Notice, SectionTitle, Spinner, cx } from './components';
import { useMt } from './useMt';

export const POS_VI: Record<Pos, string> = {
  noun: 'danh từ', verb: 'động từ', adj: 'tính từ', adv: 'trạng từ', pron: 'đại từ', det: 'hạn định từ', prep: 'giới từ',
  conj: 'liên từ', interj: 'thán từ', num: 'số từ', aux: 'trợ động từ', modal: 'động từ khuyết thiếu', part: 'tiểu từ', phrase: 'cụm từ', other: 'khác',
};
export const POS_EN: Partial<Record<Pos, string>> = { noun: 'n.', verb: 'v.', adj: 'adj.', adv: 'adv.', pron: 'pron.', det: 'det.', prep: 'prep.', conj: 'conj.', interj: 'interj.', num: 'num.', aux: 'aux.', modal: 'modal', phrase: 'phr.' };
const TAG_VI: Record<string, string> = {
  slang: 'tiếng lóng', informal: 'khẩu ngữ', vulgar: 'thô tục', idiom: 'thành ngữ', phrasal: 'cụm động từ', expression: 'cụm cố định',
  abbr: 'viết tắt', contraction: 'rút gọn', archaic: 'cổ', formal: 'trang trọng', interjection: 'thán từ',
};
const RULE_VI: Record<string, string> = {
  'irregular past': 'quá khứ bất quy tắc của',
  'irregular past participle': 'quá khứ phân từ bất quy tắc của',
  'irregular plural': 'số nhiều bất quy tắc của',
  'irregular comparison': 'dạng so sánh của',
  'auxiliary form': 'dạng chia của',
  'clipped form': 'dạng nói tắt của',
};
export const ruleLabel = (rule: string) => RULE_VI[rule] ?? `dạng biến đổi (${rule}) của`;

export function PosBadge({ pos }: { pos: Pos }) {
  return <span className="ml-chip" title={POS_VI[pos]}>{POS_EN[pos] ?? pos} · {POS_VI[pos]}</span>;
}

export function TagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <>
      {tags.map((t) => (
        <Badge key={t} tone={t === 'vulgar' ? 'danger' : t === 'slang' || t === 'informal' ? 'warn' : 'neutral'}>
          {TAG_VI[t] ?? t}
        </Badge>
      ))}
    </>
  );
}

export function SourceLine({ sources }: { sources: SourceInfo[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-snug text-subtle">
      Nguồn:{' '}
      {sources.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && ' · '}
          <span title={s.license}>
            {s.name}
            {s.kind === 'curated' && ' (chưa kiểm duyệt chuyên môn)'}
            {s.kind === 'rules' && ' (quy tắc)'}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function groupByPos(senses: Sense[]): [Pos, Sense[]][] {
  const map = new Map<Pos, Sense[]>();
  for (const s of senses) {
    if (!map.has(s.pos)) map.set(s.pos, []);
    map.get(s.pos)!.push(s);
  }
  return [...map];
}

export function InflectionLine({ r }: { r: WordLookup }) {
  if (!r.inflections.length) return null;
  return (
    <div className="mb-2 text-[12.5px] text-muted">
      {r.inflections.slice(0, 2).map((x, i) => (
        <div key={i}>
          “{r.query}” là {ruleLabel(x.rule)} <b className="text-text">{x.lemma}</b>
        </div>
      ))}
    </div>
  );
}

/** Vietnamese meanings grouped by part of speech, then English definitions. */
export function WordMeaning({ r, s, max = 6, posInHeader = false }: { r: WordLookup; s: Settings; max?: number; posInHeader?: boolean }) {
  const vi = r.senses.filter((x) => x.vi?.length);
  const en = r.senses.filter((x) => x.en);
  const englishTarget = s.reading.targetLanguage === 'en';
  return (
    <div>
      <InflectionLine r={r} />
      {/* the dictionary meanings are curated and ranked by usage – they come first; a lone word translated by the
          small on-device model (no context) is only a cross-check. Words without Vietnamese data get the machine translation on top. */}
      {!englishTarget && vi.length === 0 && <MtWordMeaning r={r} s={s} hasEnglish={en.length > 0} noDict />}
      {englishTarget ? (
        <EnglishDefinitions r={r} en={en} s={s} max={max} title="English definitions · WordNet" />
      ) : vi.length > 0 ? (
        <div className="mt-2 space-y-2">
          {groupByPos(vi).map(([pos, list]) => (
            <div key={pos}>
              {/* the header already shows the part of speech: repeat it only to tell several groups apart */}
              {s.dictionary.showPos && !(posInHeader && groupByPos(vi).length === 1) && <div className="mb-0.5"><PosBadge pos={pos} /></div>}
              <ul className="ml-tr space-y-0.5 text-text">
                {list.map((x, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-subtle">•</span>
                    <span>
                      {x.vi!.join('; ')}
                      {x.tags?.length ? <span className="ml-1.5 inline-flex gap-1 align-middle"><TagBadges tags={x.tags} /></span> : null}
                      {x.note && <div className="text-[12px] text-muted">{x.note}</div>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {!englishTarget && vi.length > 0 && <MtWordMeaning r={r} s={s} hasEnglish={en.length > 0} noDict={false} secondary />}
      {englishTarget && vi.length > 0 && (
        <>
          <SectionTitle>Tiếng Việt</SectionTitle>
          <div className="ml-tr text-muted">{vi.map((x) => x.vi!.join('; ')).join(' · ')}</div>
        </>
      )}
      {!englishTarget && s.dictionary.showEnglishDefinition && <EnglishDefinitions r={r} en={en} s={s} max={max} title="English definitions · WordNet" />}
    </div>
  );
}

/**
 * Word without Vietnamese data: machine translation of the word (Chrome, on-device) when the
 * translation mode allows it; otherwise the honest "no Vietnamese data" notice.
 */
function MtWordMeaning({ r, s, hasEnglish, noDict, secondary = false }: { r: WordLookup; s: Settings; hasEnglish: boolean; noDict: boolean; secondary?: boolean }) {
  // Translate the word as written (keeps plural/tense), falling back to the base form.
  // lower case: a capitalised lone word reads like an exclamation to the translator ("You" → "Mày!")
  const word = (r.found ? r.query.trim() || r.lemma : r.query).toLowerCase();
  const mt = useMt(r.found ? word : undefined, s);
  const vi = mt ? mt.charAt(0).toLowerCase() + mt.slice(1) : mt;
  if (secondary) {
    // cross-check line under the dictionary meanings: nothing while pending / when it only repeats them
    const known = r.senses.flatMap((x) => x.vi ?? []).join(' ').toLowerCase();
    if (!vi || vi.trim().toLowerCase() === word.toLowerCase() || known.includes(vi.trim().toLowerCase())) return null;
    return (
      <div className="mt-2 text-[12.5px] text-muted" data-ml-word-mt="">
        <span className="mr-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent" title="Dịch máy từng từ, không có ngữ cảnh – chỉ để đối chiếu">dịch máy</span>
        {vi}
      </div>
    );
  }
  if (vi === undefined) {
    return (
      <div className="flex items-center gap-2 py-1 text-[12.5px] text-muted">
        <Spinner /> Đang dịch…
      </div>
    );
  }
  if (vi && vi.trim().toLowerCase() !== word.toLowerCase()) {
    return (
      <div className="ml-card rounded-xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.07] px-3 py-2 hover:border-accent/50" data-ml-word-mt="">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Nghĩa
          <span className="rounded bg-accent/15 px-1 text-[10px] font-semibold normal-case tracking-normal text-accent" title="Dịch máy – chạy trên máy của bạn">
            dịch máy
          </span>
        </div>
        <div className="ml-tr text-[1.1em] font-bold text-text">{vi}</div>
      </div>
    );
  }
  if (!noDict) return null;
  return (
    <Notice tone="warn" title="Chưa có nghĩa tiếng Việt">
      Bộ dữ liệu Anh–Việt hiện tại chưa có từ này. {hasEnglish ? 'Định nghĩa tiếng Anh (WordNet) bên dưới là dữ liệu thật.' : ''} Bật “Dịch máy” trong Cài đặt → Hành vi đọc, hoặc nhập thêm từ điển trong Cài đặt → Dữ liệu.
    </Notice>
  );
}

/** Vietnamese machine translation of one English definition (only for words without Vietnamese data). */
function MtDefinition({ text, s }: { text: string; s: Settings }) {
  const vi = useMt(text, s);
  if (!vi) return null;
  return <span className="mt-0.5 block text-[12.5px] text-muted" data-ml-def-mt="">→ {vi}</span>;
}

function EnglishDefinitions({ r, en, s, max, title }: { r: WordLookup; en: Sense[]; s: Settings; max: number; title: string }) {
  const translateDefs = s.reading.targetLanguage !== 'en';
  if (!en.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <ol className="space-y-1">
        {en.slice(0, max).map((x, i) => (
          <li key={i} className={cx('flex gap-2 text-[13px]', r.context?.bestSense === r.senses.indexOf(x) && 'rounded-md bg-accent/10 px-1.5 py-0.5 -mx-1.5')}>
            <span className="w-4 shrink-0 text-right text-subtle">{i + 1}.</span>
            <span className="min-w-0">
              {s.dictionary.showPos && <span className="mr-1 text-[11px] font-medium text-subtle">{POS_EN[x.pos]}</span>}
              <span className="text-text">{x.en}</span>
              {x.tags?.length ? <span className="ml-1.5 inline-flex gap-1 align-middle"><TagBadges tags={x.tags} /></span> : null}
              {translateDefs && x.en && <MtDefinition text={x.en} s={s} />}
            </span>
          </li>
        ))}
      </ol>
      {en.length > max && <div className="mt-1 text-[11.5px] text-subtle">+{en.length - max} nghĩa khác (mở Sidebar để xem đầy đủ)</div>}
    </>
  );
}

export function WordContextView({ r }: { r: WordLookup }) {
  const c = r.context;
  const best = c?.bestSense !== undefined ? r.senses[c.bestSense] : undefined;
  const viForPos = c?.likelyPos ? r.senses.find((x) => x.vi?.length && x.pos === c.likelyPos) : undefined;
  return (
    <div className="space-y-2.5">
      {c ? (
        <div className="ml-glass-card rounded-2xl p-2.5">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Nghĩa trong ngữ cảnh</span>
            <Badge tone={c.confidence === 'high' ? 'ok' : c.confidence === 'medium' ? 'accent' : 'warn'}>
              độ tin cậy: {c.confidence === 'high' ? 'cao' : c.confidence === 'medium' ? 'trung bình' : 'thấp'}
            </Badge>
            {c.likelyPos && <PosBadge pos={c.likelyPos} />}
          </div>
          <div className="text-[12.5px] italic text-muted">“{c.sentence}”</div>
          {viForPos && <div className="ml-tr mt-1.5 font-medium text-text">{viForPos.vi!.join('; ')}</div>}
          {best?.en && <div className="mt-1 text-[13px] text-text">{best.en}</div>}
          <div className="mt-1.5 text-[11px] text-subtle">{c.method}</div>
        </div>
      ) : (
        <Notice>Không có câu ngữ cảnh. Bôi đen cả câu hoặc click vào từ trong một câu để LingoLens chọn nghĩa phù hợp.</Notice>
      )}
      <NotesView notes={r.notes} />
      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <TagBadges tags={r.tags} />
        </div>
      )}
    </div>
  );
}

export function WordExamples({ r, s, onLookup }: { r: WordLookup; s: Settings; onLookup?: (t: string) => void }) {
  const examples = r.senses.flatMap((x) => (x.examples ?? []).map((e) => ({ e, pos: x.pos }))).slice(0, 8);
  const Phr = ({ items }: { items: { phrase: string; vi?: string }[] }) => (
    <ul className="space-y-0.5">
      {items.map((p) => (
        <li key={p.phrase} className="text-[13px]">
          <button type="button" className="ml-word font-medium text-accent" onClick={() => onLookup?.(p.phrase)}>
            {p.phrase}
          </button>
          {p.vi && <span className="text-muted"> — {p.vi}</span>}
        </li>
      ))}
    </ul>
  );
  const nothing = !examples.length && !r.phrasalVerbs.length && !r.idioms.length && !r.collocations.length && !r.synonyms.length;
  return (
    <div>
      {nothing && <Notice>Không có ví dụ hoặc cụm từ liên quan trong dữ liệu hiện có.</Notice>}
      {s.dictionary.showExamples && examples.length > 0 && (
        <>
          <SectionTitle>Ví dụ</SectionTitle>
          <ul className="space-y-1">
            {examples.map((x, i) => (
              <li key={i} className="ml-glass-card rounded-xl border-l-[3px] border-l-accent/50 px-2.5 py-1.5 text-[13px] italic text-text">
                {x.e}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.phrasalVerbs.length > 0 && (
        <>
          <SectionTitle>Cụm động từ</SectionTitle>
          <Phr items={r.phrasalVerbs} />
        </>
      )}
      {r.idioms.length > 0 && (
        <>
          <SectionTitle>Thành ngữ · cách diễn đạt</SectionTitle>
          <Phr items={r.idioms} />
        </>
      )}
      {s.dictionary.showCollocations && r.collocations.length > 0 && (
        <>
          <SectionTitle>Collocations · từ ghép</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {r.collocations.map((c) => (
              <button key={c} type="button" className="ml-chip hover:text-text" onClick={() => onLookup?.(c)}>
                {c}
              </button>
            ))}
          </div>
        </>
      )}
      {s.dictionary.showSynonyms && r.synonyms.length > 0 && (
        <>
          <SectionTitle>Đồng nghĩa</SectionTitle>
          <WordList words={r.synonyms} onLookup={onLookup} />
        </>
      )}
      {s.dictionary.showAntonyms && r.antonyms.length > 0 && (
        <>
          <SectionTitle>Trái nghĩa</SectionTitle>
          <WordList words={r.antonyms} onLookup={onLookup} />
        </>
      )}
    </div>
  );
}

function WordList({ words, onLookup }: { words: string[]; onLookup?: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-0.5 text-[13px]">
      {words.map((w, i) => (
        <span key={w}>
          <button type="button" className="ml-word text-text" onClick={() => onLookup?.(w)}>
            {w}
          </button>
          {i < words.length - 1 && <span className="text-subtle">,</span>}
        </span>
      ))}
    </div>
  );
}

export function WordGrammar({ r }: { r: WordLookup }) {
  return (
    <div>
      <InflectionLine r={r} />
      {r.posList.length > 0 && (
        <>
          <SectionTitle>Từ loại</SectionTitle>
          <div className="flex flex-wrap gap-1">{r.posList.map((p) => <PosBadge key={p} pos={p} />)}</div>
        </>
      )}
      {r.forms.length > 0 ? (
        <>
          <SectionTitle>Dạng từ</SectionTitle>
          <table className="w-full text-[13px]">
            <tbody>
              {r.forms.map((f) => (
                <tr key={f.label} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-3 text-muted">{f.label}</td>
                  <td className="py-1 font-medium text-text">{f.form}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-subtle">Dạng có quy tắc được sinh theo quy tắc chính tả tiếng Anh; dạng bất quy tắc lấy từ bảng động từ bất quy tắc.</div>
        </>
      ) : (
        <Notice>Không có thông tin biến đổi dạng từ cho mục này.</Notice>
      )}
    </div>
  );
}

const CHUNK_STYLE: Record<string, string> = {
  vi: 'border-border',
  'en-only': 'border-warn/50',
  none: 'border-danger/50 border-dashed',
  skip: 'border-transparent opacity-70',
};

/** Chunk-by-chunk view: each phrase/word with its meaning and data status. */
export function ChunksView({ chunks, onLookup }: { chunks: Chunk[]; onLookup?: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chunks
        .filter((c) => c.kind !== 'punct')
        .map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onLookup?.(c.kind === 'phrase' ? (c.lemma ?? c.text) : c.text)}
            title={c.status === 'none' ? 'Không có dữ liệu' : c.status === 'en-only' ? 'Chỉ có định nghĩa tiếng Anh' : c.source}
            className={cx('ml-focus ml-press max-w-full rounded-lg border bg-surface/50 px-1.5 py-1 text-left hover:bg-surface/90', CHUNK_STYLE[c.status], c.kind === 'phrase' && 'bg-accent/10')}
          >
            <div className={cx('text-[13px] font-medium', c.kind === 'phrase' ? 'text-accent' : 'text-text')}>{c.text}</div>
            <div className="max-w-[220px] truncate text-[11.5px] text-muted">
              {c.kind === 'name' ? 'tên riêng' : c.kind === 'number' ? 'số' : c.status === 'vi' ? c.vi : c.status === 'en-only' ? <span className="italic">{c.en}</span> : c.status === 'skip' ? 'trợ từ' : '—'}
            </div>
          </button>
        ))}
    </div>
  );
}

export function GlossBlock({ gloss, coverage }: { gloss: string; coverage: number }) {
  const pct = Math.round(coverage * 100);
  return (
    <div className="ml-glass-card rounded-2xl p-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Ghép nghĩa từng cụm</span>
        <Badge tone={pct >= 85 ? 'ok' : pct >= 50 ? 'accent' : 'warn'} title="Tỉ lệ từ/cụm có nghĩa tiếng Việt trong dữ liệu">
          {pct}% có nghĩa VI
        </Badge>
      </div>
      <div className="ml-tr text-text">{gloss}</div>
      <div className="mt-1.5 text-[11px] text-subtle">
        Dictionary Mode: ghép nghĩa theo thứ tự từ gốc, <b>không phải bản dịch tự nhiên</b>. [từ trong ngoặc] = chưa có nghĩa tiếng Việt.
      </div>
    </div>
  );
}

export function NotesView({ notes, empty }: { notes: ContextNote[]; empty?: ReactNode }) {
  if (!notes.length) return empty ? <>{empty}</> : null;
  const tone = (k: ContextNote['kind']) => (k === 'slang' ? 'warn' : k === 'idiom' || k === 'phrasal' || k === 'expression' ? 'accent' : 'neutral');
  return (
    <ul className="space-y-1.5">
      {notes.map((n, i) => (
        <li key={i} className="ml-glass-card rounded-xl px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tone(n.kind)}>{n.kind === 'tone' ? 'sắc thái' : n.kind === 'contraction' ? 'rút gọn' : (TAG_VI[n.kind] ?? n.kind)}</Badge>
            <span className="text-[13px] font-medium text-text">{n.title}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">{n.explanation}</div>
          {n.source === 'rules' && <div className="mt-0.5 text-[10.5px] text-subtle">suy ra theo quy tắc</div>}
        </li>
      ))}
    </ul>
  );
}

const TYPE_VI: Record<GrammarReport['sentenceType'], string> = {
  declarative: 'Câu trần thuật', 'yes-no-question': 'Câu hỏi Yes/No', 'wh-question': 'Câu hỏi Wh-', exclamatory: 'Câu cảm thán',
  imperative: 'Câu mệnh lệnh', fragment: 'Câu rút gọn',
};

export function GrammarView({ g, compact }: { g: GrammarReport; compact?: boolean }) {
  const roles: [string, string | undefined][] = [
    ['Chủ ngữ', g.roles.subject],
    ['Động từ', g.roles.verb],
    ['Tân ngữ', g.roles.object],
    ['Bổ ngữ', g.roles.complement],
  ];
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="accent">{TYPE_VI[g.sentenceType]}</Badge>
        {g.tense && <Badge>{g.tense.nameVi}</Badge>}
        {g.voice === 'passive' && <Badge tone="warn">Bị động</Badge>}
        {g.conditional && <Badge>Điều kiện {g.conditional.type !== 'unknown' ? `loại ${g.conditional.type}` : ''}</Badge>}
        {g.negated && <Badge>Phủ định</Badge>}
      </div>
      {roles.some(([, v]) => v) && (
        <table className="w-full text-[13px]">
          <tbody>
            {roles.filter(([, v]) => v).map(([k, v]) => (
              <tr key={k} className="border-b border-border/60 last:border-0">
                <td className="w-24 py-1 pr-2 text-muted">{k}</td>
                <td className="py-1 font-medium text-text">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {g.clauses.length > 1 && (
        <div>
          <SectionTitle>Mệnh đề</SectionTitle>
          <ol className="space-y-1">
            {g.clauses.map((c, i) => (
              <li key={i} className="text-[13px]">
                <Badge>{c.type === 'main' ? 'chính' : c.type === 'relative' ? 'quan hệ' : c.type === 'conditional' ? 'điều kiện' : c.type === 'coordinate' ? 'đẳng lập' : 'phụ'}</Badge>{' '}
                <span className="text-text">{c.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div>
        <SectionTitle>Điểm ngữ pháp</SectionTitle>
        {g.features.length ? (
          <ul className="space-y-1.5">
            {g.features.map((f) => (
              <li key={f.id} className="text-[13px]">
                <div className="font-medium text-text">{f.title}</div>
                <div className="text-[12.5px] text-muted">{f.explanation}</div>
                {f.evidence && <div className="text-[11.5px] text-subtle">dấu hiệu: “{f.evidence}”</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[12.5px] text-muted">Không phát hiện cấu trúc đặc biệt.</div>
        )}
      </div>
      {!compact && g.tags.length > 0 && (
        <div>
          <SectionTitle>Từ loại trong câu</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {g.tags.map((t, i) => (
              <span key={i} className="rounded-full bg-text/[0.06] px-2 py-0.5 text-[12px] ring-1 ring-inset ring-border/70">
                <span className="text-text">{t.text}</span> <span className="text-[10.5px] text-subtle">{t.tag}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="text-[11px] text-subtle">{g.disclaimer}</div>
    </div>
  );
}

export function VocabHints({ items, onLookup, onSave, saved, s }: { items: VocabHint[]; onLookup?: (t: string) => void; onSave?: (v: VocabHint) => void; saved?: Set<string>; s?: Settings }) {
  if (!items.length) return <Notice>Không phát hiện từ khó trong đoạn này (theo danh sách từ phổ biến của bộ Starter).</Notice>;
  return (
    <ul className="divide-y divide-border/60">
      {items.map((v) => (
        <VocabRow key={v.lemma} v={v} s={s} onLookup={onLookup} onSave={onSave} saved={saved} />
      ))}
    </ul>
  );
}

/** One word of the vocabulary list: the dictionary meaning first; the on-device machine translation fills the gaps and cross-checks. */
function VocabRow({ v, s, onLookup, onSave, saved }: { v: VocabHint; s?: Settings; onLookup?: (t: string) => void; onSave?: (v: VocabHint) => void; saved?: Set<string> }) {
  // lower case: a capitalised lone word reads like an exclamation to the translator ("You" → "Mày!")
  const asked = s ? v.word.toLowerCase() : undefined;
  const mt = useMt(asked, s ?? ({ reading: { translationMode: 'dictionary' } } as Settings));
  const mtVi = asked && mt && mt.trim().toLowerCase() !== asked ? mt.charAt(0).toLowerCase() + mt.slice(1) : undefined;
  const vi = v.vi ?? mtVi;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <button type="button" className="ml-word text-[13px] font-medium text-text" onClick={() => onLookup?.(v.pos === 'phrase' ? v.lemma : v.word)}>
          {v.word}
        </button>
        {v.lemma !== v.word.toLowerCase() && <span className="text-[11.5px] text-subtle"> ({v.lemma})</span>}
        <div className="text-[12.5px] text-muted">
          {vi ? (
            <>
              {vi}
              {!v.vi && <span className="ml-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">dịch máy</span>}
              {mtVi && v.vi && !v.vi.toLowerCase().includes(mtVi.trim().toLowerCase()) && <div className="text-[11.5px] text-subtle">Dịch máy: {mtVi}</div>}
            </>
          ) : asked && mt === undefined ? (
            <span className="inline-flex items-center gap-1.5"><Spinner /> Đang dịch…</span>
          ) : v.en ? (
            <i className="line-clamp-2">{v.en}</i>
          ) : (
            'chưa có nghĩa'
          )}
        </div>
        <div className="text-[10.5px] text-subtle">{v.reason}</div>
      </div>
      {onSave && (
        <button
          type="button"
          disabled={saved?.has(v.lemma)}
          onClick={() => onSave({ ...v, vi })}
          className="ml-focus shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] text-accent hover:bg-accent/10 disabled:text-subtle"
        >
          {saved?.has(v.lemma) ? 'đã lưu' : '+ lưu'}
        </button>
      )}
    </li>
  );
}

/** Best one-line meaning for saving/compact display. */
export function primaryMeaning(r: WordLookup): string {
  const ctxPos = r.context?.likelyPos;
  const vi = (ctxPos && r.senses.find((s) => s.vi?.length && s.pos === ctxPos)) || r.senses.find((s) => s.vi?.length);
  if (vi) return vi.vi!.slice(0, 3).join('; ');
  const best = r.context?.bestSense !== undefined ? r.senses[r.context.bestSense] : r.senses.find((s) => s.en);
  return best?.en ?? '';
}
