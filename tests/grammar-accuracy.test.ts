import { describe, expect, it } from 'vitest';
import { realDictionary } from './helpers/dict';
import type { SentenceAnalysis } from '@/shared/types';

const { service } = realDictionary();
const an = async (t: string) => (await service.lookup({ text: t, mode: 'sentence' })) as SentenceAnalysis;

describe('grammar: commands (sentence-initial verb/noun words)', () => {
  it.each(['Go now!', 'Stop being a coward.', 'Let me go!', 'Run away!', 'Wait here.', 'Look at me!', 'Come here.'])('%s is imperative', async (t) => {
    const r = await an(t);
    expect(r.grammar.sentenceType).toBe('imperative');
    expect(r.grammar.roles.subject).toContain('you');
  });
  it('does not turn nouns / statements into commands', async () => {
    expect((await an('Time flies.')).grammar.sentenceType).toBe('declarative');
    expect((await an('Love is blind.')).grammar.sentenceType).toBe('declarative');
  });
});

describe('grammar: roles', () => {
  it('relative clause inside the subject: main verb is the outer one', async () => {
    const g = (await an('The man who lives next door is a doctor.')).grammar;
    expect(g.roles.verb).toBe('is');
    expect(g.roles.subject).toBe('The man who lives next door');
    expect(g.roles.complement).toBe('a doctor');
    expect(g.tense?.id).toBe('present-simple');
    expect(g.clauses.map((c) => c.type)).toEqual(['main', 'relative']);
  });
  it('linking verb takes a complement, not an object', async () => {
    const g = (await an('She looked tired.')).grammar;
    expect(g.roles.complement).toBe('tired');
    expect(g.roles.object).toBeUndefined();
  });
  it('wh-word is the subject of "What the hell is going on?"', async () => {
    expect((await an('What the hell is going on here?!')).grammar.roles.subject).toBe('What the hell');
  });
  it('tenses stay right', async () => {
    expect((await an('She has been waiting for two hours.')).grammar.tense?.id).toBe('present-perfect-continuous');
    expect((await an('The village was destroyed by the demon.')).grammar.voice).toBe('passive');
    expect((await an('If he had studied, he would have passed.')).grammar.conditional?.type).toBe('3');
    expect((await an('If I were you, I would not do that.')).grammar.conditional?.type).toBe('2');
  });
});

describe('context notes: no noisy false positives', () => {
  it('"going to + verb" is not a "go to" phrasal verb', async () => {
    expect((await an('He is going to leave.')).notes.some((n) => /go to/.test(n.title))).toBe(false);
  });
  it('"Do you know what…" is not the filler "you know"', async () => {
    expect((await an('Do you know what he is doing?')).notes.some((n) => /you know/.test(n.title))).toBe(false);
  });
  it('keeps real notes (phrasal verb, idiom, tone)', async () => {
    expect((await an('I gave up on my dream.')).notes.some((n) => /give up/.test(n.title))).toBe(true);
    expect((await an('He kicked the bucket.')).notes.some((n) => n.kind === 'idiom')).toBe(true);
    expect((await an('What the hell is going on here?!')).notes.some((n) => n.title.includes('Ngạc nhiên'))).toBe(true);
  });
});
