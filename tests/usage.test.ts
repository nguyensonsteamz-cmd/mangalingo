import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { UsageService, countChars, normalizeText, DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from '@/modules/usage';
import type { WebFetch } from '@/modules/usage/google-web';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    quota: 10 * 1024 * 1024,
    async get<T>(k: string) {
      const v = data.get(k);
      return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
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
    onChange() {
      return () => {};
    },
  };
}

/** A service in Google Translate (web) mode with a fake network (nothing here contacts Google). */
async function setup(opts: { kv?: ReturnType<typeof memoryKV>; now?: () => Date } = {}) {
  const kv = opts.kv ?? memoryKV();
  const sent: string[] = [];
  const webFetch: WebFetch = async (url) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    sent.push(q);
    return { status: 200, text: async () => JSON.stringify([[['vi:' + q, q]], null, 'en']) };
  };
  const svc = new UsageService(kv, { clock: opts.now, webFetch, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {} } });
  await svc.activateGoogleWeb();
  return { svc, kv, sent };
}
const text = (n: number, tag = 'a') => (tag + 'x'.repeat(n)).slice(0, n);

describe('character counting (Unicode code points)', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countChars('abc')).toBe(3);
    expect(countChars('😀')).toBe(1); // 2 UTF-16 units, 1 code point
    expect(countChars('Việt Nam')).toBe(8);
    expect(countChars('👨‍👩‍👧')).toBe(5); // 3 emoji + 2 zero-width joiners
    expect(countChars('')).toBe(0);
  });
  it('normalises before counting: NFC, collapsed whitespace, trimmed', () => {
    expect(countChars(normalizeText('é'))).toBe(1); // e + combining acute -> é
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
    expect(countChars(normalizeText('  hello   world  '))).toBe(11);
  });
});

describe('settings: only the providers that exist', () => {
  it('the default is Google Translate (web); the retired Google Cloud provider maps to it; on-device stays when chosen', () => {
    expect(DEFAULT_USAGE_SETTINGS.provider).toBe('google-web');
    expect(sanitizeUsageSettings({ provider: 'google' as never })).toEqual({ provider: 'google-web' });
    expect(sanitizeUsageSettings({ provider: 'device' })).toEqual({ provider: 'device' });
    expect(sanitizeUsageSettings({ provider: 'nonsense' as never })).toEqual({ provider: 'google-web' });
    expect(sanitizeUsageSettings(undefined)).toEqual({ provider: 'google-web' });
  });
  it('a stored "device" choice is respected; a stored "google" (old) setting loads as Google Translate (web)', async () => {
    const a = memoryKV();
    await a.set({ 'usage:settings:v1': { provider: 'device' } });
    expect((await new UsageService(a).getSettings()).provider).toBe('device');
    const b = memoryKV();
    await b.set({ 'usage:settings:v1': { provider: 'google', freeQuotaChars: 500000 } });
    expect((await new UsageService(b).getSettings()).provider).toBe('google-web');
  });
  it('credentials left by the retired Google Cloud feature (API key, credential id, sign-in record) are removed', async () => {
    const kv = memoryKV();
    await kv.set({ 'usage:apikey:v1': 'AIza-old-key', 'usage:credential:v1': 'proj', 'auth:v1': { signedIn: true }, 'secret:translate-api-key': 'cipher', 'usage:settings:v1': { provider: 'device' } });
    await new UsageService(kv).getSettings();
    for (const k of ['usage:apikey:v1', 'usage:credential:v1', 'auth:v1', 'secret:translate-api-key']) expect(kv.data.has(k), k).toBe(false);
  });
});

describe('metering, cache and the device default', () => {
  it('device mode tells the caller to use the on-device translator and sends nothing', async () => {
    const svc = new UsageService(memoryKV());
    await svc.updateSettings({ provider: 'device' });
    expect(await svc.translate('hello world')).toEqual({ source: 'device' });
    expect((await svc.snapshot()).usedChars).toBe(0);
  });
  it('counts the submitted characters and requests', async () => {
    const { svc, sent } = await setup();
    const r = await svc.translate('  Hello   world ');
    expect(r).toMatchObject({ source: 'google', text: 'vi:Hello world', cached: false, chars: 11 });
    expect(sent).toEqual(['Hello world']);
    expect(await svc.snapshot()).toMatchObject({ usedChars: 11, requests: 1, cachedRequests: 0 });
  });
  it('a cache hit is not a new request', async () => {
    const { svc, sent } = await setup();
    await svc.translate('good morning');
    const r2 = await svc.translate('  good   morning ');
    expect(r2).toMatchObject({ source: 'google', cached: true });
    expect(sent).toHaveLength(1);
    const s = await svc.snapshot();
    expect(s).toMatchObject({ usedChars: 12, requests: 1, cachedRequests: 1, cachedChars: 12 });
  });
  it('the cache survives a restart (new service, same storage)', async () => {
    const a = await setup();
    await a.svc.translate('see you tomorrow');
    const b = await setup({ kv: a.kv });
    expect(await b.svc.translate('see you tomorrow')).toMatchObject({ cached: true });
    expect(b.sent).toHaveLength(0);
  });
  it('identical simultaneous requests share one request', async () => {
    const { svc, sent } = await setup();
    const rs = await Promise.all(Array.from({ length: 6 }, () => svc.translate('same text')));
    expect(sent).toHaveLength(1);
    expect(rs.every((r) => r.source === 'google')).toBe(true);
    expect((await svc.snapshot()).usedChars).toBe(9);
  });
});

