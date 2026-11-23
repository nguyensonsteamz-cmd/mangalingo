import { describe, expect, it } from 'vitest';
import { translateBatchViaGoogle, type BatchDeps } from '@/translation/batch';
import type { TranslateOutcome } from '@/modules/usage/types';

const ok = (text: string): TranslateOutcome => ({ source: 'google', text, cached: false, chars: text.length });

function deps(over: Partial<BatchDeps> = {}, handler?: (text: string, n: number) => TranslateOutcome | Promise<TranslateOutcome>) {
  const sent: string[] = [];
  const d: BatchDeps = {
    active: async () => true,
    translate: async (text) => {
      sent.push(text);
      return handler ? handler(text, sent.length) : ok(text.split('\n').map((l) => 'VI:' + l).join('\n'));
    },
    ...over,
  };
  return { d, sent };
}

describe('translating the bubbles of one scan through Google Translate (web)', () => {
  it('returns null when Google is not the selected provider (the phone translator does it)', async () => {
    const { d, sent } = deps({ active: async () => false });
    expect(await translateBatchViaGoogle(['Hello'], d)).toBeNull();
    expect(sent).toHaveLength(0);
  });
  it('several bubbles = ONE request (one per line); every bubble gets its own translation, in order', async () => {
    const { d, sent } = deps();
    const out = await translateBatchViaGoogle(['Run!', 'I will hold them off.', 'Go now.'], d);
    expect(sent).toEqual(['Run!\nI will hold them off.\nGo now.']);
    expect(out).toEqual(['VI:Run!', 'VI:I will hold them off.', 'VI:Go now.']);
  });
  it('a single bubble is a single plain request; blank texts are skipped and stay empty', async () => {
    const { d, sent } = deps();
    expect(await translateBatchViaGoogle(['  ', 'Hello'], d)).toEqual(['', 'VI:Hello']);
    expect(sent).toEqual(['Hello']);
  });
  it('line breaks inside a bubble never break the one-bubble-per-line split', async () => {
    const { d, sent } = deps();
    await translateBatchViaGoogle(['first\nsecond', 'third'], d);
    expect(sent[0]).toBe('first second\nthird');
  });
  it('if Google changes the line structure, the group is translated text by text (nothing is guessed)', async () => {
    const { d, sent } = deps({}, (text) => (text.includes('\n') ? ok('one single line without breaks') : ok('VI:' + text)));
    const out = await translateBatchViaGoogle(['A one.', 'B two.', 'C three.'], d);
    expect(out).toEqual(['VI:A one.', 'VI:B two.', 'VI:C three.']);
    expect(sent).toEqual(['A one.\nB two.\nC three.', 'A one.', 'B two.', 'C three.']);
  });
  it('a long list is split into groups under the request limit (never one huge request)', async () => {
    const { d, sent } = deps();
    const texts = Array.from({ length: 60 }, (_, i) => `Bubble ${i} ` + 'word '.repeat(20));
    const out = await translateBatchViaGoogle(texts, d);
    expect(sent.length).toBeGreaterThan(5);
    for (const s of sent) expect([...s].length).toBeLessThanOrEqual(1300);
    expect(out).toHaveLength(60);
    expect(out!.every((t, i) => t.startsWith('VI:Bubble ' + i + ' '))).toBe(true);
  });
  it('a Google failure is thrown (shown to the user), never replaced by the original text', async () => {
    const { d } = deps({}, () => Promise.reject(Object.assign(new Error('Google Dịch tạm thời không dùng được'), { code: 'gweb-CAPTCHA_REQUIRED' })));
    await expect(translateBatchViaGoogle(['Hello', 'World'], d)).rejects.toThrow(/Google Dịch/);
  });
  it('if the provider is switched while translating, null is returned (no half-translated mix)', async () => {
    const { d } = deps({}, (_t, n) => (n === 1 ? ok('VI:x') : ({ source: 'device' } as TranslateOutcome)));
    const out = await translateBatchViaGoogle(Array.from({ length: 60 }, (_, i) => `Bubble ${i} ` + 'word '.repeat(20)), d);
    expect(out).toBeNull();
  });
});
