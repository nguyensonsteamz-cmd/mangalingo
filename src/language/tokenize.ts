/**
 * Unicode-aware English tokenizer that keeps contractions ("don't"), hyphenated compounds
 * ("well-known"), dotted abbreviations ("U.S.") and clipped forms ("'em", "goin'") as single words.
 */

export type TokenType = 'word' | 'num' | 'punct' | 'space';

export interface Token {
  text: string;
  start: number;
  end: number;
  type: TokenType;
}

const RAW = /(?:\p{L}\.){2,}|[\p{L}\p{M}\d]+(?:['’‐-][\p{L}\p{M}\d]+)*|\s+|[^\s]/gsu;
const LEADING_CLITICS = new Set(['em', 'cause', 'bout', 'til', 'till', 'round', 'n', 'kay', 'sup', 'cuz']);
const LETTER = /[\p{L}\p{M}]/u;

export const APOSTROPHES = /['’]/;

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{M}\d]/u.test(ch);
}

export function tokenize(text: string): Token[] {
  const raw: Token[] = [];
  RAW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW.exec(text))) {
    const t = m[0];
    let type: TokenType;
    if (/^\s/u.test(t)) type = 'space';
    else if (/^[\p{L}\p{M}]/u.test(t)) type = 'word';
    else if (/^\d/u.test(t)) type = /[\p{L}]/u.test(t) && !/^\d+(st|nd|rd|th|s)$/iu.test(t) ? 'word' : 'num';
    else type = 'punct';
    raw.push({ text: t, start: m.index, end: m.index + t.length, type });
  }

  // Merge clitics: 'em / 'cause (leading) and goin' / nothin' (trailing g-drop)
  const out: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    const next = raw[i + 1];
    const prev = out[out.length - 1];
    if (
      tok.type === 'punct' &&
      APOSTROPHES.test(tok.text) &&
      next?.type === 'word' &&
      LEADING_CLITICS.has(next.text.toLowerCase()) &&
      (!prev || prev.type !== 'word')
    ) {
      out.push({ text: tok.text + next.text, start: tok.start, end: next.end, type: 'word' });
      i++;
      continue;
    }
    if (
      tok.type === 'punct' &&
      APOSTROPHES.test(tok.text) &&
      prev?.type === 'word' &&
      prev.end === tok.start &&
      /in$/i.test(prev.text) &&
      prev.text.length > 3 &&
      !LETTER.test(text[tok.end] ?? '')
    ) {
      prev.text += tok.text;
      prev.end = tok.end;
      continue;
    }
    out.push({ ...tok });
  }
  return out;
}

export function words(text: string): Token[] {
  return tokenize(text).filter((t) => t.type === 'word');
}

/** Normalises a surface form for dictionary lookup: NFC, straight apostrophes, lowercase, no possessive. */
export function normalizeWord(word: string): string {
  let w = word.normalize('NFC').replace(/[’‘`´]/g, "'").replace(/[‐‑–]/g, '-').trim().toLowerCase();
  w = w.replace(/^[^\p{L}\p{M}\d']+|[^\p{L}\p{M}\d'.]+$/gu, '');
  if (/^[^.]+\.$/u.test(w)) w = w.slice(0, -1);
  // Stutter spelling: "I-I" → "i", "w-what" → "what", "b-b-but" → "but"
  let prev = '';
  while (prev !== w) {
    prev = w;
    w = w.replace(/^(\p{L}{1,2})-(?=\1)/u, '');
  }
  if (w.length > 3 && !/^(it|he|she|that|what|who|there|here|where|how|let)'s$/.test(w)) {
    w = w.replace(/'s$/, '');
  }
  if (/s'$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** True when the text is predominantly upper case (manga lettering, OCR output). */
export function isMostlyUpper(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return upper / letters.length > 0.7;
}