describe('monthly reset (calendar boundary)', () => {
  it('resets on the first day of the new month and keeps the finished month in the history', async () => {
    let now = new Date(Date.UTC(2026, 0, 31, 23, 59, 0)); // 31 Jan, UTC
    const a = await setup({ now: () => now });
    await a.svc.translate(text(400, 'j'));
    let s = await a.svc.snapshot();
    expect(s).toMatchObject({ usedChars: 400, month: '2026-01', lastReset: '2026-01-01', nextReset: '2026-02-01' });
    now = new Date(Date.UTC(2026, 1, 1, 0, 0, 5)); // 1 Feb
    s = await a.svc.snapshot();
    expect(s).toMatchObject({ usedChars: 0, month: '2026-02', lastReset: '2026-02-01', nextReset: '2026-03-01' });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ month: '2026-01', chars: 400 });
    await a.svc.translate(text(100, 'f'));
    expect((await a.svc.snapshot()).usedChars).toBe(100);
  });
  it('December rolls into January of the next year', async () => {
    let now = new Date(Date.UTC(2026, 11, 20, 10, 0, 0));
    const a = await setup({ now: () => now });
    await a.svc.translate('hello');
    expect((await a.svc.snapshot()).nextReset).toBe('2027-01-01');
    now = new Date(Date.UTC(2027, 0, 1, 0, 0, 1));
    expect(await a.svc.snapshot()).toMatchObject({ usedChars: 0, month: '2027-01' });
  });
  it('a restart alone never resets the counters (stored state, not a timer)', async () => {
    const now = () => new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    const a = await setup({ now });
    await a.svc.translate('persist me');
    const b = new UsageService(a.kv, { clock: now }); // "browser restart"
    expect(await b.snapshot()).toMatchObject({ usedChars: 10, requests: 1, month: '2026-06' });
  });
  it('a clock / time-zone change that moves backwards does not reset or lose usage', async () => {
    let now = new Date(Date.UTC(2026, 5, 1, 0, 30, 0));
    const a = await setup({ now: () => now });
    await a.svc.translate('hello there');
    now = new Date(Date.UTC(2026, 4, 31, 23, 30, 0)); // an hour back across the boundary
    const s = await a.svc.snapshot();
    expect(s.usedChars).toBe(11);
    expect(s.month).toBe('2026-06');
    now = new Date(Date.UTC(2026, 5, 1, 0, 40, 0)); // forward again
    expect((await a.svc.snapshot()).usedChars).toBe(11);
  });
});

describe('persistence, history and reset', () => {
  it('usage and the provider choice persist across restarts', async () => {
    const a = await setup();
    await a.svc.translate(text(250, 'k'));
    const b = new UsageService(a.kv);
    const s = await b.snapshot();
    expect(s).toMatchObject({ usedChars: 250, requests: 1 });
    expect(s.settings.provider).toBe('google-web');
  });
  it('clear history keeps the current month; reset wipes the local usage data (settings stay)', async () => {
    let now = new Date(Date.UTC(2026, 0, 15));
    const a = await setup({ now: () => now });
    await a.svc.translate(text(100, 'a'));
    now = new Date(Date.UTC(2026, 1, 3));
    await a.svc.translate(text(40, 'b'));
    expect((await a.svc.snapshot()).history).toHaveLength(1);
    await a.svc.clearHistory();
    let s = await a.svc.snapshot();
    expect(s.history).toHaveLength(0);
    expect(s.log).toHaveLength(0);
    expect(s.usedChars).toBe(40);
    await a.svc.resetAll();
    s = await a.svc.snapshot();
    expect(s).toMatchObject({ usedChars: 0, requests: 0, cachedRequests: 0 });
    expect(s.settings.provider).toBe('google-web');
  });
  it('the exported report is labelled as a local counter and contains no key or price', async () => {
    const { svc } = await setup();
    await svc.translate('export me');
    const json = await svc.exportReport('json');
    expect(json).toContain('bộ đếm cục bộ');
    expect(JSON.parse(json).currentMonth.usedChars).toBe(9);
    expect(json).not.toMatch(/apiKey|credential|estimatedCost|freeQuota/);
    const csv = await svc.exportReport('csv');
    expect(csv.split('\n')[0]).toBe('month,provider,language_pair,characters,operations,requests,cached_requests,cached_characters,failed_requests');
  });
});
