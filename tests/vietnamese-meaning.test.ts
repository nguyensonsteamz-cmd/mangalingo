import { describe, expect, it, vi } from 'vitest';
import type { WordLookup } from '@/shared/types';

const mt = vi.fn(async (t: string) => (t === 'repository' ? ' kho ' : t));
vi.mock('@/translation/chrome-mt', () => ({ machineTranslate: (t: string) => mt(t) }));

const word = (senses: Partial<WordLookup['senses'][number]>[], lemma = 'repository'): WordLookup =>
  ({ kind: 'word', query: lemma, lemma, found: true, hasVietnamese: senses.some((s) => s.vi?.length), inflections: [], posList: ['noun'], senses: senses.map((s) => ({ pos: 'noun', ...s })), forms: [], synonyms: [], antonyms: [], collocations: [], phrasalVerbs: [], idioms: [], tags: [], notes: [], sources: [] }) as unknown as WordLookup;

describe('the meaning saved with a word is Vietnamese', () => {
  it('uses the dictionary Vietnamese when there is some, without calling the translator', async () => {
    const { vietnameseMeaning } = await import('@/ui/meaning');
    mt.mockClear();
    expect(await vietnameseMeaning(word([{ vi: ['kho', 'kho lưu trữ'], en: 'a facility' }]))).toBe('kho; kho lưu trữ');
    expect(mt).not.toHaveBeenCalled();
  });
  it('a word with no Vietnamese data is saved with its machine translation ("repository" -> "kho"), not the English definition', async () => {
    const { vietnameseMeaning } = await import('@/ui/meaning');
    expect(await vietnameseMeaning(word([{ en: 'a facility where things can be deposited' }]))).toBe('kho');
  });
  it('falls back to the English definition when no translator answers, and keeps English when the target language is English', async () => {
    const { vietnameseMeaning } = await import('@/ui/meaning');
    mt.mockRejectedValueOnce(new Error('no translator'));
    expect(await vietnameseMeaning(word([{ en: 'a facility' }]))).toBe('a facility');
    mt.mockClear();
    expect(await vietnameseMeaning(word([{ en: 'a facility' }]), 'en')).toBe('a facility');
    expect(mt).not.toHaveBeenCalled();
  });
});
