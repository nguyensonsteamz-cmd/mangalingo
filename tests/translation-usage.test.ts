import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { MemorySecretStore } from '@/modules/smart-setup';
import { UsageService, countChars, type UsageSettings } from '@/modules/usage';
import type { FetchLike } from '@/modules/usage/google';
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

const KEY = 'AIza' + 'u'.repeat(35);
const sentences = (n: number, tag = 'S') => Array.from({ length: n }, (_, i) => `${tag}${i + 1} is a sentence with some words, and it ends here.`).join(' ');

interface Opts {
  kv?: ReturnType<typeof memoryKV>;
  clock?: () => Date;
  /** make the nth provider call fail (n = 1-based call number across the rig) */
  fail?: (q: string, call: number) => number | false;
  delay?: number;
  credential?: string;
}
async function rig(over: Partial<UsageSettings> = {}, o: Opts = {}) {
  const sends: string[] = [];
  const fetchImpl: FetchLike = async (_u, init) => {
    const q = (JSON.parse(init.body) as { q: string }).q;
    const n = sends.push(q);
    if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
    const status = o.fail?.(q, n);
    if (status) return { ok: false, status, json: async () => ({ error: { message: 'provider says no' } }) };
    // the output is deliberately 3x longer than the input: only the SOURCE counts
    return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: `VI[${q}]${'~'.repeat(q.length * 2)}` }] } }) };
  };
  const usage = new UsageService(o.kv ?? memoryKV(), { clock: o.clock, fetchImpl, secrets: new MemorySecretStore() });
  await usage.updateSettings({ freeQuotaChars: 10_000_000, maxCharsPerRequest: 5000, ...over });
  await usage.activateGoogle(KEY, o.credential ?? 'proj-A');
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
    expect(countChars(text.normalize('NFC'))).toBe(26); // 19 letters / marks + space + 😀 + 5 for the ZWJ family
    expect((await usage.snapshot()).usedChars).toBe(26);
    const decomposed = 'Việt Nam'.normalize('NFD'); // sent as NFC → 8 code points
    await usage.translate(decomposed);
    expect((await usage.snapshot()).usedChars).toBe(26 + 8);
  });
  it('each successful chunk of a long text counts exactly once; one job = one operation', async () => {
    const { usage, sends, deps } = await rig();
    const text = sentences(400);
    const plan = planChunks(text, { provider: 'google-v2' });
    const r = await translateLongText(text, deps, fast);
    expect(r.complete).toBe(true);
    const s = await usage.snapshot();
    expect(sends).toHaveLength(plan.length);
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0));
    expect(s.requests).toBe(plan.length);
    expect(s.operations).toBe(1);
    expect(r.text).toContain('VI[');
  });
  it('chunks go to the provider in order and the result keeps that order', async () => {
    const { deps } = await rig();
    const text = Array.from({ length: 60 }, (_, i) => `Marker${String(i).padStart(3, '0')} ` + 'filler words go here. '.repeat(40)).join('\n\n');
    const r = await translateLongText(text, deps, { ...fast, concurrency: 4 });
    const found = [...r.text.matchAll(/Marker(\d{3})/g)].map((m) => Number(m[1]));
    expect(found).toEqual(Array.from({ length: 60 }, (_, i) => i));
  });
});

