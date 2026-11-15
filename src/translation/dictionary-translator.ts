/**
 * Dictionary Mode translation: phrase-first chunking + per-chunk dictionary meanings + rule-based
 * grammar. It never invents a fluent sentence: the "gloss" is an explicit chunk-by-chunk
 * composition, and every chunk records whether its meaning is Vietnamese data, English-only or
 * missing.
 */
import type { Chunk, ParagraphAnalysis, Pos, SentenceAnalysis, SourceInfo, VocabHint } from '@/shared/types';
import { tokenize, normalizeWord } from '@/language/tokenize';
import { tagSentence, type Tag, type Tagged } from '@/language/postag';
import { analyzeGrammar } from '@/language/grammar';
import { splitSentences } from '@/language/segment';
import { detectLanguage } from '@/language/detect';
import type { DictionaryEngine } from '@/dictionary/engine';
import { SOURCES, type StarterProvider } from '@/dictionary/providers';
import { phraseCandidates, matchPhrases } from './phrase-matcher';
import { toneNotes } from './explain';
import type { TranslationProvider } from './types';

const TAG_POS: Partial<Record<Tag, Pos>> = { NOUN: 'noun', VERB: 'verb', AUX: 'verb', ADJ: 'adj', ADV: 'adv', PRON: 'pron', DET: 'det', ADP: 'prep', CCONJ: 'conj', SCONJ: 'conj', MODAL: 'modal', INTJ: 'interj', PART: 'part' };
const CONTENT: Tag[] = ['NOUN', 'VERB', 'ADJ', 'ADV'];
const MAX_SENTENCE_CHARS = 1200;
export const GLOSS_LABEL = 'Ghép nghĩa từng cụm (Dictionary Mode) – không phải bản dịch tự nhiên';
const SKIP = '\u0000skip';

/**
 * Vietnamese rendering of an auxiliary by its grammatical role (rule-based):
 * be + V-ing → "đang", be + V3 → "bị/được", have + V3 → "đã", do-support → omitted.
 */
function auxiliaryGloss(t: Tagged, tagged: Tagged[]): string | undefined {
  let i = tagged.indexOf(t) + 1;
  while (i < tagged.length && (tagged[i].tag === 'ADV' || tagged[i].tag === 'NEG' || tagged[i].tag === 'PRON')) i++;
  const next = tagged[i];
  const w = t.norm;
  if (['do', 'does', 'did'].includes(w)) return w === 'did' ? 'đã' : SKIP;
  if (!next) return undefined;
  const isBe = ['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being'].includes(w);
  const isHave = ['have', 'has', 'had', 'having'].includes(w);
  if (isBe && next.form === 'ing') return w === 'been' ? SKIP : 'đang';
  if (isBe && (next.form === 'pp' || next.form === 'past')) return 'bị/được';
  if (isHave && (next.form === 'pp' || next.form === 'past' || next.norm === 'been')) return 'đã';
  return undefined;
}

export class DictionaryModeTranslator implements TranslationProvider {
  readonly id = 'dictionary';
  readonly name = 'Dictionary Mode (offline)';
  readonly kind = 'dictionary' as const;

  constructor(
    private engine: DictionaryEngine,
    private starter: StarterProvider,
  ) {}

