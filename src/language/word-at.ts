import { tokenize } from './tokenize';

export interface WordSpan {
  word: string;
  start: number;
  end: number;
}

/**
 * Returns the word that contains `offset` in `text` (the caret position under the cursor).
 * Punctuation, quotes and spaces never belong to the word. If the caret sits exactly at the end
 * of a word (common when clicking the right half of the last letter) that word is returned.
 */
export function extractWordAt(text: string, offset: number): WordSpan | null {
  if (!text || offset < 0 || offset > text.length) return null;
  // Work on a bounded window cut at whitespace so huge text nodes stay cheap.
  let from = Math.max(0, offset - 120);
  let to = Math.min(text.length, offset + 120);
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  while (to < text.length && !/\s/.test(text[to])) to++;
  const slice = text.slice(from, to);
  const local = offset - from;
  const toks = tokenize(slice).filter((t) => t.type === 'word');
  const hit = toks.find((t) => local >= t.start && local < t.end) ?? toks.find((t) => t.end === local);
  if (!hit) return null;
  let word = hit.text;
  let start = hit.start + from;
  let end = hit.end + from;
  // Dotted abbreviations keep their final dot; a lone trailing dot is sentence punctuation.
  if (/^[\p{L}\p{M}]+\.$/u.test(word) && !/(?:\p{L}\.){2,}/u.test(word)) {
    word = word.slice(0, -1);
    end--;
  }
  return { word, start, end };
}

/**
 * Extracts the sentence around a character range inside a larger block of text. Used as context
 * for sense ranking and for "Original sentence" when saving words.
 */
export function sentenceAround(text: string, start: number, end: number, maxLen = 400): string {
  const boundary = /[.!?…]\s|[\n\r]{2,}/g;
  let s = 0;
  let e = text.length;
  let m: RegExpExecArray | null;
  boundary.lastIndex = 0;
  while ((m = boundary.exec(text))) {
    const idx = m.index + m[0].length;
    if (idx <= start) s = idx;
    else if (m.index >= end) {
      e = m.index + 1;
      break;
    }
  }
  let out = text.slice(s, e).replace(/\s+/g, ' ').trim();
  if (out.length > maxLen) {
    const mid = start - s;
    const a = Math.max(0, mid - maxLen / 2);
    out = `${a > 0 ? '…' : ''}${out.slice(a, a + maxLen).trim()}…`;
  }
  return out;
}