describe('retries, failures and duplicates never inflate the counter', () => {
  it('failed attempts are not counted; a chunk that succeeds on the 3rd try is counted once', async () => {
    const { usage, deps } = await rig({}, { fail: (_q, n) => (n === 2 || n === 3 ? 503 : false) });
    const text = sentences(250);
    const plan = planChunks(text, { provider: 'google-v2' });
    const r = await translateLongText(text, deps, { ...fast, concurrency: 1 });
    expect(r.complete).toBe(true);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0)); // exactly the sum of the chunks
    expect(s.requests).toBe(plan.length);
    expect(s.failedRequests).toBe(2); // informational
  });
  it('the SAME idempotency key is never counted twice (even when the cache no longer has the text)', async () => {
    const { usage } = await rig();
    await usage.translate('Counted once please.', { idempotencyKey: 'job-1:0:abc' });
    usage.protection.clearCache();
    const again = await usage.translate('Counted once please.', { idempotencyKey: 'job-1:0:abc' });
    expect(again).toMatchObject({ source: 'google' });
    expect((await usage.snapshot()).usedChars).toBe(20);
    usage.protection.clearCache();
    await usage.translate('Counted once please.', { idempotencyKey: 'job-2:0:abc' }); // a different job IS new usage
    expect((await usage.snapshot()).usedChars).toBe(40);
  });
  it('"retry failed chunks" after a partial failure: total counted = the sum of all chunks, once', async () => {
    let healthy = false;
    const { usage, deps } = await rig({}, { fail: (_q, n) => (!healthy && n >= 3 ? 400 : false) });
    const text = sentences(400);
    const plan = planChunks(text, { provider: 'google-v2' });
    const first = await translateLongText(text, deps, { ...fast, concurrency: 1, maxRetries: 0 });
    expect(first.complete).toBe(false);
    const countedBefore = (await usage.snapshot()).usedChars;
    expect(countedBefore).toBeLessThan(plan.reduce((n, c) => n + c.chars, 0));
    expect((await usage.snapshot()).operations).toBe(0); // an unfinished job is not an operation
    healthy = true;
    const second = await translateLongText(text, deps, { ...fast, retryFrom: first });
    expect(second.complete).toBe(true);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(plan.reduce((n, c) => n + c.chars, 0));
    expect(s.operations).toBe(1);
  });
  it('identical simultaneous requests share ONE provider call and one count', async () => {
    const { usage, sends } = await rig({}, { delay: 15 });
    const rs = await Promise.all(Array.from({ length: 8 }, () => usage.translate('Same sentence everywhere.')));
    expect(sends).toHaveLength(1);
    expect(rs.every((r) => r.source === 'google')).toBe(true);
    expect((await usage.snapshot()).usedChars).toBe(25);
  });
  it('cancelling stops further requests; only the chunks that finished are counted; no operation is recorded', async () => {
    const { usage, deps } = await rig({}, { delay: 10 });
    const ac = new AbortController();
    const text = sentences(500);
    const p = translateLongText(text, deps, { ...fast, concurrency: 1, signal: ac.signal });
    setTimeout(() => ac.abort(), 35);
    const r = await p;
    expect(r.cancelled).toBe(true);
    const done = r.outcomes.filter((o) => o.status === 'done');
    const s = await usage.snapshot();
    expect(done.length).toBeGreaterThan(0);
    expect(s.usedChars).toBeGreaterThanOrEqual(done.reduce((n, o) => n + o.chars, 0));
    expect(s.usedChars).toBeLessThan(planChunks(text, { provider: 'google-v2' }).reduce((n, c) => n + c.chars, 0));
    expect(s.operations).toBe(0);
  });
  it('an operation is idempotent per job id', async () => {
    const { usage } = await rig();
    await usage.completeOperation('job-x');
    await usage.completeOperation('job-x');
    expect((await usage.snapshot()).operations).toBe(1);
  });
});

