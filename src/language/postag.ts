/**
 * Rule-based part-of-speech tagger. Closed-class lists decide first; open-class words use the
 * dictionary's POS inventory (WordNet + curated data) plus morphology and local context rules.
 * It is deliberately simple and deterministic: every tag can be explained by a rule.
 */
import type { Pos } from '@/shared/types';
import { isPastForm, isPastParticiple } from './irregular';
import {
  ADVERBS, BE_FORMS, COORDINATORS, DETERMINERS, DO_FORMS, expandContraction, HAVE_FORMS, INTERJECTIONS,
  MODALS, NEGATIONS, NUMBERS, PARTICLES, POSSESSIVE_DETERMINERS, PREPOSITIONS, PRONOUNS, SUBORDINATORS,
  WH_WORDS,
} from './lexicon';
import { isMostlyUpper, normalizeWord, tokenize, type Token } from './tokenize';

export type Tag =
  | 'PRON' | 'DET' | 'NOUN' | 'PROPN' | 'VERB' | 'AUX' | 'MODAL' | 'ADJ' | 'ADV' | 'ADP' | 'CCONJ'
  | 'SCONJ' | 'PART' | 'NEG' | 'NUM' | 'INTJ' | 'WH' | 'PUNCT' | 'X';

export type VerbForm = 'base' | 'past' | 'pp' | 'ing' | '3sg' | '';

export interface Tagged {
  /** Text shown for this unit (contraction parts reuse the original token's span). */
  text: string;
  norm: string;
  start: number;
  end: number;
  tag: Tag;
  form: VerbForm;
  /** Original token text when this unit comes from a contraction expansion. */
  from?: string;
  informal?: boolean;
}

/** POS inventory of a word according to the loaded dictionaries (synchronous after prefetch). */
export type PosLexicon = (word: string) => Set<Pos>;

export const TAG_LABEL_VI: Record<Tag, string> = {
  PRON: 'đại từ', DET: 'hạn định từ', NOUN: 'danh từ', PROPN: 'danh từ riêng', VERB: 'động từ', AUX: 'trợ động từ',
  MODAL: 'động từ khuyết thiếu', ADJ: 'tính từ', ADV: 'trạng từ', ADP: 'giới từ', CCONJ: 'liên từ kết hợp',
  SCONJ: 'liên từ phụ thuộc', PART: 'tiểu từ', NEG: 'phủ định', NUM: 'số', INTJ: 'thán từ', WH: 'từ để hỏi',
  PUNCT: 'dấu câu', X: 'chưa rõ',
};

const STRONG_PARTICLES = new Set(['up', 'down', 'out', 'off', 'away', 'back']);
const STRICT_ADVERBS = new Set([
  'very', 'really', 'too', 'quite', 'rather', 'just', 'only', 'also', 'even', 'still', 'already', 'always', 'never',
  'often', 'sometimes', 'usually', 'here', 'there', 'now', 'then', 'soon', 'later', 'maybe', 'perhaps', 'probably',
  'definitely', 'actually', 'literally', 'seriously', 'totally', 'almost', 'nearly', 'ever', 'again', 'together',
  'alone', 'anyway', 'somehow', 'anymore', 'ago', 'instead', 'today', 'tomorrow', 'tonight', 'yesterday',
]);
// irregular verbs whose past form equals the base form ("Let me go!", "Put it down.")
const SAME_FORM_VERBS = new Set(['let', 'put', 'cut', 'set', 'hit', 'read', 'shut', 'hurt', 'quit', 'spread', 'beat', 'cast', 'burst', 'run', 'come', 'become']);
// words that, right after a sentence-initial verb/noun word, mean it is a command ("Look at…", "Wait for…")
const IMPERATIVE_NEXT = new Set(['me', 'him', 'her', 'them', 'us', 'it', 'at', 'for']);
const CLAUSE_WH = new Set(['when', 'where', 'whenever', 'wherever', 'while']);

