import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { UsageService, UsageMeter, UsageWarningManager, countChars, normalizeText, DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings, type UsageSettings } from '@/modules/usage';
import type { FetchLike } from '@/modules/usage/google';

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

const KEY = 'AIza' + 'x'.repeat(35);

/** A service in Google mode with a small free quota and a fake sender (no network). */
async function setup(over: Partial<UsageSettings> = {}, opts: { kv?: ReturnType<typeof memoryKV>; now?: () => Date; fetchImpl?: FetchLike } = {}) {
  const kv = opts.kv ?? memoryKV();
  const sent: string[] = [];
  const fetchImpl: FetchLike =
    opts.fetchImpl ??
    (async (_url, init) => {
      const q = (JSON.parse(init.body) as { q: string }).q;
      sent.push(q);
      return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: `vi:${q}` }] } }) };
    });
  const svc = new UsageService(kv, { clock: opts.now, fetchImpl });
  await svc.updateSettings({ provider: 'google', ...over });
  await svc.setApiKey(KEY);
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
    expect(countChars(normalizeText('é'))).toBe(1); // e + combining acute -> é
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
    expect(countChars(normalizeText('  hello   world  '))).toBe(11);
  });
});

describe('thresholds (free quota 500,000)', () => {
  const meter = new UsageMeter();
  const s = DEFAULT_USAGE_SETTINGS;
  it.each([
    [0, 'ok'],
    [394_999, 'ok'],
    [395_000, 'ok'], // 79 %
    [399_999, 'ok'],
    [400_000, 'notice'], // 80 %
    [449_999, 'notice'],
    [450_000, 'critical'], // 90 %
    [495_000, 'critical'], // 99 %
    [499_999, 'critical'],
    [500_000, 'blocked'], // 100 %
    [650_000, 'blocked'],
  ])('%i characters -> %s', (used, level) => {
    expect(meter.levelOf(used, s)).toBe(level);
  });
  it('thresholds are configurable (nothing is hard-coded)', () => {
    const custom = sanitizeUsageSettings({ freeQuotaChars: 1000, warnRatio: 0.5, criticalRatio: 0.7, hardStopRatio: 0.9 });
    expect(meter.levelOf(499, custom)).toBe('ok');
    expect(meter.levelOf(500, custom)).toBe('notice');
    expect(meter.levelOf(700, custom)).toBe('critical');
    expect(meter.levelOf(900, custom)).toBe('blocked');
  });
  it('defaults: 500,000 free, 80/90/100 %, paid translation OFF', () => {
    expect(DEFAULT_USAGE_SETTINGS).toMatchObject({ provider: 'device', freeQuotaChars: 500_000, warnRatio: 0.8, criticalRatio: 0.9, hardStopRatio: 1, paidEnabled: false });
  });
  it('limits can never be 0 or unlimited', () => {
    const z = sanitizeUsageSettings({ maxPaidCharsPerMonth: 0, maxMonthlyCostUsd: 0, maxCharsPerRequest: Infinity, maxPaidRequestsPerDay: -5 });
    expect(z.maxPaidCharsPerMonth).toBeGreaterThan(0);
    expect(z.maxMonthlyCostUsd).toBeGreaterThan(0);
    expect(Number.isFinite(z.maxCharsPerRequest)).toBe(true);
    expect(z.maxPaidRequestsPerDay).toBeGreaterThan(0);
  });
});

describe('warnings', () => {
  it('maps levels to the messages and fires once per level change', () => {
    const w = new UsageWarningManager();
    const seen: string[] = [];
    w.onChange((x) => seen.push(x.level));
    w.evaluate({ level: 'ok' });
    w.evaluate({ level: 'notice' });
    w.evaluate({ level: 'notice' });
    w.evaluate({ level: 'critical' });
    w.evaluate({ level: 'blocked' });
    expect(seen).toEqual(['notice', 'critical', 'blocked']);
    expect(w.warningFor('notice').message).toContain('gần hạn mức');
    expect(w.warningFor('critical').message).toContain('rất ít');
    expect(w.warningFor('blocked').message).toContain('có thể phát sinh phí Google Cloud');
  });
  it('the snapshot level follows the real usage', async () => {
    const { svc } = await setup({ freeQuotaChars: 1000 });
    expect((await svc.snapshot()).level).toBe('ok');
    await svc.translate(text(790, 'p')); // 79 %
    expect((await svc.snapshot()).level).toBe('ok');
    await svc.translate(text(10, 'q')); // 80 %
    expect((await svc.snapshot()).level).toBe('notice');
    await svc.translate(text(150, 'r')); // 95 %
    expect((await svc.snapshot()).level).toBe('critical');
    await svc.translate(text(40, 's')); // 99 %
    expect((await svc.snapshot()).level).toBe('critical');
    await svc.translate(text(10, 't')); // 100 %
    expect((await svc.snapshot()).level).toBe('blocked');
  });
});