describe('quota, reservations and concurrency', () => {
  it('a quota block in the middle of a job is fatal: earlier chunks counted, nothing more is sent, the reason is kept', async () => {
    const { usage, sends, deps } = await rig({ freeQuotaChars: 9000 });
    const r = await translateLongText(sentences(400), deps, { ...fast, concurrency: 1 });
    expect(r.complete).toBe(false);
    const failed = r.outcomes.find((o) => o.status === 'failed')!;
    expect(failed.errorCode).toBe('consent-needed');
    expect(r.outcomes.filter((o) => o.status === 'skipped').length).toBeGreaterThan(0);
    const s = await usage.snapshot();
    expect(s.usedChars).toBeLessThanOrEqual(9000);
    expect(sends.length).toBe(r.outcomes.filter((o) => o.status === 'done').length); // the blocked chunk was never sent
  });
  it('simultaneous requests cannot overshoot the quota', async () => {
    const { usage, sends } = await rig({ freeQuotaChars: 1000 }, { delay: 5 });
    const texts = Array.from({ length: 30 }, (_, i) => `t${i} `.padEnd(100, 'x'));
    const rs = await Promise.all(texts.map((t) => usage.translate(t)));
    expect(rs.filter((r) => r.source === 'google')).toHaveLength(10);
    expect(rs.filter((r) => r.source === 'blocked')).toHaveLength(20);
    expect(sends).toHaveLength(10);
    expect((await usage.snapshot()).usedChars).toBe(1000);
  });
  it('under mixed success / failure the total equals the sum of the SUCCESSFUL requests, never more', async () => {
    const { usage } = await rig({}, { delay: 2, fail: (q) => (/^t[0-9]*[05] /.test(q) ? 503 : false) });
    const texts = Array.from({ length: 40 }, (_, i) => `t${i} `.padEnd(50 + i, 'y'));
    const rs = await Promise.allSettled(texts.map((t) => usage.translate(t)));
    const okTexts = texts.filter((_, i) => rs[i].status === 'fulfilled');
    expect(okTexts.length).toBeGreaterThan(10);
    expect(okTexts.length).toBeLessThan(40);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(okTexts.reduce((n, t) => n + countChars(t.trim()), 0));
    expect(s.requests).toBe(okTexts.length);
    expect(s.failedRequests).toBe(40 - okTexts.length);
  });
  it('a failed request releases its reservation: the quota is available again', async () => {
    const { usage } = await rig({ freeQuotaChars: 1000 }, { delay: 5, fail: (q) => (q.startsWith('f') ? 503 : false) });
    const bad = Array.from({ length: 5 }, (_, i) => `f${i}`.padEnd(100, 'z'));
    const good = Array.from({ length: 5 }, (_, i) => `g${i}`.padEnd(100, 'z'));
    await Promise.allSettled([...bad, ...good].map((t) => usage.translate(t)));
    // 500 reserved by the failures went back: five more 100-char requests fit
    const more = await Promise.all(Array.from({ length: 5 }, (_, i) => usage.translate(`h${i}`.padEnd(100, 'z'))));
    expect(more.every((r) => r.source === 'google')).toBe(true);
    expect((await usage.snapshot()).usedChars).toBe(1000);
  });
});

describe('providers and credentials have separate accounting', () => {
  it('the on-device provider has its own informational ledger; the Google ledger is untouched', async () => {
    const { usage, deps } = await rig();
    const dev: LongTextDeps = { ...deps, googleActive: async () => false };
    const text = sentences(250);
    const r = await translateLongText(text, dev, fast);
    expect(r.complete).toBe(true);
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(0);
    expect(s.requests).toBe(0);
    const device = s.ledgers.find((l) => l.provider === 'device-chrome')!;
    expect(device.chars).toBe(planChunks(text, { provider: 'device-chrome' }).reduce((n, c) => n + c.chars, 0));
    expect(device.credentialId).toBe('local');
  });
  it('a different API credential is a different ledger (history of the old one is kept); the same project keeps its ledger', async () => {
    const { usage } = await rig({}, { credential: 'proj-A' });
    await usage.translate('Under project A.');
    expect((await usage.snapshot()).usedChars).toBe(16);
    await usage.activateGoogle('AIza' + 'v'.repeat(35), 'proj-A'); // replaced key, same project
    expect((await usage.snapshot()).usedChars).toBe(16);
    await usage.activateGoogle('AIza' + 'w'.repeat(35), 'proj-B'); // another project
    const s = await usage.snapshot();
    expect(s.credentialId).toBe('proj-B');
    expect(s.usedChars).toBe(0);
    expect(s.ledgers.map((l) => `${l.provider}|${l.credentialId}|${l.chars}`).sort()).toEqual(['google-v2|proj-A|16']);
  });
  it('a manually entered key gets a short hash id that does not reveal the key', async () => {
    const { usage } = await rig();
    const key = 'AIza' + 'k'.repeat(35);
    await usage.setApiKey(key);
    const s = await usage.snapshot();
    expect(s.credentialId).toMatch(/^key-[0-9a-f]{8}$/);
    expect(JSON.stringify(s)).not.toContain(key);
  });
  it('BYOK only: every ledger says so (there is no shared-key mode and no client-side "authoritative" counter)', async () => {
    const { usage } = await rig();
    await usage.translate('byok only');
    const s = await usage.snapshot();
    expect(s.mode).toBe('byok');
    expect(s.ledgers.every((l) => l.mode === 'byok')).toBe(true);
  });
});