function verbForm(w: string): VerbForm {
  if (w.endsWith('ing') && w.length > 4) return 'ing';
  if (isPastParticiple(w) && !isPastForm(w)) return 'pp';
  if (isPastForm(w)) return 'past';
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return '3sg';
  return 'base';
}

interface Unit {
  text: string;
  norm: string;
  start: number;
  end: number;
  type: Token['type'];
  from?: string;
  informal?: boolean;
  capitalized: boolean;
  sentenceStart: boolean;
}

export function toUnits(text: string): Unit[] {
  const toks = tokenize(text).filter((t) => t.type !== 'space');
  const upper = isMostlyUpper(text);
  const units: Unit[] = [];
  let atStart = true;
  for (const t of toks) {
    if (t.type === 'punct') {
      units.push({ text: t.text, norm: t.text, start: t.start, end: t.end, type: 'punct', capitalized: false, sentenceStart: false });
      if (/[.!?…]/.test(t.text)) atStart = true;
      continue;
    }
    const norm = normalizeWord(t.text);
    const cap = !upper && /^\p{Lu}/u.test(t.text);
    const exp = t.type === 'word' ? expandContraction(norm) : null;
    if (exp) {
      exp.parts.forEach((p, i) =>
        units.push({
          text: i === 0 ? t.text : p, norm: p, start: t.start, end: t.end, type: 'word', from: t.text,
          informal: exp.informal, capitalized: cap && i === 0, sentenceStart: atStart && i === 0,
        }),
      );
    } else {
      units.push({ text: t.text, norm, start: t.start, end: t.end, type: t.type, capitalized: cap, sentenceStart: atStart });
    }
    atStart = false;
  }
  return units;
}

function closedClass(u: Unit, next: Unit | undefined): Tag | null {
  const w = u.norm;
  if (u.type === 'punct') return 'PUNCT';
  if (u.type === 'num' || NUMBERS.has(w)) return w === 'one' ? null : 'NUM';
  if (w === 'not' || w === "n't" || w === 'never') return 'NEG';
  if (MODALS.has(w)) return 'MODAL';
  if (WH_WORDS.has(w) && w !== 'that') return 'WH';
  if (INTERJECTIONS.has(w) && !(w === 'well' && next?.type === 'word') && !(w === 'right' && next?.type === 'word')) return 'INTJ';
  if (w === 'to') return null; // decided in context
  if (w === 'that') return null;
  if (COORDINATORS.has(w) && w !== 'so' && w !== 'yet') return 'CCONJ';
  if (BE_FORMS.has(w) || HAVE_FORMS.has(w) || DO_FORMS.has(w)) return null; // AUX vs VERB in context
  if (POSSESSIVE_DETERMINERS.has(w)) return w === 'her' && (!next || next.type !== 'word') ? 'PRON' : 'DET';
  if (['a', 'an', 'the', 'every', 'each', 'no', 'another'].includes(w)) return 'DET';
  if (PRONOUNS.has(w) && !DETERMINERS.has(w)) return 'PRON';
  if (SUBORDINATORS.has(w) && !PREPOSITIONS.has(w) && w !== 'so') return 'SCONJ';
  return null;
}