  /** Chunks + tags for a span of text (shared by phrase and sentence modes). */
  async chunk(text: string): Promise<{ chunks: Chunk[]; tagged: Tagged[] }> {
    const tokens = tokenize(text);
    const { words, candidates } = phraseCandidates(tokens);
    await this.engine.prepare(words.map((w) => w.text), [...new Set(candidates.flatMap((c) => c.strings))]);
    await this.starter.ready();
    const tagged = tagSentence(text, this.engine.posOf);
    const matches = matchPhrases(candidates, (s) => !!this.engine.peekPhrase(s));
    const tagAtStart = new Map<number, Tagged>();
    for (const t of tagged) if (!tagAtStart.has(t.start)) tagAtStart.set(t.start, t);

    const chunks: Chunk[] = [];
    const glossJobs: Promise<void>[] = [];
    let mi = 0;
    for (let wi = 0, ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti];
      if (tok.type === 'space') continue;
      if (tok.type === 'punct') {
        chunks.push({ text: tok.text, start: tok.start, end: tok.end, kind: 'punct', status: 'skip' });
        continue;
      }
      if (tok.type === 'num') {
        chunks.push({ text: tok.text, start: tok.start, end: tok.end, kind: 'number', status: 'skip' });
        continue;
      }
      const m = matches[mi];
      if (m && m.from === wi) {
        const first = words[m.from];
        const last = words[m.to];
        const entry = this.engine.peekPhrase(m.phrase)!;
        const viSense = entry.senses.find((s) => s.vi?.length);
        const curated = this.starter.peek(m.phrase);
        const chunk: Chunk = {
          text: text.slice(first.start, last.end),
          start: first.start,
          end: last.end,
          kind: 'phrase',
          lemma: m.phrase,
          pos: 'phrase',
          vi: viSense?.vi?.slice(0, 2).join(', '),
          status: viSense ? 'vi' : 'en-only',
          phraseType: curated?.phraseType ?? (entry.senses.some((s) => s.pos === 'verb') ? (m.separable || m.phrase.split(' ').length <= 3 ? 'phrasal' : 'idiom') : 'expression'),
          note: [curated?.explanation, m.separable ? `Cụm động từ tách rời: "${m.phrase}" có tân ngữ chen giữa.` : ''].filter(Boolean).join(' ') || undefined,
          source: viSense?.source ?? 'wordnet',
        };
        if (!viSense) glossJobs.push(this.engine.firstGloss(m.phrase).then((g) => void (chunk.en = g, chunk.status = g ? 'en-only' : 'none')));
        chunks.push(chunk);
        // skip the tokens covered by the phrase
        while (ti + 1 < tokens.length && tokens[ti + 1].end <= last.end) ti++;
        wi = m.to + 1;
        mi++;
        continue;
      }
      const t = tagAtStart.get(tok.start);
      const tag = t?.tag ?? 'X';
      const pos = TAG_POS[tag];
      if (tag === 'PROPN') {
        chunks.push({ text: tok.text, start: tok.start, end: tok.end, kind: 'name', lemma: tok.text, status: 'skip' });
        wi++;
        continue;
      }
      const lemma = this.engine.resolveLemma(tok.text, pos);
      const auxVi = tag === 'AUX' && t && !t.from ? auxiliaryGloss(t, tagged) : undefined;
      const vi = auxVi ? { vi: auxVi, source: 'rules' } : this.engine.viFor(tok.text, pos) ?? this.engine.peekVi(lemma, pos);
      const chunk: Chunk = {
        text: tok.text, start: tok.start, end: tok.end, kind: 'word', lemma, pos,
        status: auxVi === SKIP ? 'skip' : vi ? 'vi' : 'none', vi: auxVi === SKIP ? '(trợ động từ)' : vi?.vi, source: vi?.source,
      };
      if (!vi) {
        glossJobs.push(
          this.engine.firstGloss(lemma, pos).then((g) => {
            if (g) {
              chunk.en = g;
              chunk.status = 'en-only';
              chunk.source = 'wordnet';
            }
          }),
        );
      }
      chunks.push(chunk);
      while (matches[mi] && matches[mi].from < wi) mi++;
      wi++;
    }
    await Promise.all(glossJobs);
    return { chunks, tagged };
  }

  static gloss(chunks: Chunk[]): string {
    let out = '';
    for (const c of chunks) {
      let piece: string;
      if (c.kind === 'punct') piece = c.text;
      else if (c.kind === 'name' || c.kind === 'number') piece = c.text;
      else if (c.status === 'skip') continue;
      else if (c.status === 'vi' && c.vi) {
        // Grammatical markers ("(mạo từ – thường không dịch)") are omitted from the composition.
        if (c.vi.startsWith('(')) continue;
        piece = c.vi.replace(/\s*\([^)]*\)/g, '').split(/[,;]/)[0].trim();
        if (!piece) continue;
      } else piece = `[${c.text}]`;
      out += c.kind === 'punct' && !/^[(“"‘'[]$/.test(c.text) ? piece : ` ${piece}`;
    }
    return out.trim().replace(/\s+([,.!?…:;])/g, '$1');
  }

  static coverage(chunks: Chunk[]): number {
    const lex = chunks.filter((c) => (c.kind === 'word' || c.kind === 'phrase') && c.status !== 'skip');
    if (!lex.length) return 1;
    return Math.round((lex.filter((c) => c.status === 'vi').length / lex.length) * 100) / 100;
  }

  private vocabulary(chunks: Chunk[], tagged: Tagged[]): VocabHint[] {
    const out: VocabHint[] = [];
    const seen = new Set<string>();
    const tagAt = new Map(tagged.map((t) => [t.start, t.tag]));
    for (const c of chunks) {
      if (c.kind === 'phrase' && c.lemma && !seen.has(c.lemma)) {
        seen.add(c.lemma);
        out.push({ word: c.text, lemma: c.lemma, vi: c.vi, en: c.en, pos: 'phrase', reason: c.phraseType === 'phrasal' ? 'Cụm động từ' : c.phraseType === 'slang' ? 'Tiếng lóng' : c.phraseType === 'idiom' ? 'Thành ngữ' : 'Cụm cố định' });
        continue;
      }
      if (c.kind !== 'word' || !c.lemma || seen.has(c.lemma)) continue;
      const tag = tagAt.get(c.start);
      if (!tag || !CONTENT.includes(tag)) continue;
      const inStarter = !!this.starter.peek(c.lemma) || !!this.starter.peek(normalizeWord(c.text));
      if (inStarter && c.lemma.length < 9) continue;
      if (c.status === 'none' && c.lemma.length < 4) continue;
      seen.add(c.lemma);
      out.push({ word: c.text, lemma: c.lemma, vi: c.vi, en: c.en, pos: c.pos, reason: inStarter ? 'Từ dài / ít gặp' : 'Ngoài danh sách từ phổ biến (Starter)' });
    }
    return out.slice(0, 16);
  }

  private sources(chunks: Chunk[]): SourceInfo[] {
    const used = new Set(chunks.map((c) => c.source).filter(Boolean) as string[]);
    used.add('rules');
    return [...this.engine.sources, SOURCES.rules].filter((s, i, a) => used.has(s.id) && a.findIndex((x) => x.id === s.id) === i);
  }

  async translateSentence(input: string): Promise<SentenceAnalysis> {
    const text = input.replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE_CHARS);
    const { chunks, tagged } = await this.chunk(text);
    return {
      kind: 'sentence',
      text,
      language: detectLanguage(text),
      chunks,
      gloss: DictionaryModeTranslator.gloss(chunks),
      coverage: DictionaryModeTranslator.coverage(chunks),
      grammar: analyzeGrammar(text, tagged),
      notes: toneNotes(text, tagged, chunks),
      vocabulary: this.vocabulary(chunks, tagged),
      sources: this.sources(chunks),
    };
  }

  async translateParagraph(input: string, maxSentences = 40): Promise<ParagraphAnalysis> {
    const text = input.trim();
    const segs = splitSentences(text).slice(0, maxSentences);
    const sentences: SentenceAnalysis[] = [];
    for (const s of segs) sentences.push(await this.translateSentence(s.text));
    const vocab = new Map<string, VocabHint>();
    for (const s of sentences) for (const v of s.vocabulary) if (!vocab.has(v.lemma)) vocab.set(v.lemma, v);
    const notes = sentences.flatMap((s) => s.notes).filter((n, i, a) => a.findIndex((x) => x.title === n.title && x.text === n.text) === i);
    const total = sentences.reduce((n, s) => n + s.chunks.filter((c) => c.kind === 'word' || c.kind === 'phrase').length, 0);
    const covered = sentences.reduce((n, s) => n + s.chunks.filter((c) => (c.kind === 'word' || c.kind === 'phrase') && c.status === 'vi').length, 0);
    return {
      kind: 'paragraph',
      text,
      language: detectLanguage(text),
      sentences,
      vocabulary: [...vocab.values()].slice(0, 30),
      notes,
      coverage: total ? Math.round((covered / total) * 100) / 100 : 1,
      sources: sentences.flatMap((s) => s.sources).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
    };
  }
}