describe('thresholds 80 / 90 / 100 %', () => {
  it.each([
    [790, 'ok'],
    [800, 'notice'],
    [890, 'notice'],
    [900, 'critical'],
    [990, 'critical'],
    [1000, 'blocked'],
  ])('%i of 1000 characters -> %s', async (used, level) => {
    const { usage } = await rig({ freeQuotaChars: 1000 });
    if (used) await usage.translate('x'.repeat(used));
    const s = await usage.snapshot();
    expect(s.usedChars).toBe(used);
    expect(s.level).toBe(level);
  });
  it('the thresholds are configurable', async () => {
    const { usage } = await rig({ freeQuotaChars: 1000, warnRatio: 0.5, criticalRatio: 0.6, hardStopRatio: 0.7 });
    await usage.translate('x'.repeat(650));
    expect((await usage.snapshot()).level).toBe('critical');
    await usage.translate('y'.repeat(50)); // 700 = the (configured) hard stop
    expect((await usage.snapshot()).level).toBe('blocked');
  });
  it('after the quota is reached nothing is silently charged: the reason is explained and the alternatives named', async () => {
    const { usage } = await rig({ freeQuotaChars: 100 });
    await usage.translate('x'.repeat(100));
    const r = await usage.translate('one more');
    expect(r.source).toBe('blocked');
    if (r.source === 'blocked') {
      expect(r.decision).toMatchObject({ reason: 'consent-needed', needsConsent: true });
      expect(r.decision.message).toMatch(/dịch máy trên thiết bị/);
      expect(r.decision.message).toMatch(/khoá API khác/);
    }
    expect((await usage.getSettings()).provider).toBe('google'); // the provider was NOT switched behind the user's back
  });
});

describe('monthly period (UTC)', () => {
  it('resets at 00:00:00 UTC on the 1st, keeps the history per ledger, shows the next reset', async () => {
    let now = new Date('2026-01-31T23:59:59Z');
    const { usage } = await rig({}, { clock: () => now });
    await usage.translate('January text');
    let s = await usage.snapshot();
    expect(s).toMatchObject({ month: '2026-01', usedChars: 12, nextReset: '2026-02-01', nextResetAt: '2026-02-01T00:00:00Z' });
    now = new Date('2026-02-01T00:00:00Z'); // the very instant
    s = await usage.snapshot();
    expect(s).toMatchObject({ month: '2026-02', usedChars: 0, lastReset: '2026-02-01', nextResetAt: '2026-03-01T00:00:00Z' });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ month: '2026-01', provider: 'google-v2', credentialId: 'proj-A', chars: 12 });
  });
  it('the boundary is the same in every time zone (it is an instant, not a local date)', async () => {
    // 23:30 on 31 Jan in New York is already Feb 1 in UTC; 08:30 on 1 Feb in Tokyo is still Jan 31 in UTC
    let now = new Date('2026-02-01T04:30:00-05:00');
    const { usage } = await rig({}, { clock: () => now });
    await usage.translate('Feb text');
    expect((await usage.snapshot()).month).toBe('2026-02');
    now = new Date('2026-01-31T23:30:00Z');
    // moving the clock backwards (time-zone change) never resets or loses data
    expect(await usage.snapshot()).toMatchObject({ month: '2026-02', usedChars: 8 });
  });
  it('rollover never deletes history and December rolls into the next year', async () => {
    let now = new Date('2026-12-31T23:00:00Z');
    const { usage } = await rig({}, { clock: () => now });
    await usage.translate('December');
    now = new Date('2027-01-01T00:00:01Z');
    await usage.translate('January');
    now = new Date('2027-02-01T00:00:00Z');
    const s = await usage.snapshot();
    expect(s.history.map((h) => [h.month, h.chars])).toEqual([['2026-12', 8], ['2027-01', 7]]);
  });
  it('a stored v1 state (one counter, local month) is migrated into the Google ledger of the default credential', async () => {
    const kv = memoryKV();
    await kv.set({
      'usage:v1': {
        version: 1,
        month: '2026-03',
        lastReset: '2026-03-01',
        monthly: { month: '2026-03', chars: 1234, requests: 7, cachedRequests: 2, cachedChars: 40, failedRequests: 1, paidChars: 0, paidRequests: 0 },
        day: { date: '2026-03-10', paidRequests: 0 },
        history: [{ month: '2026-02', chars: 999, requests: 5, cachedRequests: 0, cachedChars: 0, failedRequests: 0, paidChars: 0, paidRequests: 0 }],
        log: [{ t: 1, chars: 5, kind: 'billed' }],
      },
    });
    const usage = new UsageService(kv, { clock: () => new Date('2026-03-20T12:00:00Z'), secrets: new MemorySecretStore() });
    await usage.activateGoogle(KEY); // default credential id is a hash: the old numbers live under "default"
    await usage.repo.setCredentialId('default');
    const s = await usage.snapshot();
    expect(s).toMatchObject({ usedChars: 1234, requests: 7, cachedRequests: 2, operations: 7, provider: 'google-v2' });
    expect(s.history[0]).toMatchObject({ month: '2026-02', chars: 999 });
    expect(s.log[0].kind).toBe('success');
  });
});

