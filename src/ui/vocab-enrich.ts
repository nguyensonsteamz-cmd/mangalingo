/**
 * Dictionary data for a word the user adds by hand (or in a note), so the notebook and the widget can show more than the bare word:
 * the pronunciation, the part of speech and a Vietnamese meaning. Single words only (a phrase has no entry of its own).
 */
import { send } from '@/shared/messages';
import { vietnameseMeaning } from './meaning';

export interface WordInfo {
  lemma: string;
  ipa?: string;
  /** part of speech code ("noun", "verb", "adj"…) */
  pos?: string;
  /** Vietnamese meaning (the dictionary's, else a machine translation, else the English definition) */
  meaning: string;
}

/** null when the text is a phrase, or the dictionary does not know the word. Never throws. */
export async function lookupWord(text: string, context?: string): Promise<WordInfo | null> {
  const w = text.trim();
  if (!w || /\s/.test(w)) return null;
  try {
    const r = await send({ type: 'lookup', req: { text: w, context, mode: 'word', assumeEnglish: true } });
    if (r.kind !== 'word' || !r.found) return null;
    return { lemma: r.lemma, ipa: r.ipa || undefined, pos: r.context?.likelyPos ?? r.posList[0], meaning: await vietnameseMeaning(r) };
  } catch {
    return null;
  }
}