/** Tags a sentence. `lexicon` returns the dictionary POS set for a (lemmatised) word. */
export function tagSentence(text: string, lexicon: PosLexicon): Tagged[] {
  const units = toUnits(text);
  const isQuestion = /\?/.test(text);
  const out: Tagged[] = [];
  const tagAt = (i: number) => out[i]?.tag;

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const next = units[i + 1];
    const prevTag = tagAt(i - 1);
    const prevNorm = units[i - 1]?.norm;
    const w = u.norm;
    let tag = closedClass(u, next);
    let form: VerbForm = '';
    // "When I came home, …" – wh-word introducing a clause in a non-question
    if (tag === 'WH' && CLAUSE_WH.has(w) && !isQuestion) tag = 'SCONJ';
    // Relative pronoun after a noun: "the man who saved me"
    if (tag === 'WH' && i > 0 && ['who', 'whom', 'whose', 'which'].includes(w) && ['NOUN', 'PROPN', 'PRON'].includes(prevTag ?? '')) tag = 'PRON';

    if (!tag) {
      const pos = lexicon(w);
      const nextPos = next && next.type === 'word' ? lexicon(next.norm) : new Set<Pos>();
      const nextIsVerbish = !!next && (nextPos.has('verb') || BE_FORMS.has(next.norm) || HAVE_FORMS.has(next.norm));

      if (w === 'to') {
        tag = next && nextPos.has('verb') && !DETERMINERS.has(next.norm) && !PRONOUNS.has(next.norm) ? 'PART' : 'ADP';
      } else if (w === 'that') {
        if (prevTag === 'VERB' || prevTag === 'ADJ') tag = 'SCONJ';
        else if (next && (nextPos.has('noun') || nextPos.has('adj')) && !nextIsVerbish) tag = 'DET';
        else tag = 'PRON';
      } else if (BE_FORMS.has(w) || HAVE_FORMS.has(w) || DO_FORMS.has(w)) {
        // Auxiliary if a verb (possibly after adverbs / negation / subject in questions) follows.
        let j = i + 1;
        while (j < units.length && (ADVERBS.has(units[j].norm) || units[j].norm === 'not' || units[j].norm === 'never')) j++;
        const look = units[j];
        const lookAfterSubject = units[j + 1];
        const isVerbLike = (x?: Unit) =>
          !!x && x.type === 'word' && (verbForm(x.norm) === 'ing' || ((verbForm(x.norm) === 'pp' || verbForm(x.norm) === 'past') && lexicon(x.norm).has('verb')) || (DO_FORMS.has(w) && lexicon(x.norm).has('verb') && !DETERMINERS.has(x.norm)));
        if (isVerbLike(look) || (look && PRONOUNS.has(look.norm) && isVerbLike(lookAfterSubject))) tag = 'AUX';
        else if ((HAVE_FORMS.has(w) || DO_FORMS.has(w)) && look?.norm === 'to') tag = 'VERB';
        else tag = 'VERB';
        form = w === 'being' || w === 'having' || w === 'doing' ? 'ing' : ['was', 'were', 'had', 'did'].includes(w) ? 'past' : w === 'been' || w === 'done' ? 'pp' : ['is', 'has', 'does'].includes(w) ? '3sg' : 'base';
      } else if (
        PARTICLES.has(w) && prevTag === 'VERB' &&
        (!next || next.type === 'punct' || (STRONG_PARTICLES.has(w) && (DETERMINERS.has(next.norm) || PRONOUNS.has(next.norm))))
      ) {
        tag = 'PART';
      } else if (STRICT_ADVERBS.has(w)) {
        tag = 'ADV';
      } else if (PREPOSITIONS.has(w)) {
        tag = 'ADP';
      } else if (DETERMINERS.has(w)) {
        tag = next && next.type === 'word' && !nextIsVerbish && !PREPOSITIONS.has(next.norm) ? 'DET' : 'PRON';
      } else if (u.capitalized && !u.sentenceStart && pos.size === 0) {
        tag = 'PROPN';
      } else if (u.capitalized && !u.sentenceStart && !pos.has('verb') && !pos.has('adj') && /^\p{Lu}\p{Ll}/u.test(u.text) && pos.size <= 1) {
        tag = 'PROPN';
      } else {
        const vf = verbForm(w);
        const canVerb = pos.has('verb');
        const canNoun = pos.has('noun');
        const canAdj = pos.has('adj');
        const canAdv = pos.has('adv') || ADVERBS.has(w);
        const afterDet = prevTag === 'DET' || prevTag === 'ADJ' || prevTag === 'NUM' || (prevTag === 'PRON' && POSSESSIVE_DETERMINERS.has(prevNorm ?? ''));
        const afterVerbTrigger = prevTag === 'MODAL' || prevTag === 'PART' || (prevTag === 'AUX' && DO_FORMS.has(prevNorm ?? '')) || (prevTag === 'NEG' && (tagAt(i - 2) === 'MODAL' || (tagAt(i - 2) === 'AUX' && DO_FORMS.has(units[i - 2]?.norm ?? ''))));
        const afterSubject = prevTag === 'PRON' && !POSSESSIVE_DETERMINERS.has(prevNorm ?? '');
        const afterBe = prevTag === 'AUX' || (prevTag === 'NEG' && tagAt(i - 2) === 'AUX');
        const afterBeVerb = (prevTag === 'VERB' && BE_FORMS.has(prevNorm ?? '')) || (prevTag === 'ADV' && BE_FORMS.has(units[i - 2]?.norm ?? ''));

        if (afterVerbTrigger && (canVerb || pos.size === 0)) {
          tag = 'VERB';
          form = 'base';
        } else if (afterBe && (vf === 'ing' || vf === 'pp' || vf === 'past') && (canVerb || pos.size === 0)) {
          tag = 'VERB';
          form = vf === 'past' ? 'pp' : vf;
        } else if (afterDet) {
          if (canAdj && next && next.type === 'word' && (lexicon(next.norm).has('noun') || verbForm(next.norm) === 'ing') && !canNoun) tag = 'ADJ';
          else if (canAdj && !canNoun) tag = 'ADJ';
          else if (canAdj && canNoun && next && next.type === 'word' && lexicon(next.norm).has('noun') && !nextIsVerbish) tag = 'ADJ';
          else tag = canNoun || pos.size === 0 ? 'NOUN' : canAdj ? 'ADJ' : canVerb && vf === 'ing' ? 'NOUN' : 'NOUN';
        } else if (afterBeVerb && canAdj) {
          tag = 'ADJ';
        } else if (w.endsWith('ly') && w.length > 4 && (canAdv || !canNoun)) {
          tag = 'ADV';
        } else if (canAdv && !canVerb && !canNoun && !canAdj) {
          tag = 'ADV';
        } else if (u.sentenceStart && canVerb && (vf === 'base' || SAME_FORM_VERBS.has(w)) && next && (next.type === 'punct' ? next.text === '!' : IMPERATIVE_NEXT.has(next.norm) || next.norm === 'being' || PARTICLES.has(next.norm) || STRICT_ADVERBS.has(next.norm))) {
          // "Go now!" "Stop being a coward." "Run away!" "Help!" – command, not a noun
          tag = 'VERB';
          form = 'base';
        } else if (u.sentenceStart && canVerb && vf === 'base' && !canNoun) {
          tag = 'VERB';
          form = 'base';
        } else if (u.sentenceStart && canVerb && vf === 'base' && next && (PRONOUNS.has(next.norm) || DETERMINERS.has(next.norm) || PREPOSITIONS.has(next.norm))) {
          tag = 'VERB';
          form = 'base';
        } else if ((afterSubject || prevTag === 'PROPN' || prevTag === 'NOUN') && canVerb && (vf !== 'base' || prevTag === 'PRON')) {
          tag = 'VERB';
          form = vf;
        } else if (prevTag === 'VERB' && canAdj && !canNoun) {
          tag = 'ADJ';
        } else if (canNoun) {
          tag = 'NOUN';
        } else if (canVerb) {
          tag = 'VERB';
          form = vf;
        } else if (canAdj) {
          tag = 'ADJ';
        } else if (canAdv) {
          tag = 'ADV';
        } else if (pos.has('interj')) {
          tag = 'INTJ';
        } else if (pos.has('pron')) {
          tag = 'PRON';
        } else if (pos.has('prep')) {
          tag = 'ADP';
        } else if (pos.has('conj')) {
          tag = 'CCONJ';
        } else {
          tag = 'X';
        }
        if (tag === 'VERB' && !form) form = vf;
      }
    }
    if (tag === 'AUX' && !form) form = 'base';
    if (NEGATIONS.has(w) && tag !== 'NEG' && ['nobody', 'nothing', 'none', 'nowhere'].includes(w)) tag = 'PRON';
    out.push({ text: u.text, norm: w, start: u.start, end: u.end, tag, form, from: u.from, informal: u.informal });
  }
  return out;
}
