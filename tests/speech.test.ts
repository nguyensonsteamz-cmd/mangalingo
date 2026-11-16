import { describe, expect, it } from 'vitest';
import { splitForSpeech } from '@/ui/speech';

describe('splitForSpeech', () => {
  it('keeps short text as one piece', () => expect(splitForSpeech('Hello there.')).toEqual(['Hello there.']));
  it('splits long text into sentence pieces ≤ 200 chars without losing words', () => {
    const text = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i} of a very long paragraph.`).join(' ');
    const parts = splitForSpeech(text);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
  it('cuts a single huge sentence at commas / spaces, never mid-word', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(', ') + '.';
    const parts = splitForSpeech(text);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ').replace(/ ,/g, ',')).toBe(text);
  });
  it('handles text without punctuation', () => expect(splitForSpeech('no punctuation here at all').join(' ')).toBe('no punctuation here at all'));
});
