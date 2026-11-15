/**
 * Natural casing for machine translation of comic text. Speech bubbles are lettered in ALL CAPS,
 * which translators treat as shouting / acronyms and which hides proper names. Like Google
 * Translate expects, the text is turned into normal sentence case, and words that are not in the
 * dictionary (names: NARUTO, KONOHA…) get a capital letter so the translator keeps them as names.
 */
const UPPER_RATIO = 0.7;

export function isMostlyUpper(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length >= UPPER_RATIO;
}

/**
 * @param isName  true for words to keep as proper names (lower-cased word in, e.g. "naruto").
 * Text that is not mostly upper case is returned unchanged.
 */
export function naturalCase(text: string, isName: (word: string) => boolean = () => false): string {
  if (!isMostlyUpper(text)) return text;
  return (
    text
      .toLowerCase()
      // proper names keep a capital
      .replace(/[a-z][a-z'’]*/g, (w) => (isName(w.replace(/['’].*$/, '')) ? w[0].toUpperCase() + w.slice(1) : w))
      // sentence starts
      .replace(/(^\s*|[.!?…]["'”’)]*\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
      // the pronoun "I" (I, I'm, I'll, I've, I'd)
      .replace(/\bi\b/g, 'I')
  );
}
