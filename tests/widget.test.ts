import { describe, expect, it } from 'vitest';
import type { VocabEntry } from '@/shared/types';
import { pasteText, widgetWords } from '@/mobile/widget';

const entry = (over: Partial<VocabEntry>): VocabEntry => ({
  id: crypto.randomUUID(),
  word: 'destroy',
  lemma: 'destroy',
  meaning: 'phá hủy',
  status: 'new',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('widget data', () => {
  it('keeps only what the widget shows, skips words marked "known", newest first', () => {
    const out = widgetWords([
      entry({ word: 'old', createdAt: 1, meaning: 'cũ' }),
      entry({ word: 'known one', status: 'known', createdAt: 5 }),
      entry({ word: 'new', createdAt: 9, meaning: 'mới', ipa: '/nuː/', sentence: 'A new day.' }),
    ]);
    expect(out.map((x) => x.w)).toEqual(['new', 'old']);
    expect(out[0]).toEqual({ w: 'new', vi: 'mới', ipa: '/nuː/', ex: 'A new day.' });
    expect(out[1]).toEqual({ w: 'old', vi: 'cũ' }); // empty optional fields are left out
  });
  it('is cut to widget size and the separator / line breaks of the paste format never appear inside a field', () => {
    const [w] = widgetWords([entry({ word: 'a|b', meaning: 'one | two\nthree ' + 'x'.repeat(300), sentence: 'line1\nline2' })]);
    expect(w.w).toBe('a b');
    expect(w.vi.length).toBeLessThanOrEqual(110);
    expect(w.vi).not.toMatch(/[|\n]/);
    expect(w.ex).toBe('line1 line2');
  });
  it('limits the number of words', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry({ word: 'w' + i, createdAt: i }));
    expect(widgetWords(many)).toHaveLength(300);
    expect(widgetWords(many, 10)).toHaveLength(10);
  });
  it('the paste text is ONE line: "word | ipa | meaning | example" per word, words separated by " ¶ ", trailing empty fields trimmed', () => {
    const text = pasteText([{ w: 'destroy', ipa: '/dɪˈstrɔɪ/', vi: 'phá hủy', ex: 'It was destroyed.' }, { w: 'run', vi: 'chạy' }]);
    expect(text).not.toMatch(/[\r\n]/); // one line: survives a single-line text field
    expect(text.split(' ¶ ')).toEqual(['destroy | /dɪˈstrɔɪ/ | phá hủy | It was destroyed.', 'run |  | chạy']);
    expect(pasteText(Array.from({ length: 200 }, (_, i) => ({ w: 'w' + i, vi: 'x' })), 120).split(' ¶ ')).toHaveLength(120);
  });
});
