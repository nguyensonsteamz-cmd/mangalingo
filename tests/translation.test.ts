import { describe, expect, it } from 'vitest';
import { realDictionary } from './helpers/dict';
import { detectMode } from '@/translation/lookup-service';
import { phraseCandidates, matchPhrases } from '@/translation/phrase-matcher';
import { tokenize } from '@/language/tokenize';
import type { ParagraphAnalysis, SentenceAnalysis } from '@/shared/types';

const { service } = realDictionary();
const sentence = async (t: string) => (await service.lookup({ text: t, mode: 'sentence' })) as SentenceAnalysis;

describe('phrase matching (pure)', () => {
  const known = new Set(['give up', 'look down on', "lose one's mind", 'pick up', 'what the hell', 'go on']);
  const match = (t: string) => {
    const { words, candidates } = phraseCandidates(tokenize(t));
    return matchPhrases(candidates, (s) => known.has(s)).map((m) => [m.phrase, words.slice(m.from, m.to + 1).map((w) => w.text).join(' ')]);
  };
  it('matches longest phrase first, with inflected heads', () => {
    expect(match('She gave up and looked down on him')).toEqual([
      ['give up', 'gave up'],
      ['look down on', 'looked down on'],
    ]);
  });
  it('matches possessive placeholders and separable phrasal verbs', () => {
    expect(match('Have you lost your mind?')).toEqual([["lose one's mind", 'lost your mind']]);
    expect(match('Pick it up now')).toEqual([['pick up', 'Pick it up']]);
  });
  it('does not match across punctuation', () => {
    expect(match('I will give, up there')).toEqual([]);
  });
});

describe('mode detection', () => {
  it('classifies word / phrase / sentence / paragraph', () => {
    expect(detectMode('destroyed')).toBe('word');
    expect(detectMode('well-known')).toBe('word');
    expect(detectMode('piece of cake')).toBe('phrase');
    expect(detectMode('I gave up on my dream.')).toBe('sentence');
    expect(detectMode('Run! I will hold them off. Go now.')).toBe('paragraph');
    expect(detectMode('Line one\n\nLine two')).toBe('paragraph');
  });
});

describe('sentence translation – Dictionary Mode', () => {
  it('translates phrase-first and composes an explicit gloss', async () => {
    const r = await sentence('I gave up on my dream.');
    const phrase = r.chunks.find((c) => c.kind === 'phrase');
    expect(phrase).toMatchObject({ text: 'gave up', lemma: 'give up', status: 'vi' });
    expect(r.gloss).toContain('bỏ cuộc');
    expect(r.gloss).toContain('giấc mơ');
    expect(r.coverage).toBeGreaterThan(0.8);
  });

  it('renders auxiliaries by grammatical role (passive → "bị/được", progressive → "đang")', async () => {
    expect((await sentence('The village was destroyed by the demon.')).gloss).toContain('bị/được phá hủy');
    expect((await sentence('My sister was crying.')).gloss).toContain('đang khóc');
  });

  it('falls back to English definitions or brackets – never fabricates Vietnamese', async () => {
    const r = await sentence('The photosynthesis experiment failed spectacularly.');
    const photo = r.chunks.find((c) => c.text === 'photosynthesis')!;
    expect(photo.status).toBe('en-only');
    expect(photo.vi).toBeUndefined();
    expect(photo.en).toMatch(/plant|light/i);
    expect(r.gloss).toContain('[photosynthesis]');
    expect(r.coverage).toBeLessThan(1);
    const unknown = (await sentence('Zorblax glimmered.')).chunks.find((c) => c.text === 'Zorblax')!;
    expect(['name', 'word']).toContain(unknown.kind);
    expect(unknown.vi).toBeUndefined();
  });

  it('detects slang, idioms and tone in manga dialogue', async () => {
    const r = await sentence("I-I don't wanna fight you... What the hell?!");
    const titles = r.notes.map((n) => n.title).join(' | ');
    expect(titles).toMatch(/Nói lắp/);
    expect(titles).toMatch(/Ngập ngừng/);
    expect(titles).toMatch(/wanna/);
    expect(titles).toMatch(/what the hell/);
    expect(titles).toMatch(/\?!|sốc/i);
  });

  it('suggests difficult vocabulary', async () => {
    const r = await sentence('The mercenary unleashed a devastating technique.');
    const lemmas = r.vocabulary.map((v) => v.lemma);
    expect(lemmas).toEqual(expect.arrayContaining(['mercenary', 'devastating']));
  });
});

