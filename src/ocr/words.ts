/** Word list for an OCR speech bubble (pure; shared by the popup and tests). */

/** Function words that would only add noise to a bubble's word list. */
const FUNCTION_WORDS = new Set(
  (
    'a an the and or but nor so yet if then than that this these those there here ' +
    'i me my mine you your yours he him his she her hers it its we us our ours they them their theirs ' +
    'is am are was were be been being do does did have has had will would shall should can could may might must ' +
    'to of in on at by for from with as into onto up out off over about ' +
    "not no can't won't"
  ).split(' '),
);
export const MAX_OCR_WORDS = 24;

/** Unique content words of an OCR text, in reading order (exported for tests). */
export function ocrWords(text: string, includeFunctionWords = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Re-join words hyphenated across lines ("IMPOSSI- BLE") before splitting.
  const joined = text.replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2');
  for (const m of joined.matchAll(/[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*/g)) {
    const w = m[0].replace(/’/g, "'").replace(/'+$/, '');
    const key = w.toLowerCase();
    const base = key.replace(/n't$|'(s|re|ve|ll|d|m)$/, '');
    const isFunction = FUNCTION_WORDS.has(key) || FUNCTION_WORDS.has(base);
    if ((key.length < 2 && key !== 'i' && key !== 'a') || (isFunction && !includeFunctionWords) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_OCR_WORDS) break;
  }
  return out;
}
