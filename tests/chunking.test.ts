import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX,
  DEFAULT_TARGET,
  TextTooLargeError,
  TranslationError,
  joinSources,
  mergeChunks,
  planChunks,
  retryFailedChunks,
  splitIntoChunks,
  translateLong,
  utf8Bytes,
  type JobProgress,
} from '@/modules/translation';

const cp = (s: string) => Array.from(s).length;
const sentences = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} is here, and it says something useful.`).join(' ');
const vn = (n: number) => Array.from({ length: n }, (_, i) => `Câu số ${i + 1} nói rằng tiếng Việt có dấu thanh như ắ, ề, ổ, ữ, ị.`).join(' ');

describe('splitting', () => {
  it('short text is one chunk, unchanged', () => {
    const c = splitIntoChunks('Hello world.');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ index: 0, source: 'Hello world.', prefix: '', suffix: '', chars: 12 });
  });
  it('empty and whitespace-only input make no chunk', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks(' \n\t  ')).toEqual([]);
  });
  it('splits at sentence boundaries, near the target, never above the limit', () => {
    const text = sentences(400); // ≈ 20,000 chars
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    chunks.forEach((c, i) => {
      expect(c.chars).toBeLessThanOrEqual(DEFAULT_MAX);
      if (i < chunks.length - 1) {
        expect(c.source.endsWith('.')).toBe(true); // ends on a sentence
        expect(c.chars).toBeGreaterThan(DEFAULT_TARGET * 0.5);
        expect(c.chars).toBeLessThanOrEqual(DEFAULT_TARGET + 100);
      }
    });
  });
  it('prefers paragraph boundaries', () => {
    const para = (n: number) => Array.from({ length: 45 }, (_, i) => `Paragraph ${n} sentence ${i} has a few words in it.`).join(' '); // ≈ 2,200 chars
    const text = [1, 2, 3, 4, 5, 6].map(para).join('\n\n');
    const chunks = splitIntoChunks(text);
    for (const c of chunks.slice(0, -1)) expect(c.suffix).toMatch(/\n\n/);
    expect(joinSources(chunks)).toBe(text);
  });
  it('is LOSSLESS: nothing dropped, nothing duplicated, whitespace and order kept', () => {
    const samples = [sentences(300), vn(300), '  leading\n\n' + sentences(150) + '\n\n\ntrailing  ', 'a'.repeat(23_000), '日本語の文章です。'.repeat(2000), '😀 emoji 👨‍👩‍👧 mix. '.repeat(1500), 'x. '.repeat(9000)];
    for (const text of samples) {
      const chunks = splitIntoChunks(text);
      expect(joinSources(chunks)).toBe(text);
      expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
      chunks.forEach((c) => expect(c.chars).toBeLessThanOrEqual(DEFAULT_MAX));
      expect(mergeChunks(chunks, chunks.map((c) => c.source))).toBe(text);
    }
  });
  it('random inputs always round-trip', () => {
    const pool = ['a', 'b', ' ', ' ', '\n', '\n\n', '.', '. ', '!', '? ', ',', ';', 'ắ', 'ề', '😀', '日', '本', '́', '‍', '"', ')'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let run = 0; run < 60; run++) {
      const text = Array.from({ length: 200 + Math.floor(rnd() * 15_000) }, () => pool[Math.floor(rnd() * pool.length)]).join('');
      const chunks = splitIntoChunks(text, { target: 300 + Math.floor(rnd() * 600), max: 1000 });
      expect(joinSources(chunks)).toBe(text);
      chunks.forEach((c) => expect(c.chars).toBeLessThanOrEqual(1000));
    }
  });
  it('Vietnamese: composed and decomposed (NFD) text is never cut inside a letter', () => {
    const nfd = vn(500).normalize('NFD');
    const chunks = splitIntoChunks(nfd);
    chunks.forEach((c) => {
      expect(/^\p{M}/u.test(c.source)).toBe(false);
      expect(/\p{M}$/u.test(c.prefix)).toBe(false);
    });
    expect(joinSources(chunks)).toBe(nfd);
    // an unbreakable run of letters with combining marks (hard cut) still never separates a mark from its letter
    const run = 'á'.repeat(12_000);
    for (const c of splitIntoChunks(run)) expect(c.source.startsWith('́')).toBe(false);
  });
  it('emoji and ZWJ sequences stay whole; length is counted in code points', () => {
    const fam = '👨‍👩‍👧'; // 5 code points
    expect(cp(fam)).toBe(5);
    const text = fam.repeat(4000); // 20,000 code points, no spaces: hard cuts
    const chunks = splitIntoChunks(text);
    chunks.forEach((c) => {
      expect(c.source.startsWith('‍')).toBe(false);
      expect(c.source.endsWith('‍')).toBe(false);
      expect(c.chars).toBe(cp(c.source));
      expect(c.chars).toBeLessThanOrEqual(DEFAULT_MAX);
    });
    expect(joinSources(chunks)).toBe(text);
    expect(splitIntoChunks('😀'.repeat(10))[0].chars).toBe(10); // 20 UTF-16 units, 10 code points
  });
  it('a very long document (400,000 characters) is split quickly and completely', () => {
    const text = sentences(8000); // ≈ 400,000 chars
    const t0 = Date.now();
    const chunks = splitIntoChunks(text);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(joinSources(chunks)).toBe(text);
    expect(chunks.length).toBeGreaterThan(70);
  });
  it('the chunk size also respects a provider BYTE limit (4-byte emoji)', () => {
    const chunks = planChunks('😀 '.repeat(2000), { limits: { maxBytes: 400, maxChars: 5000, targetChars: 4800 } });
    chunks.forEach((c) => expect(utf8Bytes(c.source)).toBeLessThanOrEqual(400));
  });
  it('different providers use their own limits', () => {
    const text = sentences(300);
    const google = planChunks(text, { provider: 'google-v2' });
    const small = planChunks(text, { provider: 'google-v2', limits: { targetChars: 1000, maxChars: 1200 } });
    expect(Math.max(...google.map((c) => c.chars))).toBeLessThanOrEqual(5000);
    expect(Math.max(...small.map((c) => c.chars))).toBeLessThanOrEqual(1200);
    expect(small.length).toBeGreaterThan(google.length * 3);
  });
  it('input above the application safety limit is refused, never silently cut', () => {
    expect(() => planChunks('x'.repeat(600), { maxTotalChars: 500 })).toThrow(TextTooLargeError);
  });
});

const noSleep = async () => {};
const upper = async (s: string) => s.toUpperCase();

describe('running a long job', () => {
  it('translates every chunk and merges them in order', async () => {
    const text = sentences(200);
    const r = await translateLong(text, upper, { provider: 'google-v2', sleep: noSleep });
    expect(r.complete).toBe(true);
    expect(r.text).toBe(text.toUpperCase());
    expect(r.failedIndexes).toEqual([]);
    expect(r.chunks.length).toBeGreaterThan(1);
  });
  it('keeps the order even when chunks finish out of order (concurrency)', async () => {
    const text = sentences(300);
    const order: number[] = [];
    const r = await translateLong(
      text,
      async (s, ctx) => {
        await new Promise((res) => setTimeout(res, (ctx.total - ctx.index) * 4)); // later chunks finish FIRST
        order.push(ctx.index);
        return s.toUpperCase();
      },
      { provider: 'google-v2', concurrency: 4, sleep: noSleep },
    );
    expect(order).not.toEqual([...order].sort((a, b) => a - b));
    expect(r.text).toBe(text.toUpperCase());
  });
  it('respects the concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    await translateLong(
      sentences(300),
      async (s) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 3));
        running--;
        return s;
      },
      { concurrency: 3, sleep: noSleep },
    );
    expect(peak).toBe(3);
    let seq = 0;
    await translateLong(sentences(300), async (s) => {
      seq++;
      await new Promise((r) => setTimeout(r, 1));
      seq--;
      expect(seq).toBe(0);
      return s;
    }, { concurrency: 1, sleep: noSleep });
  });
  it('reports progress in real time', async () => {
    const events: JobProgress[] = [];
    const text = sentences(250);
    const r = await translateLong(text, upper, { sleep: noSleep, onProgress: (p) => events.push({ ...p }) });
    expect(events[0].completed).toBe(0);
    const completed = events.map((e) => e.completed);
    expect([...completed].sort((a, b) => a - b)).toEqual(completed); // never goes backwards
    const last = events[events.length - 1];
    expect(last).toMatchObject({ status: 'done', total: r.chunks.length, completed: r.chunks.length, failed: 0, charsDone: last.charsTotal });
    expect(last.charsTotal).toBe(r.chunks.reduce((n, c) => n + c.chars, 0));
  });
  it('empty input needs no request', async () => {
    let calls = 0;
    const r = await translateLong('   ', async (s) => (calls++, s));
    expect(calls).toBe(0);
    expect(r.complete).toBe(true);
  });
});

describe('retries are per chunk', () => {
  it('a flaky chunk is retried alone, with the SAME idempotency key, and the job completes', async () => {
    const text = sentences(250);
    const calls = new Map<number, number>();
    const keys = new Map<number, Set<string>>();
    const r = await translateLong(
      text,
      async (s, ctx) => {
        calls.set(ctx.index, (calls.get(ctx.index) ?? 0) + 1);
        keys.set(ctx.index, (keys.get(ctx.index) ?? new Set()).add(ctx.idempotencyKey));
        if (ctx.index === 1 && ctx.attempt < 3) throw new Error('503 temporarily unavailable');
        return s.toUpperCase();
      },
      { sleep: noSleep },
    );
    expect(r.complete).toBe(true);
    expect(calls.get(1)).toBe(3);
    for (const [i, n] of calls) if (i !== 1) expect(n).toBe(1); // the other chunks were not repeated
    expect(keys.get(1)!.size).toBe(1);
    expect(r.outcomes[1].attempts).toBe(3);
  });
  it('after the retries are used up the job is PARTIAL: good chunks kept, failed chunk keeps its source, listed', async () => {
    const text = sentences(250);
    const r = await translateLong(text, async (s, ctx) => (ctx.index === 1 ? Promise.reject(new Error('boom')) : s.toUpperCase()), { sleep: noSleep, maxRetries: 1 });
    expect(r.complete).toBe(false);
    expect(r.failedIndexes).toEqual([1]);
    expect(r.outcomes[1]).toMatchObject({ status: 'failed', attempts: 2, error: 'boom' });
    const merged = mergeChunks(r.chunks, r.outcomes.map((o) => o.translated));
    expect(r.text).toBe(merged);
    expect(r.text).toContain(r.chunks[1].source); // the failed part is still there, untranslated
    expect(r.text).toContain(r.chunks[0].source.toUpperCase());
  });
  it('"retry failed chunks" re-runs only those, reusing their keys, and completes the result', async () => {
    const text = sentences(250);
    const seen: { index: number; key: string }[] = [];
    let healthy = false;
    const tr = async (s: string, ctx: { index: number; idempotencyKey: string }) => {
      seen.push({ index: ctx.index, key: ctx.idempotencyKey });
      if (ctx.index === 2 && !healthy) throw new Error('down');
      return s.toUpperCase();
    };
    const first = await translateLong(text, tr, { sleep: noSleep, maxRetries: 0 });
    expect(first.failedIndexes).toEqual([2]);
    const keyOfFailed = first.outcomes[2].idempotencyKey;
    healthy = true;
    seen.length = 0;
    const second = await retryFailedChunks(first, tr, { sleep: noSleep });
    expect(seen).toEqual([{ index: 2, key: keyOfFailed }]);
    expect(second.complete).toBe(true);
    expect(second.text).toBe(text.toUpperCase());
    expect(second.jobId).toBe(first.jobId);
  });
  it('backoff grows exponentially and Retry-After is honoured', async () => {
    const waits: number[] = [];
    let n = 0;
    await translateLong('One short sentence.', async (s) => {
      if (++n < 3) throw new Error('retry me');
      return s;
    }, { sleep: async (ms) => void waits.push(ms), random: () => 1, backoffMs: 400 });
    expect(waits).toEqual([400, 800]);
    const w2: number[] = [];
    let m = 0;
    await translateLong('One short sentence.', async (s) => {
      if (++m < 2) throw new TranslationError('429', { retryAfterMs: 1234 });
      return s;
    }, { sleep: async (ms) => void w2.push(ms) });
    expect(w2).toEqual([1234]);
  });
  it('a non-retryable error is not retried; a fatal one (quota / key) stops the job and skips the rest', async () => {
    let calls = 0;
    const r1 = await translateLong(sentences(250), async (s, ctx) => (calls++, ctx.index === 0 ? Promise.reject(new TranslationError('bad chunk', { retryable: false })) : s), { sleep: noSleep, concurrency: 1 });
    expect(r1.outcomes[0].attempts).toBe(1);
    expect(r1.outcomes.slice(1).every((o) => o.status === 'done')).toBe(true);
    calls = 0;
    const r2 = await translateLong(sentences(250), async () => (calls++, Promise.reject(new TranslationError('blocked', { fatal: true, code: 'consent-needed' }))), { sleep: noSleep, concurrency: 1 });
    expect(calls).toBe(1); // nothing else is sent after a fatal answer
    expect(r2.outcomes[0].errorCode).toBe('consent-needed');
    expect(r2.outcomes.slice(1).every((o) => o.status === 'skipped')).toBe(true);
    expect(r2.complete).toBe(false);
  });
});

describe('cancellation', () => {
  it('stops scheduling, keeps what finished, marks the rest cancelled', async () => {
    const ac = new AbortController();
    const started: number[] = [];
    const r = await translateLong(
      sentences(300),
      async (s, ctx) => {
        started.push(ctx.index);
        if (ctx.index === 1) {
          ac.abort();
          await new Promise((res) => setTimeout(res, 5));
        }
        return s.toUpperCase();
      },
      { sleep: noSleep, concurrency: 1, signal: ac.signal },
    );
    expect(r.cancelled).toBe(true);
    expect(r.complete).toBe(false);
    expect(started).toEqual([0, 1]); // chunk 2 and later never started
    expect(r.outcomes[0].status).toBe('done');
    expect(r.outcomes[1].status).toBe('cancelled');
    expect(r.outcomes.slice(2).every((o) => o.status === 'cancelled')).toBe(true);
  });
  it('already-cancelled input sends nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    const r = await translateLong(sentences(100), async (s) => (calls++, s), { signal: ac.signal, sleep: noSleep });
    expect(calls).toBe(0);
    expect(r.cancelled).toBe(true);
  });
  it('cancelling while waiting to retry ends promptly', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = translateLong('One short sentence.', async () => Promise.reject(new Error('flaky')), { signal: ac.signal, backoffMs: 60_000, random: () => 1 });
    setTimeout(() => ac.abort(), 20);
    const r = await p;
    expect(r.cancelled).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
