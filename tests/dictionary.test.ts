import { describe, expect, it } from 'vitest';
import { realDictionary } from './helpers/dict';
import type { WordLookup } from '@/shared/types';

const { engine, service } = realDictionary();
const word = async (w: string, ctx?: string) => (await engine.lookupWord(w, ctx)) as WordLookup;

describe('dictionary lookup (real packaged data)', () => {
  it('finds Vietnamese (Starter) and English (WordNet) data with IPA', async () => {
    const r = await word('destroy');
    expect(r.found).toBe(true);
    expect(r.hasVietnamese).toBe(true);
    expect(r.senses.find((s) => s.vi)?.vi).toContain('phá hủy');
    expect(r.senses.some((s) => s.source === 'wordnet' && s.en)).toBe(true);
    expect(r.ipa).toBe('/dɪˈstrɔɪ/');
    expect(r.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['starter', 'wordnet', 'cmudict']));
  });

  it('lemmatises inflected and irregular forms', async () => {
    expect((await word('went')).lemma).toBe('go');
    expect((await word('went')).inflections[0]).toMatchObject({ lemma: 'go', rule: 'irregular past' });
    expect((await word('destroyed')).lemma).toBe('destroy');
    expect((await word('Children')).lemma).toBe('child');
    expect((await word('swords,')).lemma).toBe('sword');
  });

  it('distinguishes parts of speech and many meanings', async () => {
    const r = await word('run');
    expect(r.posList).toEqual(expect.arrayContaining(['verb', 'noun']));
    expect(r.senses.filter((s) => s.source === 'wordnet').length).toBeGreaterThan(10);
    expect(r.forms.find((f) => f.label === 'past')?.form).toBe('ran');
  });

  it('ranks senses by context (multi-meaning word "bank")', async () => {
    const river = await word('bank', 'We sat on the bank of the river and watched the water.');
    expect(river.context?.likelyPos).toBe('noun');
    expect(river.senses[river.context!.bestSense!].en).toMatch(/slop|water|river/i);
    const money = await word('bank', 'I need to deposit money at the bank before it closes.');
    expect(money.senses[money.context!.bestSense!].en).toMatch(/financial|deposit|money/i);
  });

  it('uses context to prefer the verb reading', async () => {
    const r = await word('fly', 'I can fly over the city.');
    expect(r.context?.likelyPos).toBe('verb');
    expect(r.senses[0].pos).toBe('verb');
  });

  it('covers slang, abbreviations and contractions with labels', async () => {
    const g = await word('gonna');
    expect(g.found).toBe(true);
    expect(g.tags).toContain('informal');
    expect(g.notes.some((n) => n.kind === 'contraction')).toBe(true);
    const d = await word('dude');
    expect(d.tags).toContain('slang');
    const lol = await word('lol');
    expect(lol.tags).toEqual(expect.arrayContaining(['slang', 'abbr']));
    const dont = await word("don't");
    expect(dont.senses[0].vi?.[0]).toContain('không');
  });

  it('lists phrasal verbs and idioms for a head word', async () => {
    const r = await word('give');
    const pv = r.phrasalVerbs.map((p) => p.phrase);
    expect(pv).toEqual(expect.arrayContaining(['give up', 'give in']));
    expect(r.phrasalVerbs.find((p) => p.phrase === 'give up')?.vi).toContain('bỏ cuộc');
  });

  it('reports not-found honestly with spelling suggestions', async () => {
    const r = await word('destory');
    expect(r.found).toBe(false);
    expect(r.senses).toHaveLength(0);
    expect(r.suggestions).toContain('destroy');
    // morphological rules still recover regular misspelt inflections (destroied → destroy -ied→y)
    expect((await word('destroied')).lemma).toBe('destroy');
    const nonsense = await word('qzxvbn');
    expect(nonsense.found).toBe(false);
  });

  it('never invents Vietnamese for words outside the curated data', async () => {
    const r = await word('photosynthesis');
    expect(r.found).toBe(true);
    expect(r.hasVietnamese).toBe(false);
    expect(r.senses.every((s) => !s.vi)).toBe(true);
    expect(r.senses[0].en).toMatch(/light|plant|carbohydrate/i);
  });

  it('caches lookups', async () => {
    await word('village');
    const t0 = performance.now();
    await word('village');
    expect(performance.now() - t0).toBeLessThan(30 * (process.env.CI ? 8 : 1)); // loose on a shared CI runner
  });
});

describe('phrase lookup', () => {
  it('finds curated phrases, inflected heads and possessive placeholders', async () => {
    expect((await service.lookupPhrase('piece of cake')).senses[0].vi).toContain('dễ như ăn bánh');
    const gave = await service.lookupPhrase('gave up');
    expect(gave.phrase).toBe('give up');
    expect(gave.phraseType).toBe('phrasal');
    const mind = await service.lookupPhrase('lost my mind');
    expect(mind.found).toBe(true);
    expect(mind.phrase).toBe("lose one's mind");
    const sep = await service.lookupPhrase('pick it up');
    expect(sep.phrase).toBe('pick up');
  });
  it('finds WordNet multi-word expressions without Vietnamese data', async () => {
    const r = await service.lookupPhrase('kick the bucket');
    expect(r.found).toBe(true);
    expect(r.senses.some((s) => s.vi)).toBe(true); // curated
    const wn = await service.lookupPhrase('take a breather');
    expect(wn.found).toBe(true);
    expect(wn.senses.some((s) => s.source === 'wordnet')).toBe(true);
  });
});
