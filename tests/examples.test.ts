import { describe, expect, it } from 'vitest';
import { asSentence, relevantExamples, stemOf, usesWord } from '@/ui/examples';

describe('example sentences must use the looked-up word', () => {
  const project = [
    'he prepared for great undertakings',
    'He projected his feelings',
    'His sharp nose jutted out',
    'A single rock sticks out from the cliff',
    'The images are projected onto the screen',
    'His voice projects well',
    'They contrived to murder their boss',
    'design a new sales strategy',
  ];
  it('keeps only the sentences with the word or an inflection (the "project" case from the dictionary data)', () => {
    expect(relevantExamples(project, 'project')).toEqual(['He projected his feelings', 'The images are projected onto the screen', 'His voice projects well']);
  });
  it('matches inflections of the lemma and of the looked-up form, without duplicates', () => {
    expect(relevantExamples(['She found it.', 'She finds it.', 'She finds it.', 'He will find out.', 'A tree.'], 'find', 'found')).toEqual(['She found it.', 'She finds it.', 'He will find out.']);
  });
  it('does not match inside another word, and short words need the whole word', () => {
    expect(usesWord('The cat sat', 'at')).toBe(false);
    expect(usesWord('Look at me', 'at')).toBe(true);
    expect(usesWord('This is a prototype', 'type')).toBe(false);
  });
  it('a phrase needs its first and last word in order', () => {
    expect(usesWord('It was a piece of cake', 'piece of cake')).toBe(true);
    expect(usesWord('Cake and a piece', 'piece of cake')).toBe(false);
  });
  it('stems', () => {
    expect(stemOf('projected')).toBe('project');
    expect(stemOf('making')).toBe('mak');
    expect(stemOf('go')).toBe('go');
  });
  it('no key words: nothing is filtered', () => {
    expect(relevantExamples(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('asSentence adds a capital and a final stop only when missing', () => {
    expect(asSentence('his voice projects well')).toBe('His voice projects well.');
    expect(asSentence('Is it ok?')).toBe('Is it ok?');
    expect(asSentence('  ')).toBe('');
  });
});

import { pickDefinitions } from '@/ui/views';
import type { WordLookup } from '@/shared/types';

describe('English definitions: the sense that fits comes first', () => {
  const senses = [
    { pos: 'noun', en: 'a facility where things can be deposited' },
    { pos: 'verb', en: 'to put in a place' },
    { pos: 'noun', en: 'a person to whom a secret is entrusted' },
    { pos: 'noun', en: 'a burial vault' },
  ];
  const r = (context?: Partial<NonNullable<WordLookup['context']>>) => ({ senses, context: context ? { sentence: '', confidence: 'low', method: 't', ...context } : undefined }) as unknown as WordLookup;
  it('keeps the data order without context', () => {
    expect(pickDefinitions(r(), senses as never).map((s) => s.en)[0]).toBe('a facility where things can be deposited');
  });
  it('keeps only the part of speech the word has in the sentence, with the best sense first', () => {
    const out = pickDefinitions(r({ likelyPos: 'noun', bestSense: 2 }), senses as never);
    expect(out.map((s) => s.pos)).toEqual(['noun', 'noun', 'noun']);
    expect(out[0].en).toBe('a person to whom a secret is entrusted');
  });
  it('falls back to every sense when none has the likely part of speech', () => {
    expect(pickDefinitions(r({ likelyPos: 'adverb' as never }), senses as never)).toHaveLength(4);
  });
});
