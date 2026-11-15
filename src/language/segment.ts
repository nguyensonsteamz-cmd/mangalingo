/**
 * Rule-based sentence segmentation tuned for fiction and manga dialogue:
 * abbreviations, initials, decimals, ellipses, "?!" clusters and closing quotes are handled.
 */

export interface Segment {
  text: string;
  start: number;
  end: number;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'eg', 'ie', 'no', 'vol', 'ch',
  'fig', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'approx',
  'dept', 'est', 'inc', 'ltd', 'co', 'corp', 'capt', 'col', 'gen', 'lt', 'sgt', 'rev', 'gov', 'pres',
]);

const CLOSERS = `"'”’)]}»」』`;

export function splitSentences(text: string): Segment[] {
  const out: Segment[] = [];
  let segStart = 0;
  const n = text.length;
  const push = (end: number) => {
    const raw = text.slice(segStart, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) out.push({ text: trimmed.replace(/\s+/g, ' '), start: segStart + lead, end: segStart + lead + trimmed.length });
    segStart = end;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    // Paragraph break always ends a sentence.
    if (ch === '\n' && /\n[ \t]*\n/.test(text.slice(i, i + 4))) {
      push(i);
      continue;
    }
    if (!/[.!?…]/.test(ch)) continue;

    // Consume a run of terminal punctuation ("?!", "...", "!!!") and closing quotes/brackets.
    let j = i;
    while (j + 1 < n && /[.!?…]/.test(text[j + 1])) j++;
    let k = j;
    while (k + 1 < n && CLOSERS.includes(text[k + 1])) k++;
    const after = text.slice(k + 1);
    const nextNonSpace = after.match(/^\s*(\S)/u)?.[1];
    const hasSpace = /^\s/.test(after);
    const run = text.slice(i, j + 1);

    if (k + 1 < n && !hasSpace) {
      i = j;
      continue; // "3.14", "e.g.x", "U.S.A"
    }
    if (run === '.') {
      const before = text.slice(Math.max(0, i - 12), i);
      const word = before.match(/([\p{L}.]+)$/u)?.[1] ?? '';
      const bare = word.replace(/\./g, '').toLowerCase();
      if (ABBREVIATIONS.has(bare)) {
        i = j;
        continue;
      }
      if (/^\p{Lu}$/u.test(word)) {
        i = j;
        continue; // initial: "J. K. Rowling"
      }
      if (/(?:\p{L}\.){1,}\p{L}$/u.test(word) && nextNonSpace && /\p{Ll}/u.test(nextNonSpace)) {
        i = j;
        continue; // "e.g. this"
      }
    }
    // Ellipsis followed by lowercase continues the same sentence ("I... I don't know").
    const isEllipsis = /\.\.\.|…/.test(run) && !/[!?]/.test(run);
    const prevWord = text.slice(0, i).match(/([\p{L}']+)\W*$/u)?.[1]?.toLowerCase();
    const nextWord = after.match(/^\s*([\p{L}']+)/u)?.[1]?.toLowerCase();
    // "I... I don't know" – a hesitation repeating the previous word continues the sentence
    if (isEllipsis && nextNonSpace && (/[\p{Ll},]/u.test(nextNonSpace) || (!!prevWord && prevWord === nextWord))) {
      i = j;
      continue;
    }
    if (nextNonSpace && /[\p{Ll},;:]/u.test(nextNonSpace) && run === '.') {
      // Lowercase after a period is usually an abbreviation we do not know.
      i = j;
      continue;
    }
    push(k + 1);
    i = k;
  }
  push(n);
  return out;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