describe('metering, cache and the device default', () => {
  it('device mode (default) is never metered and tells the caller to use the on-device translator', async () => {
    const kv = memoryKV();
    const svc = new UsageService(kv);
    expect(await svc.translate('hello world')).toEqual({ source: 'device' });
    expect((await svc.snapshot()).usedChars).toBe(0);
    await svc.updateSettings({ provider: 'google' }); // no key yet -> still the device
    expect(await svc.translate('hello world')).toEqual({ source: 'device' });
  });
  it('counts the submitted characters and requests', async () => {
    const { svc, sent } = await setup();
    const r = await svc.translate('  Hello   world ');
    expect(r).toMatchObject({ source: 'google', text: 'vi:Hello world', cached: false, chars: 11, paid: false });
    expect(sent).toEqual(['Hello world']);
    const s = await svc.snapshot();
    expect(s).toMatchObject({ usedChars: 11, requests: 1, cachedRequests: 0, remainingFree: 499_989, billableChars: 0, estimatedCostUsd: 0 });
  });
  it('a cache hit is not new API usage', async () => {
    const { svc, sent } = await setup();
    await svc.translate('good morning');
    const r2 = await svc.translate('  good   morning ');
    expect(r2).toMatchObject({ source: 'google', cached: true });
    expect(sent).toHaveLength(1);
    const s = await svc.snapshot();
    expect(s.usedChars).toBe(12);
    expect(s.requests).toBe(1);
    expect(s.cachedRequests).toBe(1);
    expect(s.cachedChars).toBe(12);
  });
  it('the cache survives a restart (new service, same storage)', async () => {
    const a = await setup();
    await a.svc.translate('see you tomorrow');
    const b = await setup({}, { kv: a.kv });
    const r = await b.svc.translate('see you tomorrow');
    expect(r).toMatchObject({ cached: true });
    expect(b.sent).toHaveLength(0);
  });
  it('identical simultaneous requests share one API call', async () => {
    const { svc, sent } = await setup();
    const rs = await Promise.all(Array.from({ length: 6 }, () => svc.translate('same text')));
    expect(sent).toHaveLength(1);
    expect(rs.every((r) => r.source === 'google')).toBe(true);
    expect((await svc.snapshot()).usedChars).toBe(9);
  });
});

describe('quota enforcement', () => {
  it('blocks billable requests at 100 % by default and asks for consent with an estimate', async () => {
    const { svc, sent } = await setup({ freeQuotaChars: 1000 });
    await svc.translate(text(1000, 'f')); // exactly the free quota
    const r = await svc.translate(text(200, 'g'));
    expect(r.source).toBe('blocked');
    if (r.source !== 'blocked') return;
    expect(r.decision).toMatchObject({ reason: 'consent-needed', needsConsent: true, additionalChars: 200 });
    expect(r.decision.estimatedCostUsd).toBeCloseTo((200 / 1_000_000) * 20, 8);
    expect(r.decision.message).toContain('có thể phát sinh phí Google Cloud');
    expect(sent).toHaveLength(1); // nothing was sent
    expect((await svc.snapshot()).usedChars).toBe(1000); // nothing was counted
  });
  it('a request that crosses the quota is blocked only for its billable part', async () => {
    const { svc } = await setup({ freeQuotaChars: 1000 });
    await svc.translate(text(900, 'a'));
    const r = await svc.translate(text(250, 'b')); // 150 free + 100 over
    expect(r.source).toBe('blocked');
    if (r.source === 'blocked') expect(r.decision.additionalChars).toBe(150);
  });
  it('simultaneous requests cannot bypass the local quota', async () => {
    const { svc, sent } = await setup({ freeQuotaChars: 1000 });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => svc.translate(text(100, String.fromCharCode(97 + (i % 26)) + i))));
    const ok = rs.filter((r) => r.source === 'google').length;
    const blocked = rs.filter((r) => r.source === 'blocked').length;
    expect(ok).toBe(10);
    expect(blocked).toBe(20);
    expect(sent).toHaveLength(10);
    const s = await svc.snapshot();
    expect(s.usedChars).toBe(1000);
    expect(s.billableChars).toBe(0);
  });
  it('a failed request is NOT counted, releases its reservation and does not jam the lock', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (_u, init) => {
      calls++;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({ error: { message: 'boom ' + KEY } }) };
      const q = (JSON.parse(init.body) as { q: string }).q;
      return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: q }] } }) };
    };
    const { svc } = await setup({ freeQuotaChars: 20 }, { fetchImpl });
    await expect(svc.translate('this one fails')).rejects.toThrow(/500/);
    let s = await svc.snapshot();
    expect(s).toMatchObject({ usedChars: 0, requests: 0, failedRequests: 1 }); // nothing counted
    await expect(svc.translate('this one fails')).resolves.toMatchObject({ source: 'google' }); // not cached after a failure
    s = await svc.snapshot();
    expect(s).toMatchObject({ usedChars: 14, requests: 1, failedRequests: 1 }); // counted ONCE, on success
    // the failed attempt did not keep any of the 20-character quota reserved
    expect((await svc.translate('five!')).source).toBe('google');
  });
  it('error messages never contain the API key', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: `key ${KEY} is not allowed` } }) });
    const { svc } = await setup({}, { fetchImpl });
    const err = await svc.translate('anything').catch((e: Error) => e);
    expect((err as Error).message).not.toContain(KEY);
  });
  it('limits the characters of one request', async () => {
    const { svc, sent } = await setup({ maxCharsPerRequest: 50 });
    const r = await svc.translate(text(51, 'z'));
    expect(r).toMatchObject({ source: 'blocked', decision: { reason: 'request-too-long' } });
    expect(sent).toHaveLength(0);
  });
});

