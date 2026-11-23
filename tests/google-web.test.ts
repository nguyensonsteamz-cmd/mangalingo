/**
 * Google Translate web (unofficial) provider. ALL of this is tested with a FAKE network (mock): nothing here contacts Google.
 * The one real request made during the migration is documented in docs/google_translate_unofficial_migration_report.md.
 */
import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { UsageService } from '@/modules/usage';
import {
  GOOGLE_WEB_MAX_CHARS,
  GoogleWebError,
  GoogleWebGate,
  classifyHttp,
  googleWebTranslate,
  normalizeLang,
  parseTranslation,
  type WebFetch,
} from '@/modules/usage/google-web';
import { classifyError, translateLongText, type LongTextDeps } from '@/translation/long-text';
import { PROVIDER_LIMITS } from '@/modules/translation';

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

const ok = (body: unknown, status = 200, url?: string) => ({ status, url, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const reply = (t: string, s = t) => [[[t, s, null, null, 1]], null, 'en'];
/** fake endpoint: "translates" by prefixing the decoded query; records every URL */
function fakeNet(handler?: (q: string, n: number) => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>) {
  const urls: string[] = [];
  const inits: unknown[] = [];
  const f: WebFetch = async (url, init) => {
    urls.push(url);
    inits.push(init);
    const q = new URL(url).searchParams.get('q') ?? '';
    return handler ? handler(q, urls.length) : ok(reply('VI:' + q, q));
  };
  return { f, urls, inits };
}
const CAPTCHA = '<html><head><title>Sorry...</title></head><body>... your computer or network may be sending automated queries.</body></html>';

describe('response parsing: only real translations are successes', () => {
  it('joins the segments of a normal answer', () => {
    expect(parseTranslation(JSON.stringify([[['Xin chào ', 'Hello '], ['thế giới', 'world']], null, 'en']), 'Hello world')).toBe('Xin chào thế giới');
  });
  it('HTML / CAPTCHA / error pages are errors, never translations', () => {
    expect(() => parseTranslation(CAPTCHA, 'Hello')).toThrowError(expect.objectContaining({ code: 'CAPTCHA_REQUIRED' }));
    expect(() => parseTranslation('<html>Error 500</html>', 'Hello')).toThrowError(expect.objectContaining({ code: 'TRANSLATION_FAILED' }));
  });
  it('invalid / empty JSON is TRANSLATION_FAILED', () => {
    for (const b of ['', 'not json', '{}', '[]', '[[]]', '[[[1,2]]]', '[[["",""]]]', '[[["  ","x"]]]']) {
      expect(() => parseTranslation(b, 'Hello'), b).toThrowError(expect.objectContaining({ code: 'TRANSLATION_FAILED' }));
    }
  });
  it('the source sentence handed back is a failure, not a translation (short tokens like "OK" are allowed)', () => {
    const s = 'This is a complete sentence that was not translated.';
    expect(() => parseTranslation(JSON.stringify([[[s, s]]]), s)).toThrowError(expect.objectContaining({ code: 'TRANSLATION_FAILED' }));
    expect(parseTranslation(JSON.stringify([[['OK', 'OK']]]), 'OK')).toBe('OK');
  });
});

describe('HTTP classification', () => {
  const code = (st: number, body = '', url?: string) => classifyHttp(st, url, body)?.code ?? null;
  it('maps statuses to the documented error states', () => {
    expect(code(200)).toBeNull();
    expect(code(429, CAPTCHA)).toBe('CAPTCHA_REQUIRED');
    expect(code(429, 'slow down')).toBe('RATE_LIMITED');
    expect(code(403)).toBe('ACCESS_BLOCKED');
    expect(code(200, '', 'https://www.google.com/sorry/index?continue=x')).toBe('CAPTCHA_REQUIRED');
    expect(code(414)).toBe('TEXT_TOO_LONG');
    expect(code(503)).toBe('NETWORK_ERROR');
    expect(code(400)).toBe('TRANSLATION_FAILED');
  });
});

describe('one request', () => {
  it('translates en→vi with the documented URL, GET, no custom headers, no credentials, no key', async () => {
    const net = fakeNet();
    expect(await googleWebTranslate('Good morning', 'en>vi', { fetchImpl: net.f })).toBe('VI:Good morning');
    const u = new URL(net.urls[0]);
    expect(u.origin + u.pathname).toBe('https://translate.googleapis.com/translate_a/single');
    expect([u.searchParams.get('sl'), u.searchParams.get('tl'), u.searchParams.get('client'), u.searchParams.get('key')]).toEqual(['en', 'vi', 'gtx', null]);
    const init = net.inits[0] as Record<string, unknown>;
    expect(Object.keys(init).sort()).toEqual(['credentials', 'method', 'signal']); // in particular: no `headers`
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
  });
  it('keeps Unicode, Vietnamese, Chinese, punctuation, numbers, URLs and HTML-like text intact in the request', async () => {
    const samples = ['Tiếng Việt: xin chào, bạn khỏe không?', '你好，世界！', 'Price: 1,234.50 USD (≈ 30%) — see https://example.com/a?b=1&c=2#x', '<b>bold</b> & <i>it</i>', 'Line 1\nLine 2\n\nLine 4'];
    for (const s of samples) {
      const net = fakeNet();
      await googleWebTranslate(s, 'en>vi', { fetchImpl: net.f });
      expect(new URL(net.urls[0]).searchParams.get('q')).toBe(s);
    }
    const net = fakeNet();
    await googleWebTranslate('Tiếng Việt', 'vi>en', { fetchImpl: net.f });
    expect(new URL(net.urls[0]).searchParams.get('sl')).toBe('vi');
  });
  it('validates languages and input', async () => {
    expect(normalizeLang('EN')).toBe('en');
    expect(normalizeLang('zh-cn')).toBe('zh-CN');
    expect(() => normalizeLang('xx')).toThrowError(expect.objectContaining({ code: 'INVALID_LANGUAGE' }));
    const net = fakeNet();
    await expect(googleWebTranslate('x', 'en>en', { fetchImpl: net.f })).rejects.toMatchObject({ code: 'INVALID_LANGUAGE' });
    await expect(googleWebTranslate('x', 'en>fr?', { fetchImpl: net.f })).rejects.toMatchObject({ code: 'INVALID_LANGUAGE' });
    await expect(googleWebTranslate('   ', 'en>vi', { fetchImpl: net.f })).rejects.toMatchObject({ code: 'TRANSLATION_FAILED' }); // empty input is never "translated"
    await expect(googleWebTranslate('a'.repeat(GOOGLE_WEB_MAX_CHARS + 1), 'en>vi', { fetchImpl: net.f })).rejects.toMatchObject({ code: 'TEXT_TOO_LONG' });
    await expect(googleWebTranslate('ế'.repeat(GOOGLE_WEB_MAX_CHARS), 'en>vi', { fetchImpl: net.f })).rejects.toMatchObject({ code: 'TEXT_TOO_LONG' }); // encoded URL too long
    expect(net.urls).toHaveLength(0); // none of these reached the network
  });
  it('timeout → TIMEOUT', async () => {
    const f: WebFetch = (_u, init) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(googleWebTranslate('Hello there', 'en>vi', { fetchImpl: f, timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('cancellation → CANCELLED (before and during the request)', async () => {
    const pre = new AbortController();
    pre.abort();
    const net = fakeNet();
    await expect(googleWebTranslate('Hello', 'en>vi', { fetchImpl: net.f, signal: pre.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(net.urls).toHaveLength(0);
    const ctl = new AbortController();
    const f: WebFetch = (_u, init) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const p = googleWebTranslate('Hello', 'en>vi', { fetchImpl: f, signal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('network failures are NETWORK_ERROR and never echo the URL or the text', async () => {
    const f: WebFetch = async (url) => {
      throw new Error('boom ' + url);
    };
    const e = (await googleWebTranslate('my secret sentence', 'en>vi', { fetchImpl: f }).catch((x) => x)) as GoogleWebError;
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.message).not.toMatch(/secret|googleapis|boom/);
  });
});

describe('gate: serialisation, spacing, retry policy, cooldown', () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
  };

  it('sends one request at a time and keeps the minimum interval between starts', async () => {
    const c = clock();
    let live = 0;
    let peak = 0;
    const starts: number[] = [];
    const f: WebFetch = async (url) => {
      live++;
      peak = Math.max(peak, live);
      starts.push(c.now());
      await Promise.resolve();
      live--;
      return ok(reply('V', new URL(url).searchParams.get('q') ?? ''));
    };
    const g = new GoogleWebGate({ now: c.now, sleep: c.sleep, minIntervalMs: 1200 });
    await Promise.all(['one', 'two', 'three', 'four'].map((t) => g.run(t, 'en>vi', { fetchImpl: f })));
    expect(peak).toBe(1);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1200);
  });

  it('retries a transient network error once, then gives up (bounded)', async () => {
    const c = clock();
    let n = 0;
    const f: WebFetch = async () => {
      n++;
      throw new Error('offline');
    };
    const g = new GoogleWebGate({ now: c.now, sleep: c.sleep });
    await expect(g.run('Hello', 'en>vi', { fetchImpl: f })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(n).toBe(2); // 1 try + 1 retry
    n = 0;
    const g2 = new GoogleWebGate({ now: c.now, sleep: c.sleep });
    const flaky: WebFetch = async (url) => (++n === 1 ? ok('', 503) : ok(reply('VI', new URL(url).searchParams.get('q') ?? '')));
    expect(await g2.run('Hello', 'en>vi', { fetchImpl: flaky })).toBe('VI'); // recovered
  });

  it.each([
    ['CAPTCHA', ok(CAPTCHA, 429), 'CAPTCHA_REQUIRED'],
    ['rate limit', ok('too many', 429), 'RATE_LIMITED'],
    ['denied', ok('no', 403), 'ACCESS_BLOCKED'],
  ])('%s: NO retry, then a cooldown during which nothing is sent', async (_n, response, code) => {
    const c = clock();
    let n = 0;
    const f: WebFetch = async () => (n++, response);
    const g = new GoogleWebGate({ now: c.now, sleep: c.sleep, cooldownMs: 600_000 });
    await expect(g.run('Hello', 'en>vi', { fetchImpl: f })).rejects.toMatchObject({ code });
    expect(n).toBe(1);
    await expect(g.run('Another', 'en>vi', { fetchImpl: f })).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    await expect(g.run('Third', 'en>vi', { fetchImpl: f })).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    expect(n).toBe(1); // still 1: the cooldown sent nothing
    c.advance(600_001);
    const good: WebFetch = async (url) => ok(reply('VI', new URL(url).searchParams.get('q') ?? ''));
    expect(await g.run('Hello again', 'en>vi', { fetchImpl: good })).toBe('VI'); // free again after the cooldown
  });

  it('the cooldown survives a restart (persisted) and a failing store never breaks translation', async () => {
    const c = clock();
    let saved: number | undefined;
    const store = { get: async () => saved, set: async (n: number) => void (saved = n) };
    const g = new GoogleWebGate({ now: c.now, sleep: c.sleep, store });
    await g.run('Hello', 'en>vi', { fetchImpl: async () => ok(CAPTCHA, 429) }).catch(() => {});
    expect(saved).toBeGreaterThan(c.now());
    const restarted = new GoogleWebGate({ now: c.now, sleep: c.sleep, store });
    let n = 0;
    await expect(restarted.run('Hello', 'en>vi', { fetchImpl: async () => (n++, ok(reply('x'))) })).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    expect(n).toBe(0);
    const broken = new GoogleWebGate({ now: c.now, sleep: c.sleep, store: { get: async () => Promise.reject(new Error('x')), set: async () => Promise.reject(new Error('x')) } });
    expect(await broken.run('Hello', 'en>vi', { fetchImpl: async () => ok(reply('VI')) })).toBe('VI');
  });
});

describe('UsageService with Google Translate web (no key, no billing, no quota)', () => {
  const setup = async (handler?: Parameters<typeof fakeNet>[0]) => {
    const net = fakeNet(handler);
    const kv = memoryKV();
    const svc = new UsageService(kv, { webFetch: net.f, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {} } });
    await svc.activateGoogleWeb();
    return { svc, net, kv };
  };

  it('translates without any API key and counts the characters in its own ledger', async () => {
    const { svc, net } = await setup();
    expect((await svc.getSettings()).provider).toBe('google-web');
    const r = await svc.translate('Good morning', {});
    expect(r).toMatchObject({ source: 'google', text: 'VI:Good morning', cached: false });
    expect(net.urls).toHaveLength(1);
    const snap = await svc.snapshot();
    expect(snap.provider).toBe('google-web');
    expect(snap).toMatchObject({ usedChars: 12, requests: 1, failedRequests: 0 });
    expect(Object.keys(snap)).not.toEqual(expect.arrayContaining(['freeQuota', 'estimatedCostUsd', 'hasKey'])); // no quota, price or key exists
    // same text again: from the cache, not a second request, and not new usage
    expect(await svc.translate('Good morning', {})).toMatchObject({ cached: true });
    expect(net.urls).toHaveLength(1);
  });

  it('a retry of the same chunk (same idempotency key) is counted once', async () => {
    const { svc } = await setup();
    await svc.translate('Chunk number one', { idempotencyKey: 'job:0' });
    const snap1 = await svc.snapshot();
    await svc.translate('Chunk number one', { idempotencyKey: 'job:0' });
    expect((await svc.snapshot()).usedChars).toBe(snap1.usedChars);
  });

  it('a block is reported as gweb-CAPTCHA_REQUIRED, counts as a failure (not as characters) and then nothing more is sent', async () => {
    const { svc, net } = await setup(() => ok(CAPTCHA, 429));
    await expect(svc.translate('Hello there', {})).rejects.toMatchObject({ code: 'gweb-CAPTCHA_REQUIRED' });
    await expect(svc.translate('Something else', {})).rejects.toMatchObject({ code: 'gweb-ACCESS_BLOCKED' });
    expect(net.urls).toHaveLength(1); // the cooldown stopped the second request before the network
    const snap = await svc.snapshot();
    expect(snap).toMatchObject({ usedChars: 0, requests: 0, failedRequests: 2 });
  });

  it('error messages never contain the user text or the URL', async () => {
    const { svc } = await setup(() => ok(CAPTCHA, 429));
    const e = (await svc.translate('my private diary entry', {}).catch((x) => x)) as Error;
    expect(e.message).not.toMatch(/diary|googleapis|http/);
  });

  it('a fresh install uses Google Translate (web) by default; switching to on-device stops all network use', async () => {
    const net = fakeNet();
    const svc = new UsageService(memoryKV(), { webFetch: net.f, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {} } });
    expect((await svc.getSettings()).provider).toBe('google-web');
    expect(await svc.translate('Hello', {})).toMatchObject({ source: 'google' });
    expect(net.urls).toHaveLength(1);
    await svc.updateSettings({ provider: 'device' });
    expect(await svc.translate('Hello again', {})).toEqual({ source: 'device' });
    expect(net.urls).toHaveLength(1); // nothing more was sent
  });
});

describe('long text through Google Translate web (chunking, order, failures, cancellation)', () => {
  const deps = (svc: UsageService): LongTextDeps => ({
    googleActive: async () => true,
    sendGoogle: (text, o) => svc.translate(text, { idempotencyKey: o.idempotencyKey, keepBreaks: o.keepBreaks }),
    deviceTranslate: async () => {
      throw new Error('the device translator must not be used');
    },
    deviceProvider: 'device-chrome',
  });
  const make = async (handler?: Parameters<typeof fakeNet>[0]) => {
    const net = fakeNet(handler);
    const svc = new UsageService(memoryKV(), { webFetch: net.f, webGate: { minIntervalMs: 0, retryPauseMs: 0, sleep: async () => {} } });
    await svc.activateGoogleWeb();
    return { svc, net };
  };
  const paragraphs = (n: number, len = 400) => Array.from({ length: n }, (_, i) => `P${i + 1}: ` + `Sentence number ${i + 1} is here. `.repeat(Math.ceil(len / 30)).trim()).join('\n\n');

  it('limits of the provider are small and serial', () => {
    expect(PROVIDER_LIMITS['google-web']).toMatchObject({ concurrency: 1, metered: false });
    expect(PROVIDER_LIMITS['google-web'].maxChars).toBeLessThanOrEqual(GOOGLE_WEB_MAX_CHARS);
  });

  it('short text: one request', async () => {
    const { svc, net } = await make();
    const r = await translateLongText('Hello world.', deps(svc));
    expect(r.complete).toBe(true);
    expect(net.urls).toHaveLength(1);
  });

  it('multiple paragraphs / long text: every chunk within the limit, in order, none duplicated or missing', async () => {
    const { svc, net } = await make();
    const text = paragraphs(20); // ~8,000 characters
    const r = await translateLongText(text, deps(svc));
    expect(r.complete).toBe(true);
    expect(r.failedIndexes).toEqual([]);
    expect(r.chunks.length).toBeGreaterThan(4);
    expect(net.urls).toHaveLength(r.chunks.length); // one request per chunk
    for (const u of net.urls) expect([...(new URL(u).searchParams.get('q') ?? '')].length).toBeLessThanOrEqual(PROVIDER_LIMITS['google-web'].maxChars);
    // order preserved, nothing lost: every source paragraph marker appears once, in sequence, in the output
    const marks = [...r.text.matchAll(/P(\d+):/g)].map((m) => Number(m[1]));
    expect(marks).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('Vietnamese, Chinese, URLs and numbers survive chunking', async () => {
    const { svc } = await make();
    const text = ['Xin chào, đây là đoạn văn tiếng Việt. '.repeat(40), '这是一个中文段落。'.repeat(80), 'See https://example.com/path?q=1 — total 1,234.56 USD.'].join('\n\n');
    const r = await translateLongText(text, deps(svc), { pair: undefined });
    expect(r.complete).toBe(true);
    expect(r.text).toContain('https://example.com/path?q=1');
    expect(r.text).toContain('1,234.56');
    expect(r.text).toContain('这是一个中文段落。');
  });

  it('empty input is not translated and not reported as a translation', async () => {
    const { svc, net } = await make();
    const r = await translateLongText('   \n\n  ', deps(svc));
    expect(net.urls).toHaveLength(0);
    expect(r.chunks.length).toBe(0);
  });

  it('a block mid-job STOPS the job (no more requests), the result is partial and never "complete"', async () => {
    const { svc, net } = await make((_q, n) => (n >= 3 ? ok(CAPTCHA, 429) : ok(reply('V' + n))));
    const r = await translateLongText(paragraphs(20), deps(svc));
    expect(r.complete).toBe(false);
    expect(r.failedIndexes.length).toBeGreaterThan(0);
    expect(net.urls.length).toBe(3); // 2 good + the one that was blocked; nothing after it
    expect(r.outcomes.some((o) => o.errorCode === 'gweb-CAPTCHA_REQUIRED')).toBe(true);
  });

  it('a transient network error on one chunk is recovered by a bounded retry', async () => {
    let failed = false;
    const { svc, net } = await make((q, n) => {
      if (n === 2 && !failed) {
        failed = true;
        return ok('', 503);
      }
      return ok(reply('V:' + q.slice(0, 5)));
    });
    const r = await translateLongText(paragraphs(10), deps(svc));
    expect(r.complete).toBe(true);
    expect(net.urls.length).toBe(r.chunks.length + 1); // exactly ONE extra request: the gate's single bounded retry
  });

  it('cancellation stops the job between chunks', async () => {
    const ctl = new AbortController();
    const { svc, net } = await make((_q, n) => {
      if (n === 2) ctl.abort();
      return ok(reply('V'));
    });
    const r = await translateLongText(paragraphs(20), deps(svc), { signal: ctl.signal });
    expect(r.cancelled).toBe(true);
    expect(r.complete).toBe(false);
    expect(net.urls.length).toBeLessThan(r.chunks.length);
  });

  it('error classification for the runner', () => {
    const c = (code: string) => classifyError(Object.assign(new Error('m'), { code })).opts;
    expect(c('gweb-NETWORK_ERROR')).toMatchObject({ retryable: true, fatal: false });
    expect(c('gweb-TIMEOUT')).toMatchObject({ retryable: true, fatal: false });
    for (const k of ['RATE_LIMITED', 'ACCESS_BLOCKED', 'CAPTCHA_REQUIRED']) expect(c('gweb-' + k)).toMatchObject({ retryable: false, fatal: true });
    expect(c('gweb-TRANSLATION_FAILED')).toMatchObject({ retryable: false, fatal: false });
  });
});