describe('grammar analysis', () => {
  const g = async (t: string) => (await sentence(t)).grammar;
  it('tense and aspect', async () => {
    expect((await g('She has been training for three years.')).tense?.id).toBe('present-perfect-continuous');
    expect((await g('I have never seen a dragon.')).tense?.id).toBe('present-perfect');
    expect((await g('They had left before we arrived.')).tense?.id).toBe('past-perfect');
    expect((await g("I'm gonna become the strongest ninja!")).tense?.id).toBe('going-to');
    expect((await g('We will protect the village.')).tense?.id).toBe('future-simple');
    expect((await g('He is eating ramen.')).tense?.id).toBe('present-continuous');
    expect((await g('He ate ramen.')).tense?.id).toBe('past-simple');
    expect((await g('You must leave now.')).tense?.id).toBe('modal');
  });
  it('voice, conditionals, negation', async () => {
    expect((await g('The village was destroyed by the demon.')).voice).toBe('passive');
    expect((await g('If I were you, I would run away.')).conditional?.type).toBe('2');
    expect((await g('If you train hard, you will win.')).conditional?.type).toBe('1');
    expect((await g('If I had known, I would have helped you.')).conditional?.type).toBe('3');
    expect((await g("I don't know.")).negated).toBe(true);
  });
  it('sentence types', async () => {
    expect((await g('Are you out of your mind?')).sentenceType).toBe('yes-no-question');
    expect((await g('Where are you going?')).sentenceType).toBe('wh-question');
    expect((await g("Don't look down on me!")).sentenceType).toBe('imperative');
    expect((await g('What a beautiful day!')).sentenceType).toBe('exclamatory');
    expect((await g('No way!')).sentenceType).toBe('exclamatory');
    expect((await g('The end.')).sentenceType).toBe('fragment');
  });
  it('subject / verb / object and clauses', async () => {
    const r = await g('The ninja threw a shuriken.');
    expect(r.roles).toMatchObject({ subject: 'The ninja', verb: 'threw', object: 'a shuriken' });
    const q = await g('Are you out of your mind?');
    expect(q.roles.subject).toBe('you');
    const c = await g('When I came home, my sister was crying.');
    expect(c.clauses.map((x) => x.type)).toEqual(['subordinate', 'main']);
    expect(c.tense?.id).toBe('past-continuous');
    const rel = await g('The man who saved me disappeared.');
    expect(rel.clauses.some((x) => x.type === 'relative')).toBe(true);
  });
  it('always carries the rule-based disclaimer', async () => {
    expect((await g('Hello there.')).disclaimer).toMatch(/quy tắc/);
  });
});

describe('paragraph translation', () => {
  it('keeps sentence order and aggregates notes/vocabulary', async () => {
    const r = (await service.lookup({ text: "Run! I'll hold them off. Don't look back, okay?" })) as ParagraphAnalysis;
    expect(r.kind).toBe('paragraph');
    expect(r.sentences.map((s) => s.text)).toEqual(['Run!', "I'll hold them off.", "Don't look back, okay?"]);
    expect(r.coverage).toBeGreaterThan(0.5);
  });
  it('handles long paragraphs within a reasonable time', async () => {
    const text = Array.from({ length: 30 }, () => 'The young warrior trained every day because he wanted to protect his village.').join(' ');
    const t0 = performance.now();
    const r = (await service.lookup({ text })) as ParagraphAnalysis;
    expect(r.sentences).toHaveLength(30);
    expect(performance.now() - t0).toBeLessThan(3000 * (process.env.CI ? 4 : 1)); // loose on a shared CI runner
  });
  it('rejects non-English text instead of mistranslating', async () => {
    const r = await service.lookup({ text: 'Je ne sais pas ce que tu veux dire.' });
    expect(r.kind).toBe('unsupported');
    const forced = await service.lookup({ text: 'Je ne sais pas.', assumeEnglish: true });
    expect(forced.kind).not.toBe('unsupported');
  });
});

describe('common manga dialogue expressions (Starter phrases)', () => {
  it('glosses short reaction lines as set expressions, not word by word', async () => {
    const p = (await service.lookup({ text: "THAT'S RIGHT", assumeEnglish: true })) as { kind: string; senses: { vi?: string[] }[] };
    expect(p.kind).toBe('phrase');
    expect(p.senses[0].vi).toContain('đúng rồi');
    expect((await sentence("THAT'S RIGHT...")).gloss).toContain('đúng rồi');
    expect((await sentence('WHO DID IT!?')).gloss).toContain('ai đã làm chuyện này');
    expect((await sentence("T-THAT'S IMPOSSIBLE!!")).gloss).toContain('không thể nào');
  });
});

describe('natural casing for machine translation of comic text', async () => {
  const { naturalCase, isMostlyUpper } = await import('@/translation/casing');
  it('turns ALL CAPS bubbles into sentence case and keeps the pronoun I', () => {
    expect(naturalCase("I'M GONNA BECOME THE STRONGEST NINJA!")).toBe("I'm gonna become the strongest ninja!");
    expect(naturalCase('WHAT? NO WAY. I WILL GO.')).toBe('What? No way. I will go.');
  });
  it('keeps proper names (words missing from the dictionary) capitalised', () => {
    const names = new Set(['naruto', 'konoha']);
    expect(naturalCase('NARUTO, I WILL PROTECT KONOHA!', (w) => names.has(w))).toBe('Naruto, I will protect Konoha!');
  });
  it('leaves normally written text alone', () => {
    expect(isMostlyUpper('The village was destroyed.')).toBe(false);
    expect(naturalCase('Naruto met Sasuke in NYC.')).toBe('Naruto met Sasuke in NYC.');
  });
});
