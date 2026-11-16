import { describe, expect, it } from 'vitest';
import { realDictionary } from './helpers/dict';
import type { ParagraphAnalysis, SentenceAnalysis } from '@/shared/types';

const { service } = realDictionary();
const para = (n: number) => Array.from({ length: n }, (_, i) => `This is sentence ${i + 1}, and it says something useful.`).join(' ');

describe('long text in a look-up: the translation always has the FULL text', () => {
  it('the analysis is capped, fullText carries everything the user gave', async () => {
    const text = para(400); // ≈ 21,000 characters
    const r = (await service.lookup({ text })) as ParagraphAnalysis;
    expect(r.kind).toBe('paragraph');
    expect(r.text.length).toBeLessThanOrEqual(6000);
    expect(r.fullText).toBe(text.trim());
    expect(r.fullText!.length).toBeGreaterThan(20_000);
  });
  it('short text has no fullText (nothing was cut)', async () => {
    const r = (await service.lookup({ text: 'I gave up on my dream.', mode: 'sentence' })) as SentenceAnalysis;
    expect(r.fullText).toBeUndefined();
  });
  it('a very long single "sentence" is also kept whole for translation', async () => {
    const text = 'word '.repeat(1000).trim(); // no punctuation: one 5,000-character sentence, analysis limited to 1,200
    const r = (await service.lookup({ text, mode: 'sentence' })) as SentenceAnalysis;
    expect(r.text.length).toBeLessThan(text.length);
    expect(r.fullText).toBe(text);
  });
});