describe('estimated cost and quota ownership', () => {
  it('the cost estimate is shown only for a metered provider with a price', async () => {
    const { usage } = await rig({ freeQuotaChars: 100, paidEnabled: true, pricePerMillionUsd: 20 });
    await usage.translate('x'.repeat(100));
    await usage.translate('y'.repeat(50));
    const s = await usage.snapshot();
    expect(s).toMatchObject({ costReliable: true, billableChars: 50 });
    expect(s.estimatedCostUsd).toBeCloseTo(0.001, 8);
    await usage.updateSettings({ pricePerMillionUsd: 0 });
    expect((await usage.snapshot()).costReliable).toBe(false);
  });
});

describe('Vietnamese → English through Google BYOK (same quota, own direction)', () => {
  it('sends the request in the right direction and counts the SOURCE characters once, in the same monthly ledger', async () => {
    const { usage } = await rig();
    const dirs: string[] = [];
    const orig = (usage as unknown as { fetchImpl: FetchLike }).fetchImpl;
    (usage as unknown as { fetchImpl: FetchLike }).fetchImpl = async (u, init) => {
      const b = JSON.parse(init.body) as { source: string; target: string };
      dirs.push(`${b.source}>${b.target}`);
      return orig(u, init);
    };
    const r = await usage.translate('Xin chào các bạn', { languagePair: 'vi>en' });
    expect(r).toMatchObject({ source: 'google' });
    expect(dirs).toEqual(['vi>en']);
    expect((await usage.snapshot()).usedChars).toBe(countChars('Xin chào các bạn'));
  });

  it('the same text in the other direction is NOT served from the cache of this direction (and both count)', async () => {
    const { usage, sends } = await rig();
    await usage.translate('Hello', { languagePair: 'en>vi' });
    await usage.translate('Hello', { languagePair: 'vi>en' });
    await usage.translate('Hello', { languagePair: 'vi>en' }); // now a cache hit
    expect(sends).toHaveLength(2);
    expect((await usage.snapshot()).usedChars).toBe(10);
  });

  it('retry with the same idempotency key counts once (vi→en)', async () => {
    const { usage } = await rig();
    await usage.translate('Tôi yêu Việt Nam', { languagePair: 'vi>en', idempotencyKey: 'job:0:abc' });
    await usage.translate('Tôi yêu Việt Nam', { languagePair: 'vi>en', idempotencyKey: 'job:0:abc' });
    expect((await usage.snapshot()).usedChars).toBe(countChars('Tôi yêu Việt Nam'));
  });
});
