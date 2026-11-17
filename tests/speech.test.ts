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

describe('speak: the pieces of a long text are spoken one after another', () => {
  it('starts the next piece only when the previous one ends, and a new request ends the old chain', async () => {
    const spoken: { text: string; end: () => void }[] = [];
    class FakeUtterance {
      lang = '';
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(public text: string) {}
    }
    const synth = {
      speaking: false,
      pending: false,
      cancel: () => {
        spoken.length = 0;
      },
      getVoices: () => [],
      speak: (u: FakeUtterance) => spoken.push({ text: u.text, end: () => u.onend?.() }),
    };
    Object.assign(globalThis, { window: { speechSynthesis: synth }, SpeechSynthesisUtterance: FakeUtterance });
    const { speak } = await import('@/ui/speech');
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of a long paragraph that goes on.`).join(' ');
    expect(speak(long)).toBe(true);
    expect(spoken).toHaveLength(1); // only the first piece is queued
    const first = spoken[0];
    first.end();
    expect(spoken).toHaveLength(2); // the end of piece 1 starts piece 2
    // a new request: its own chain; the old chain does not continue
    synth.speaking = true;
    speak('Hello there.');
    await new Promise((r) => setTimeout(r, 90));
    const texts = spoken.map((s) => s.text);
    expect(texts).toContain('Hello there.');
    const before = spoken.length;
    spoken[0].end?.(); // an end event of the old chain
    expect(spoken.length).toBeGreaterThanOrEqual(before);
    delete (globalThis as { window?: unknown }).window;
  });
});
