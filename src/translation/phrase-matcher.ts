/**
 * Longest-match phrase detection over word tokens. Candidate strings are generated first (pure),
 * so the caller can prefetch dictionary data, then matched synchronously.
 * Handles inflected heads ("gave up" → give up), possessive placeholders ("lost my mind" →
 * lose one's mind), reflexives ("pull yourself together" → pull oneself together) and separable
 * phrasal verbs ("pick it up" → pick up).
 */
import { lemmaCandidates } from '@/language/morphology';
import { normalizeWord, type Token } from '@/language/tokenize';

const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);
const REFLEXIVES = new Set(['myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves']);
const OBJECT_PRONOUNS = new Set(['it', 'him', 'her', 'them', 'me', 'us', 'you', 'this', 'that', 'these', 'those', 'everything', 'something']);
const PARTICLES = new Set(['up', 'down', 'out', 'off', 'in', 'on', 'away', 'back', 'over', 'around', 'through', 'together', 'apart']);
const DETS = new Set(['the', 'a', 'an', 'this', 'that', 'my', 'your', 'his', 'her', 'our', 'their']);

export interface WordTok {
  text: string;
  norm: string;
  start: number;
  end: number;
  /** Index in the full token array. */
  ti: number;
}

export interface PhraseCandidate {
  /** Word-token index range [from, to] (inclusive). */
  from: number;
  to: number;
  strings: string[];
  separable?: boolean;
}

export interface PhraseMatch {
  from: number;
  to: number;
  phrase: string;
  separable: boolean;
}

/** Word tokens grouped into runs that are not interrupted by sentence/clause punctuation. */
export function wordTokens(tokens: Token[]): WordTok[] {
  const out: WordTok[] = [];
  tokens.forEach((t, ti) => {
    if (t.type === 'word') out.push({ text: t.text, norm: normalizeWord(t.text), start: t.start, end: t.end, ti });
  });
  return out;
}

function interrupted(tokens: Token[], a: WordTok, b: WordTok): boolean {
  for (let k = a.ti + 1; k < b.ti; k++) if (tokens[k].type === 'punct' && !/['’-]/.test(tokens[k].text)) return true;
  return false;
}

function variants(words: string[]): string[] {
  const base = words.join(' ');
  const out = new Set<string>([base]);
  const heads = lemmaCandidates(words[0])
    .filter((c) => c.pos === 'verb' || c.pos === 'any' || c.rule.startsWith('irregular') || c.rule === 'auxiliary form')
    .map((c) => c.lemma);
  const tails = [words.slice(1)];
  const generic = words.slice(1).map((w) => (POSSESSIVES.has(w) ? "one's" : REFLEXIVES.has(w) ? 'oneself' : w));
  if (generic.join(' ') !== words.slice(1).join(' ')) tails.push(generic);
  for (const h of heads) for (const t of tails) out.add([h, ...t].join(' '));
  return [...out];
}

export function phraseCandidates(tokens: Token[], maxLen = 6): { words: WordTok[]; candidates: PhraseCandidate[] } {
  const words = wordTokens(tokens);
  const candidates: PhraseCandidate[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let len = Math.min(maxLen, words.length - i); len >= 2; len--) {
      const span = words.slice(i, i + len);
      let broken = false;
      for (let k = 1; k < span.length; k++) if (interrupted(tokens, span[k - 1], span[k])) broken = true;
      if (broken) continue;
      candidates.push({ from: i, to: i + len - 1, strings: variants(span.map((w) => w.norm)) });
    }
    // separable phrasal verbs: V + (PRON | DET N) + PARTICLE
    for (const gap of [1, 2]) {
      const end = i + gap + 1;
      if (end >= words.length) continue;
      const mid = words.slice(i + 1, end);
      const part = words[end];
      if (!PARTICLES.has(part.norm)) continue;
      const okMid = gap === 1 ? OBJECT_PRONOUNS.has(mid[0].norm) : DETS.has(mid[0].norm);
      if (!okMid) continue;
      let broken = false;
      for (let k = i + 1; k <= end; k++) if (interrupted(tokens, words[k - 1], words[k])) broken = true;
      if (broken) continue;
      candidates.push({ from: i, to: end, strings: variants([words[i].norm, part.norm]), separable: true });
    }
  }
  return { words, candidates };
}

/** Greedy left-to-right, longest-first matching. */
export function matchPhrases(cands: PhraseCandidate[], isPhrase: (s: string) => boolean): PhraseMatch[] {
  const byStart = new Map<number, PhraseCandidate[]>();
  for (const c of cands) {
    if (!byStart.has(c.from)) byStart.set(c.from, []);
    byStart.get(c.from)!.push(c);
  }
  const out: PhraseMatch[] = [];
  let i = 0;
  const maxFrom = Math.max(-1, ...cands.map((c) => c.from));
  while (i <= maxFrom) {
    const list = (byStart.get(i) ?? []).slice().sort((a, b) => b.to - b.from - (a.to - a.from) || Number(!!a.separable) - Number(!!b.separable));
    let matched: PhraseMatch | null = null;
    for (const c of list) {
      const hit = c.strings.find(isPhrase);
      if (hit) {
        matched = { from: c.from, to: c.to, phrase: hit, separable: !!c.separable };
        break;
      }
    }
    if (matched) {
      out.push(matched);
      i = matched.to + 1;
    } else i++;
  }
  return out;
}