describe('paid translation authorisation', () => {
  it('is off by default and never switches itself on', async () => {
    const { svc } = await setup({ freeQuotaChars: 100 });
    expect((await svc.getSettings()).paidEnabled).toBe(false);
    await svc.translate(text(100, 'a'));
    await svc.translate(text(10, 'b')); // blocked
    expect((await svc.getSettings()).paidEnabled).toBe(false);
  });
  it('after explicit consent the request is sent and its billable characters / cost are tracked', async () => {
    const { svc, sent } = await setup({ freeQuotaChars: 1000, maxCharsPerRequest: 5000 });
    await svc.translate(text(1000, 'a'));
    expect((await svc.translate(text(300, 'b'))).source).toBe('blocked');
    await svc.setPaidAuthorized(true);
    const r = await svc.translate(text(300, 'b'));
    expect(r).toMatchObject({ source: 'google', paid: true });
    expect(sent).toHaveLength(2);
    const s = await svc.snapshot();
    expect(s).toMatchObject({ usedChars: 1300, billableChars: 300, paidChars: 300, paidRequests: 1 });
    expect(s.estimatedCostUsd).toBeCloseTo(0.006, 8);
    expect(s.level).toBe('blocked');
  });
  it('the user can withdraw consent at any time', async () => {
    const { svc } = await setup({ freeQuotaChars: 100, paidEnabled: true });
    await svc.translate(text(100, 'a'));
    expect((await svc.translate(text(10, 'b'))).source).toBe('google');
    await svc.setPaidAuthorized(false);
    expect((await svc.translate(text(10, 'c'))).source).toBe('blocked');
  });
  it('consent is never unlimited: monthly paid characters', async () => {
    const { svc } = await setup({ freeQuotaChars: 100, paidEnabled: true, maxPaidCharsPerMonth: 50 });
    await svc.translate(text(100, 'a'));
    expect((await svc.translate(text(30, 'b'))).source).toBe('google');
    const r = await svc.translate(text(30, 'c')); // 30 + 30 > 50
    expect(r).toMatchObject({ source: 'blocked', decision: { reason: 'limit-chars', needsConsent: false } });
  });
  it('consent is never unlimited: maximum monthly cost', async () => {
    // $20 per million: 100,000 billable characters = $2.00
    const { svc } = await setup({ freeQuotaChars: 100, paidEnabled: true, maxPaidCharsPerMonth: 1e9, maxCharsPerRequest: 100_000, maxMonthlyCostUsd: 0.5 });
    await svc.translate(text(100, 'a'));
    expect((await svc.translate(text(20_000, 'b'))).source).toBe('google'); // $0.40
    const r = await svc.translate(text(10_000, 'c')); // $0.60 > $0.50
    expect(r).toMatchObject({ source: 'blocked', decision: { reason: 'limit-cost' } });
    expect((await svc.snapshot()).estimatedCostUsd).toBeCloseTo(0.4, 6);
  });
  it('consent is never unlimited: paid requests per day', async () => {
    const { svc } = await setup({ freeQuotaChars: 10, paidEnabled: true, maxPaidRequestsPerDay: 3 });
    await svc.translate(text(10, 'a'));
    for (let i = 0; i < 3; i++) expect((await svc.translate(text(5, 'p' + i))).source).toBe('google');
    expect(await svc.translate(text(5, 'p9'))).toMatchObject({ source: 'blocked', decision: { reason: 'limit-requests' } });
  });
});

