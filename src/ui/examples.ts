/**
 * Example sentences of a lookup. The dictionary data (WordNet) attaches to a word the examples of every sense of every synonym set it
 * belongs to, so many of them do not contain the word at all ("project" -> "His sharp nose jutted out"). Only the sentences that really
 * use the word (or one of its inflections) are kept.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stem good enough to match inflections: project / projects / projected / projecting, find / finds, make / making. */
export function stemOf(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z'-]/g, '');
  if (w.length <= 3) return w;
  const cut = w.replace(/(ies|ied|ing|ed|es|s)$/, '');
  const base = cut.length >= 3 ? cut : w;
  return base.replace(/(e|y)$/, '') || base;
}

export function usesWord(example: string, phraseOrWord: string): boolean {
  const tokens = phraseOrWord
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => /[a-z]/.test(t));
  if (!tokens.length) return true;
  const lower = example.toLowerCase();
  // a phrase: its first and last word must both appear (in this order); one word: its stem
  const first = stemOf(tokens[0]);
  const last = stemOf(tokens[tokens.length - 1]);
  const re =
    tokens.length === 1
      ? new RegExp('(^|[^a-z])' + esc(first) + '[a-z]*', 'i')
      : new RegExp('(^|[^a-z])' + esc(first) + '[a-z]*.*[^a-z]' + esc(last) + '[a-z]*', 'i');
  return re.test(lower);
}

/** Examples that use the headword (or the looked-up form), without duplicates. */
export function relevantExamples(examples: string[], ...words: (string | undefined)[]): string[] {
  const keys = words.filter((w): w is string => !!w && /[a-z]/i.test(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of examples) {
    const t = e.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    if (keys.length && !keys.some((w) => usesWord(t, w))) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
