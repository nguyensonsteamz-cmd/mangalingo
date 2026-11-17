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