describe('monthly reset (calendar boundary)', () => {
  it('resets on the first day of the new month and keeps the finished month in the history', async () => {
    let now = new Date(Date.UTC(2026, 0, 31, 23, 59, 0)); // 31 Jan, UTC
    const a = await setup({ freeQuotaChars: 1000 }, { now: () => now });
    await a.svc.translate(text(400, 'j'));
    let s = await a.svc.snapshot();
    expect(s).toMatchObject({ usedChars: 400, month: '2026-01', lastReset: '2026-01-01', nextReset: '2026-02-01' });
    now = new Date(Date.UTC(2026, 1, 1, 0, 0, 5)); // 1 Feb
    s = await a.svc.snapshot();
    expect(s).toMatchObject({ usedChars: 0, month: '2026-02', lastReset: '2026-02-01', nextReset: '2026-03-01', level: 'ok' });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ month: '2026-01', chars: 400 });
    await a.svc.translate(text(100, 'f'));
    expect((await a.svc.snapshot()).usedChars).toBe(100);
  });
  it('December rolls into January of the next year', async () => {
    let now = new Date(Date.UTC(2026, 11, 20, 10, 0, 0));
    const a = await setup({}, { now: () => now });
    await a.svc.translate('hello');
    expect((await a.svc.snapshot()).nextReset).toBe('2027-01-01');
    now = new Date(Date.UTC(2027, 0, 1, 0, 0, 1));
    expect(await a.svc.snapshot()).toMatchObject({ usedChars: 0, month: '2027-01' });
  });
  it('a restart alone never resets the counters (stored state, not a timer)', async () => {
    const now = () => new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    const a = await setup({}, { now });
    await a.svc.translate('persist me');
    const b = new UsageService(a.kv, { clock: now }); // "browser restart"
    expect(await b.snapshot()).toMatchObject({ usedChars: 10, requests: 1, month: '2026-06' });
  });
  it('a clock / time-zone change that moves backwards does not reset or lose usage', async () => {
    let now = new Date(Date.UTC(2026, 5, 1, 0, 30, 0));
    const a = await setup({}, { now: () => now });
    await a.svc.translate('hello there');
    now = new Date(Date.UTC(2026, 4, 31, 23, 30, 0)); // an hour back across the boundary
    const s = await a.svc.snapshot();
    expect(s.usedChars).toBe(11);
    expect(s.month).toBe('2026-06');
    now = new Date(Date.UTC(2026, 5, 1, 0, 40, 0)); // forward again
    expect((await a.svc.snapshot()).usedChars).toBe(11);
  });
  it('the daily paid-request counter starts again on a new day', async () => {
    let now = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    const { svc } = await setup({ freeQuotaChars: 10, paidEnabled: true, maxPaidRequestsPerDay: 1 }, { now: () => now });
    await svc.translate(text(10, 'a'));
    expect((await svc.translate(text(5, 'b'))).source).toBe('google');
    expect((await svc.translate(text(5, 'c'))).source).toBe('blocked');
    now = new Date(Date.UTC(2026, 5, 11, 8, 0, 0));
    expect((await svc.translate(text(5, 'd'))).source).toBe('google');
  });
});

describe('persistence, history and reset', () => {
  it('usage persists across restarts', async () => {
    const a = await setup({ freeQuotaChars: 1000 });
    await a.svc.translate(text(250, 'k'));
    const b = new UsageService(a.kv);
    const s = await b.snapshot();
    expect(s).toMatchObject({ usedChars: 250, requests: 1, freeQuota: 1000 });
    expect(s.settings.provider).toBe('google');
  });
  it('clear history keeps the current month; reset wipes the local usage data (settings stay)', async () => {
    let now = new Date(Date.UTC(2026, 0, 15));
    const a = await setup({ freeQuotaChars: 1000 }, { now: () => now });
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
    expect(s.settings.freeQuotaChars).toBe(1000);
    expect(s.hasKey).toBe(true);
  });
  it('the exported report is labelled as a local estimate and never contains the API key', async () => {
    const { svc } = await setup();
    await svc.translate('export me');
    const json = await svc.exportReport('json');
    expect(json).not.toContain(KEY);
    expect(json).toContain('KHÔNG phải dữ liệu thanh toán của Google Cloud');
    expect(JSON.parse(json).currentMonth.usedChars).toBe(9);
    const csv = await svc.exportReport('csv');
    expect(csv.split('\n')[0]).toContain('month,provider,credential');
    expect(csv).not.toContain(KEY);
  });
  it('the snapshot exposes only a hint of the key', async () => {
    const { svc } = await setup();
    const s = await svc.snapshot();
    expect(s.hasKey).toBe(true);
    expect(s.keyHint).toBe(KEY.slice(-4));
    expect(JSON.stringify(s)).not.toContain(KEY);
  });
  it('rejects an obviously invalid key', async () => {
    const { svc } = await setup();
    await expect(svc.setApiKey('short')).rejects.toThrow();
    await svc.setApiKey(null);
    expect((await svc.snapshot()).hasKey).toBe(false);
  });
});
