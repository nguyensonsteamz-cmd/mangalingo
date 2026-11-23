import { describe, expect, it, vi } from 'vitest';
import { realDictionary } from './helpers/dict';
import { createReaderBridge, type ReaderDeps } from '@/mobile/reader-bridge';
import { UsageService } from '@/modules/usage';
import type { WebFetch } from '@/modules/usage/google-web';
import type { KV } from '@/storage/kv';
import type { OcrLine, Pos } from '@/shared/types';
import { POS_EN, POS_VI, primaryMeaning } from '@/ui/views';

const { service } = realDictionary();

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return {
    quota: 1e7,
    async get<T>(k: string) {
      return data.has(k) ? (JSON.parse(JSON.stringify(data.get(k))) as T) : undefined;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async bytesInUse() {
      return 0;
    },
    onChange: () => () => {},
  };
}

function deps(over: Partial<ReaderDeps> = {}): ReaderDeps & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    lookup: (req) => service.lookup(req),
    translate: async (t) => `vi:${t}`,
    hasLemma: async () => false,
    saveWord: async (e) => void saved.push(e),
    openDetails: vi.fn(),
    posLabel: (p: Pos) => `${POS_EN[p] ?? p} · ${POS_VI[p]}`,
    primaryMeaning,
    ...over,
  };
}

describe('Web Reader engine bridge', () => {
  it('word with Vietnamese data: dictionary meanings first, no translation request', async () => {
    const translate = vi.fn(async (t: string) => `vi:${t}`);
    const b = createReaderBridge(deps({ translate }));
    const p = await b.lookup({ text: 'village', context: 'The village was destroyed by the demon.', mode: 'word' });
    expect(p.title).toBe('village');
    expect(p.pos?.some((x) => /danh từ/.test(x))).toBe(true);
    expect(p.meanings?.[0].vi).toMatch(/làng/);
    expect(p.saveable).toBe(true);
    expect(p.mt).toBeUndefined();
    expect(translate).not.toHaveBeenCalled();
  });
  it('word without Vietnamese data: machine translation of the lower-cased word, English definition as the cross-check', async () => {
    const translate = vi.fn(async (t: string) => `vi:${t}`);
    const b = createReaderBridge(deps({ translate }));
    const p = await b.lookup({ text: 'Photosynthesis', mode: 'word' });
    expect(translate).toHaveBeenCalledWith('photosynthesis');
    expect(p.mt).toBe('vi:photosynthesis');
    expect(p.mtLabel).toBe('Dịch máy');
    expect(p.english?.length).toBeGreaterThan(0);
  });
  it('sentence and paragraph: the guarded translation of exactly the chosen text', async () => {
    const translate = vi.fn(async (t: string) => `vi:${t}`);
    const b = createReaderBridge(deps({ translate }));
    const s = await b.lookup({ text: 'The village was destroyed by the demon.', mode: 'sentence' });
    expect(s).toMatchObject({ title: 'Bản dịch câu', mt: 'vi:The village was destroyed by the demon.' });
    const para = await b.lookup({ text: 'Run! I will hold them off. Go now.', mode: 'paragraph' });
    expect(para.title).toBe('Bản dịch đoạn');
    expect(translate).toHaveBeenCalledTimes(2);
  });
  it('API failures become an error card', async () => {
    const b = createReaderBridge(deps({ translate: async () => Promise.reject(new Error('Google Dịch trả lỗi 500')) }));
    const p = await b.lookup({ text: 'This will fail.', mode: 'sentence' });
    expect(p.error).toMatch(/500/);
  });
  it('non-English text is refused politely', async () => {
    const b = createReaderBridge(deps());
    const p = await b.lookup({ text: 'Xin', context: 'Xin chào các bạn', mode: 'word' });
    expect(p.title.length).toBeGreaterThan(0);
  });
  it('save: lemma + meaning go to the shared vocabulary; unknown words are not saved', async () => {
    const d = deps();
    const b = createReaderBridge(d);
    const ok = await b.save({ word: 'villages', context: 'Two villages burned.', url: 'https://example.com/ch1', title: 'Chapter 1' });
    expect(ok.ok).toBe(true);
    expect(d.saved[0]).toMatchObject({ lemma: 'village', sentence: 'Two villages burned.', sourceUrl: 'https://example.com/ch1' });
    expect((d.saved[0] as { meaning: string }).meaning).toMatch(/làng/);
    const bad = await b.save({ word: 'zzqxjv' });
    expect(bad.ok).toBe(false);
    expect(d.saved).toHaveLength(1);
  });
  it('OCR lines are grouped into speech bubbles like on the scan screen', () => {
    const w = (text: string, x: number, y: number) => ({ text, confidence: 95, box: { x, y, w: 0.3, h: 0.04 }, words: [{ text, confidence: 95, box: { x, y, w: 0.3, h: 0.04 } }] });
    const lines: OcrLine[] = [w("I'M GONNA BECOME", 0.1, 0.1), w('THE STRONGEST NINJA!', 0.1, 0.145), w('WHAT THE HELL IS GOING ON?!', 0.55, 0.7)];
    const blocks = createReaderBridge(deps()).ocrBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toMatch(/STRONGEST NINJA/);
    expect(blocks[0].box.w).toBeGreaterThan(0);
  });
});

describe('Web Reader and the usage guard (Google Translate web)', () => {
  const ok = (q: string) => ({ status: 200, text: async () => JSON.stringify([[['Google:' + q, q]], null, 'en']) });
  const CAPTCHA = { status: 429, text: async () => '<html><title>Sorry...</title>automated queries</html>' };
  async function guarded(respond: (q: string, n: number) => { status: number; text(): Promise<string> } = ok as never) {
    const sent: string[] = [];
    const webFetch: WebFetch = async (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      sent.push(q);
      return respond(q, sent.length);
    };
    const usage = new UsageService(memoryKV(), { webFetch, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {} } });
    await usage.activateGoogleWeb();
    // exactly what reader-install.ts / machineTranslate do with the outcome
    const translate = async (text: string) => {
      const r = await usage.translate(text);
      return r.source === 'google' ? r.text : 'device:' + text;
    };
    return { usage, translate, sent };
  }

  it('Reader translations are counted by the same usage meter and cached', async () => {
    const { usage, translate, sent } = await guarded();
    const b = createReaderBridge(deps({ translate }));
    await b.lookup({ text: 'The village was destroyed by the demon.', mode: 'sentence' });
    await b.lookup({ text: 'The village was destroyed by the demon.', mode: 'sentence' }); // cache hit
    const s = await usage.snapshot();
    expect(sent).toHaveLength(1);
    expect(s.usedChars).toBe('The village was destroyed by the demon.'.length);
    expect(s.requests).toBe(1);
    expect(s.cachedRequests).toBe(1);
  });
  it('when Google blocks the requests the Reader gets an error card, nothing more is sent, and the text is never shown as a translation', async () => {
    const { usage, translate, sent } = await guarded(() => CAPTCHA);
    const b = createReaderBridge(deps({ translate }));
    const first = await b.lookup({ text: 'Nobody survived the night, and the hero never came back.', mode: 'sentence' });
    expect(first.error).toMatch(/Google Dịch/);
    expect(first.mt).toBeUndefined();
    const second = await b.lookup({ text: 'Another sentence to translate.', mode: 'sentence' });
    expect(second.error).toBeDefined();
    expect(sent).toHaveLength(1); // the cooldown stopped the second request
    expect((await usage.snapshot()).usedChars).toBe(0);
  });
});
