/**
 * Usage accounting through the real chunk runner with Google Translate (web). The network is FAKE (nothing contacts Google).
 * What is checked: only SOURCE characters of SUCCESSFUL requests count, each chunk once; retries, failures, blocks and duplicates
 * never inflate the counters; on-device use has its own ledger.
 */
import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { UsageService, countChars } from '@/modules/usage';
import type { WebFetch } from '@/modules/usage/google-web';
import { planChunks } from '@/modules/translation';
import { translateLongText, type LongTextDeps } from '@/translation/long-text';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
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

const sentences = (n: number, tag = 'S') => Array.from({ length: n }, (_, i) => `${tag}${i + 1} is a sentence with some words, and it ends here.`).join(' ');
const CAPTCHA = { status: 429, text: async () => '<html><title>Sorry...</title>automated queries</html>' };
const SERVER_ERROR = { status: 503, text: async () => '' };

interface Opts {
  kv?: ReturnType<typeof memoryKV>;
  /** answer for the nth request (1-based): a status response, or undefined for a normal translation */
  respond?: (q: string, n: number) => { status: number; text(): Promise<string> } | undefined;
  delay?: number;
  clock?: () => Date;
  /** clock of the gate (cooldown) */
  gateNow?: () => number;
}
async function rig(o: Opts = {}) {
  const sends: string[] = [];
  const webFetch: WebFetch = async (url) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    const n = sends.push(q);
    if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
    const special = o.respond?.(q, n);
    if (special) return special;
    // the output is deliberately 3x longer than the input: only the SOURCE counts
    return { status: 200, text: async () => JSON.stringify([[[`VI[${q}]${'~'.repeat(q.length * 2)}`, q]], null, 'en']) };
  };
  const usage = new UsageService(o.kv ?? memoryKV(), { clock: o.clock, webFetch, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {}, now: o.gateNow, cooldownMs: 60_000 } });
  await usage.activateGoogleWeb();
  const deps: LongTextDeps = {
    googleActive: async () => true,
    sendGoogle: (text, x) => usage.translate(text, { idempotencyKey: x.idempotencyKey, keepBreaks: x.keepBreaks }),
    deviceTranslate: async (t) => `dev:${t}`,
    deviceProvider: 'device-chrome',
    reportDevice: (p, c, k) => usage.recordDeviceProcessed(p, c, k),
    completeOperation: (id) => usage.completeOperation(id),
  };
  return { usage, sends, deps };
}
const fast = { sleep: async () => {} };

describe('what is counted', () => {
  it('SOURCE characters, not the (longer) translated output', async () => {
    const { usage } = await rig();
    const r = await usage.translate('Hello world');
    expect(r).toMatchObject({ source: 'google' });
    if (r.source === 'google') expect(countChars(r.text)).toBeGreaterThan(30);
    expect((await usage.snapshot()).usedChars).toBe(11);
  });
  it('whitespace and punctuation count as sent (after normalisation)', async () => {
    const { usage } = await rig();
    await usage.translate('  Hello,   world!  '); // sent: "Hello, world!"
    expect((await usage.snapshot()).usedChars).toBe(13);
  });
  it('Unicode and Vietnamese are counted per code point', async () => {
    const { usage } = await rig();
    const text = 'Xin chào, thế giới! 😀👨‍👩‍👧';
    await usage.translate(text);
    expect((await usage.snapshot()).usedChars).toBe(countChars(text.normalize('NFC')));
    await usage.translate('Việt Nam'.normalize('NFD')); // sent as NFC → 8 code points
    expect((await usage.snapshot()).usedChars).toBe(countChars(text.normalize('NFC')) + 8);
  });
  it('each successful chunk of a long text counts exactly once; one job = one operation', async () => {
    const { usage, sends, deps } = await rig();
    const text = sentences(400);
    const plan = planChunks(text, { provider: 'google-web' });
    const r = await translateLongText(text, deps, fast);
    expect(r.complete).toBe(true);
    const s = await usage.snapshot();
    expect(sends).toHaveLength(plan.length);
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0));
    expect(s.requests).toBe(plan.length);
    expect(s.operations).toBe(1);
    expect(r.text).toContain('VI[');
  });
  it('chunks are sent in order and the result keeps that order', async () => {
    const { deps } = await rig();
    const text = Array.from({ length: 30 }, (_, i) => `Marker${String(i).padStart(3, '0')} ` + 'filler words go here. '.repeat(40)).join('\n\n');
    const r = await translateLongText(text, deps, fast);
    const found = [...r.text.matchAll(/Marker(\d{3})/g)].map((m) => Number(m[1]));
    expect(found).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
});

