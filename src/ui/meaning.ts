import type { WordLookup } from '@/shared/types';
import { machineTranslate } from '@/translation/chrome-mt';
import { primaryMeaning } from './views';

/**
 * The Vietnamese meaning to SAVE with a word: the dictionary's own Vietnamese when it has one; for a word without Vietnamese data the
 * machine translation of the word (what the card shows, e.g. "repository" -> "kho"); the English definition only as the last resort.
 */
export async function vietnameseMeaning(r: WordLookup, targetLanguage?: string): Promise<string> {
  if (targetLanguage === 'en' || r.senses.some((s) => s.vi?.length)) return primaryMeaning(r);
  try {
    const t = (await machineTranslate(r.lemma || r.query)).trim();
    if (t) return t;
  } catch {
    /* no translator available: keep the English definition rather than saving nothing */
  }
  return primaryMeaning(r);
}