describe('retries, failures, blocks and duplicates never inflate the counter', () => {
  it('a transient server error is retried once by the gate: the chunk is counted once, no failure is recorded', async () => {
    const { usage, sends, deps } = await rig({ respond: (_q, n) => (n === 2 ? SERVER_ERROR : undefined) });
    const text = sentences(120);
    const plan = planChunks(text, { provider: 'google-web' });
    const r = await translateLongText(text, deps, fast);
    expect(r.complete).toBe(true);
    const s = await usage.snapshot();
    expect(sends).toHaveLength(plan.length + 1); // exactly one extra request
    expect(s.requests).toBe(plan.length);
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0));
    expect(s.failedRequests).toBe(0);
  });
  it('the SAME idempotency key is never counted twice (even when the cache no longer has the text)', async () => {
    const { usage } = await rig();
    await usage.translate('A chunk of text', { idempotencyKey: 'job:0' });
    await usage.protection.run(async () => usage.protection.clearCache()); // the cache forgot it
    await usage.translate('A chunk of text', { idempotencyKey: 'job:0' });
    expect((await usage.snapshot()).usedChars).toBe('A chunk of text'.length);
  });
  it('a block mid-job: earlier chunks are counted, the blocked one is a failure (no characters), nothing more is sent', async () => {
    const { usage, sends, deps } = await rig({ respond: (_q, n) => (n >= 3 ? CAPTCHA : undefined) });
    const r = await translateLongText(sentences(400), deps, fast);
    expect(r.complete).toBe(false);
    const s = await usage.snapshot();
    expect(sends).toHaveLength(3);
    expect(s.requests).toBe(2);
    expect(s.failedRequests).toBeGreaterThanOrEqual(1);
    expect(s.usedChars).toBe(r.chunks.slice(0, 2).reduce((n, c) => n + c.chars, 0));
    expect(s.operations).toBe(0); // an incomplete job is not an operation
  });
  it('"retry failed chunks" once the cooldown is over: the total counted = the sum of all chunks, once', async () => {
    let t = 1_000_000;
    let healthy = false;
    const { usage, deps } = await rig({ gateNow: () => t, respond: (_q, n) => (!healthy && n >= 3 ? CAPTCHA : undefined) });
    const text = sentences(400);
    const plan = planChunks(text, { provider: 'google-web' });
    const first = await translateLongText(text, deps, fast);
    expect(first.complete).toBe(false);
    t += 61_000; // cooldown over
    healthy = true;
    const second = await translateLongText(text, deps, { ...fast, retryFrom: first });
    expect(second.complete).toBe(true);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0));
    expect(s.requests).toBe(plan.length);
    expect(s.operations).toBe(1);
  });
  it('identical simultaneous requests share ONE request and one count', async () => {
    const { usage, sends } = await rig({ delay: 15 });
    await Promise.all(Array.from({ length: 5 }, () => usage.translate('same text here')));
    expect(sends).toHaveLength(1);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(14);
    expect(s.requests).toBe(1);
  });
  it('cancelling stops further requests; only the chunks that finished are counted; no operation is recorded', async () => {
    const ctl = new AbortController();
    const { usage, sends, deps } = await rig({ respond: (_q, n) => (n === 2 ? (ctl.abort(), undefined) : undefined) });
    const r = await translateLongText(sentences(400), deps, { ...fast, signal: ctl.signal });
    expect(r.cancelled).toBe(true);
    const s = await usage.snapshot();
    expect(s.requests).toBe(sends.length);
    expect(s.requests).toBeLessThan(r.chunks.length);
    expect(s.operations).toBe(0);
  });
  it('an operation is idempotent per job id', async () => {
    const { usage } = await rig();
    await usage.completeOperation('job-1');
    await usage.completeOperation('job-1');
    await usage.completeOperation('job-2');
    expect((await usage.snapshot()).operations).toBe(2);
  });
});

describe('providers have separate accounting', () => {
  it('the on-device provider has its own informational ledger; the Google web ledger is untouched', async () => {
    const { usage } = await rig();
    await usage.recordDeviceProcessed('device-chrome', 500, 'k1');
    await usage.recordDeviceProcessed('device-chrome', 500, 'k1'); // same key: once
    const snap = await usage.snapshot();
    expect(snap.provider).toBe('google-web');
    expect(snap.usedChars).toBe(0);
    const dev = snap.ledgers.find((l) => l.provider === 'device-chrome');
    expect(dev).toMatchObject({ chars: 500, requests: 1 });
  });
  it('switching the provider back to on-device stops all use of the network', async () => {
    const { usage, sends } = await rig();
    await usage.updateSettings({ provider: 'device' });
    expect(await usage.translate('hello world')).toEqual({ source: 'device' });
    expect(sends).toHaveLength(0);
  });
});
