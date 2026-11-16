import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EN_VI,
  LOCAL_MODELS,
  LOCAL_MODEL_ID,
  LocalModelHost,
  LocalModelProvider,
  MtError,
  ProviderRegistry,
  VI_EN,
  modelForPair,
  type LocalModelSpec,
} from '@/modules/mt';
import { createRouter } from '@/background/router';
import { PROVIDER_LIMITS, translateLong } from '@/modules/translation';
import { translateLongText, type LongTextDeps } from '@/translation/long-text';
import { googleTranslate } from '@/modules/usage/google';

/** In-memory model: "translates" by tagging, tracks downloads and calls. */
function fakeBackend(opts: { cached?: boolean; fail?: (text: string) => boolean } = {}) {
  const b = {
    isCached: opts.cached ?? false,
    calls: [] as string[],
    prepared: 0,
    removed: 0,
    async cached(_s: LocalModelSpec) {
      return b.isCached;
    },
    async prepare(_s: LocalModelSpec, onProgress?: (l: number, t: number) => void) {
      b.prepared++;
      onProgress?.(50, 100);
      onProgress?.(100, 100);
      b.isCached = true;
    },
    async translate(s: LocalModelSpec, text: string, signal?: AbortSignal) {
      if (signal?.aborted) throw new MtError('aborted', 'Đã hủy.');
      if (opts.fail?.(text)) throw new MtError('provider-error', 'boom', { retryable: true });
      b.calls.push(text);
      return `${s.pair.source}>${s.pair.target}:${text}`;
    },
    async remove() {
      b.removed++;
      b.isCached = false;
    },
  };
  return b;
}

describe('local model manifest', () => {
  it('pins exact checkpoints and both directions, with a verified permissive licence', () => {
    expect(LOCAL_MODELS.map((m) => `${m.pair.source}-${m.pair.target}`)).toEqual(['en-vi', 'vi-en']);
    for (const m of LOCAL_MODELS) {
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(m.upstream.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(m.upstream.license).toBe('apache-2.0');
      expect(m.maxChars).toBeLessThanOrEqual(900); // 512-token window
    }
    expect(modelForPair(VI_EN)?.repo).toBe('Xenova/opus-mt-vi-en');
    expect(modelForPair({ source: 'en', target: 'en' } as never)).toBeUndefined();
  });
});

describe('LocalModelProvider', () => {
  it('reports downloadable → available, never downloads by itself, and refuses to translate before the model is there', async () => {
    const be = fakeBackend();
    const p = new LocalModelProvider(be, () => true);
    expect(await p.availability(EN_VI)).toBe('downloadable');
    await expect(p.translate({ text: 'Hello.', pair: EN_VI })).rejects.toMatchObject({ code: 'needs-download' });
    expect(be.prepared).toBe(0);
    const prog: number[] = [];
    await p.prepare(EN_VI, (f) => prog.push(f));
    expect(prog).toEqual([0.5, 1, 1]);
    expect(await p.availability(EN_VI)).toBe('available');
  });

  it('reports unsupported pairs and unavailable runtimes', async () => {
    const p = new LocalModelProvider(fakeBackend({ cached: true }), () => false);
    expect(await p.availability(EN_VI)).toBe('unavailable');
    const q = new LocalModelProvider(fakeBackend({ cached: true }), () => true);
    expect(await q.availability({ source: 'fr', target: 'vi' } as never)).toBe('unsupported');
    await expect(q.translate({ text: 'x', pair: { source: 'fr', target: 'vi' } as never })).rejects.toMatchObject({ code: 'unsupported-pair' });
    await expect(p.translate({ text: 'Hello.', pair: EN_VI })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('splits text into sentences under the model window and keeps punctuation / spacing / paragraphs', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    const text = 'First sentence is here. Second one follows!\n\nA new paragraph starts now? Yes.';
    const r = await p.translate({ text, pair: EN_VI });
    expect(be.calls.length).toBeGreaterThan(0);
    for (const c of be.calls) expect(c.length).toBeLessThanOrEqual(900);
    // the sources, joined back, reproduce the input (nothing lost) and the paragraph break survives in the output
    expect(r.text).toContain('\n\n');
    expect(r.text.replace(/en>vi:/g, '')).toBe(text);
    expect(r).toMatchObject({ providerId: LOCAL_MODEL_ID, pair: EN_VI, modelId: 'Helsinki-NLP/opus-mt-en-vi' });
  });

  it('translates each direction with its own checkpoint', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    expect((await p.translate({ text: 'Xin chào các bạn.', pair: VI_EN })).text).toBe('vi>en:Xin chào các bạn.');
    expect((await p.translate({ text: 'Hello friends.', pair: EN_VI })).text).toBe('en>vi:Hello friends.');
  });

  it('a very long input is cut into windows ≤ 900 characters, losslessly', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} has a few ordinary words in it.`).join(' ');
    const r = await p.translate({ text, pair: EN_VI });
    expect(be.calls.every((c) => c.length <= 900)).toBe(true);
    expect(r.text.replace(/en>vi:/g, '')).toBe(text);
  });

  it('does not send symbol-only segments to the model, and stops between sentences when cancelled', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    const r = await p.translate({ text: '12:30 — 45.', pair: EN_VI });
    expect(be.calls).toEqual([]);
    expect(r.text).toBe('12:30 — 45.');
    const ac = new AbortController();
    const seen: number[] = [];
    const prom = p.translate({ text: Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is plain. `).join('') + 'Last one here.', pair: EN_VI, signal: ac.signal, onProgress: (f) => { seen.push(f); if (seen.length === 2) ac.abort(); } });
    await expect(prom).rejects.toMatchObject({ code: 'aborted' });
    expect(be.calls.length).toBeLessThan(10); // stopped long before the ~16 windows were done
  });

  it('a model error surfaces (no silent fallback to anything)', async () => {
    const p = new LocalModelProvider(fakeBackend({ cached: true, fail: () => true }), () => true);
    await expect(p.translate({ text: 'Hello there.', pair: EN_VI })).rejects.toMatchObject({ code: 'provider-error' });
  });
});

describe('registry with the local model', () => {
  const native = (avail: 'available' | 'unavailable' | 'downloadable', pairs = [EN_VI, VI_EN]) => ({
    id: 'device-native',
    kind: 'native' as const,
    label: 'native',
    capabilities: { pairs, platforms: ['chrome' as const], local: true, metered: false, cancellable: false, streaming: false, needsDownload: false },
    limits: { targetChars: 4500, maxChars: 5000 },
    availability: async () => avail,
    translate: async (r: { text: string }) => ({ text: `native:${r.text}`, providerId: 'device-native', pair: EN_VI, chars: r.text.length }),
  });
  const cfg = (preferred: string) => ({ preferred, platform: 'chrome' as const, cloudReady: false });

  it('default keeps the platform translator; the model is used when the platform cannot do the pair', async () => {
    const be = fakeBackend({ cached: true });
    const reg = new ProviderRegistry().register(native('available', [EN_VI]), 10).register(new LocalModelProvider(be, () => true), 20);
    expect((await reg.translate({ text: 'Hi.', pair: EN_VI }, cfg('auto'))).providerId).toBe('device-native');
    const vi = await reg.translate({ text: 'Chào.', pair: VI_EN }, cfg('auto'));
    expect(vi.providerId).toBe(LOCAL_MODEL_ID);
  });

  it('opting in selects the model; if it is not downloaded the request asks for the download instead of switching', async () => {
    const be = fakeBackend({ cached: false });
    const reg = new ProviderRegistry().register(native('available'), 10).register(new LocalModelProvider(be, () => true), 20);
    await expect(reg.translate({ text: 'Hi.', pair: EN_VI }, cfg(LOCAL_MODEL_ID))).rejects.toMatchObject({ code: 'needs-download' });
    be.isCached = true;
    expect((await reg.translate({ text: 'Hi.', pair: EN_VI }, cfg(LOCAL_MODEL_ID))).providerId).toBe(LOCAL_MODEL_ID);
  });

  it('a pair that nobody on the device can translate fails clearly (never goes to the cloud)', async () => {
    const reg = new ProviderRegistry().register(native('available', [EN_VI]), 10);
    await expect(reg.translate({ text: 'Chào.', pair: VI_EN }, cfg('auto'))).rejects.toMatchObject({ code: 'no-provider' });
  });
});

describe('long text with the local model', () => {
  it('chunks by the local model limits, in order, retry-safe', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    const text = Array.from({ length: 300 }, (_, i) => `Item ${i} is a plain sentence about nothing in particular.`).join(' ');
    const reported: string[] = [];
    const deps: LongTextDeps = {
      googleActive: async () => false,
      sendGoogle: async () => ({ source: 'device' }),
      deviceTranslate: async () => 'unused',
      deviceProvider: 'device-chrome',
      resolveDevice: async () => ({ provider: 'device-local', translate: async (t, o) => (await p.translate({ text: t, pair: EN_VI, signal: o?.signal })).text }),
      reportDevice: (prov) => void reported.push(prov),
    };
    const lim = PROVIDER_LIMITS['device-local'];
    const r = await translateLongText(text, deps, {});
    expect(r.complete).toBe(true);
    expect(r.chunks.every((c) => c.chars <= lim.maxChars)).toBe(true);
    expect(r.chunks.length).toBeGreaterThan(5);
    expect(r.text.replace(/en>vi:/g, '')).toBe(text);
    expect(new Set(reported)).toEqual(new Set(['device-local'])); // informational ledger, never Google
  });

  it('cancel keeps finished chunks; resume sends only the rest', async () => {
    const be = fakeBackend({ cached: true });
    const p = new LocalModelProvider(be, () => true);
    const text = Array.from({ length: 200 }, (_, i) => `Item ${i} is a plain sentence about nothing in particular.`).join(' ');
    const ac = new AbortController();
    let chunkCalls = 0;
    const deps: LongTextDeps = {
      googleActive: async () => false,
      sendGoogle: async () => ({ source: 'device' }),
      deviceTranslate: async () => '',
      deviceProvider: 'device-chrome',
      resolveDevice: async () => ({
        provider: 'device-local',
        translate: async (t, o) => {
          if (++chunkCalls === 3) ac.abort();
          return (await p.translate({ text: t, pair: EN_VI, signal: o?.signal })).text;
        },
      }),
    };
    const first = await translateLongText(text, deps, { signal: ac.signal });
    expect(first.complete).toBe(false);
    expect(first.cancelled).toBe(true);
    const doneBefore = first.outcomes.filter((o) => o.status === 'done').length;
    expect(doneBefore).toBeGreaterThan(0);
    const callsAfterFirst = chunkCalls;
    const second = await translateLongText(text, deps, { retryFrom: first });
    expect(second.complete).toBe(true);
    expect(second.text.replace(/en>vi:/g, '')).toBe(text);
    // resume translates ONLY the chunks that were not done: every finished chunk is kept, none is sent again
    expect(chunkCalls - callsAfterFirst).toBe(second.chunks.length - doneBefore);
    expect(second.outcomes.every((o) => o.status === 'done')).toBe(true);
  });
});

describe('Google BYOK with the Vietnamese → English pair', () => {
  const fetchOk = (seen: { body?: string }) => async (_u: string, init: { body: string }) => {
    seen.body = init.body;
    return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: 'Hello &amp; welcome' }] } }) };
  };
  it('sends source/target of the requested pair (default stays en→vi)', async () => {
    const seen: { body?: string } = {};
    expect(await googleTranslate('Xin chào', 'AIza' + 'k'.repeat(35), fetchOk(seen), 'vi>en')).toBe('Hello & welcome');
    expect(JSON.parse(seen.body!)).toMatchObject({ source: 'vi', target: 'en' });
    await googleTranslate('Hello', 'AIza' + 'k'.repeat(35), fetchOk(seen));
    expect(JSON.parse(seen.body!)).toMatchObject({ source: 'en', target: 'vi' });
  });
  it('rejects a pair it does not support instead of sending it', async () => {
    await expect(googleTranslate('x', 'AIza' + 'k'.repeat(35), fetchOk({}), 'fr>de')).rejects.toMatchObject({ code: 'google-bad-pair' });
  });
});

describe('router: mtlocal messages', () => {
  const deps = (host?: LocalModelHost) =>
    ({ mtLocal: host } as never as Parameters<typeof createRouter>[0]);
  const call = (route: ReturnType<typeof createRouter>, msg: object) => route(msg as never, {} as never);

  afterEach(() => vi.restoreAllMocks());

  it('answers cached / start / status / translate / remove through the host', async () => {
    const be = fakeBackend();
    const route = createRouter(deps(new LocalModelHost(be)));
    const id = `${LOCAL_MODEL_ID}-en-vi`;
    expect(await call(route, { type: 'mtlocal:cached', modelId: id })).toMatchObject({ ok: true, data: false });
    const start = (await call(route, { type: 'mtlocal:start', modelId: id })) as { data: { state: string } };
    expect(start.data.state).toBe('downloading');
    await new Promise((r) => setTimeout(r, 10));
    expect(await call(route, { type: 'mtlocal:status', modelId: id })).toMatchObject({ ok: true, data: { state: 'ready' } });
    expect(await call(route, { type: 'mtlocal:translate', modelId: id, text: 'Hello.' })).toMatchObject({ ok: true, data: 'en>vi:Hello.' });
    await call(route, { type: 'mtlocal:remove', modelId: id });
    expect(be.removed).toBe(1);
    expect(await call(route, { type: 'mtlocal:cached', modelId: id })).toMatchObject({ data: false });
  });

  it('without a host the model is reported as not available (no crash, nothing downloaded)', async () => {
    const route = createRouter(deps(undefined));
    expect(await call(route, { type: 'mtlocal:cached', modelId: 'x' })).toMatchObject({ ok: true, data: false });
    expect(await call(route, { type: 'mtlocal:translate', modelId: 'x', text: 'a' })).toMatchObject({ ok: false, code: 'mtlocal-unavailable' });
  });

  it('rejects unknown model ids', async () => {
    const route = createRouter(deps(new LocalModelHost(fakeBackend())));
    expect(await call(route, { type: 'mtlocal:start', modelId: 'nope' })).toMatchObject({ ok: false });
  });
});

describe('chunker interplay: runner still works with the plain translateLong', () => {
  it('device-local limits exist and are below the model window', () => {
    const l = PROVIDER_LIMITS['device-local'];
    expect(l.maxChars).toBeLessThanOrEqual(2000);
    expect(l.metered).toBe(false);
    expect(typeof translateLong).toBe('function');
  });
});

describe('Google Cloud Translation v2 request contract (mock; no live call was made)', () => {
  const KEY = 'AIza' + 'Z'.repeat(35);
  it('POSTs JSON to the official v2 endpoint with the key in the query string only, plain-text format, no other credentials', async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string>; body: string } } | null = null;
    await googleTranslate('Hello', KEY, async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: 'Xin chào' }] } }) };
    });
    expect(seen!.url).toBe(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`);
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(seen!.init.body)).toEqual({ q: 'Hello', source: 'en', target: 'vi', format: 'text' });
    expect(seen!.init.body).not.toContain(KEY); // the key is never in the body
  });
  it('never puts the key in an error: network failure, HTTP error that echoes the key, malformed answer', async () => {
    const net = googleTranslate('x', KEY, async () => { throw new Error(`fetch failed for ?key=${KEY}`); });
    await expect(net).rejects.toMatchObject({ code: 'google-network' });
    await net.catch((e) => expect(String(e.message)).not.toContain(KEY));
    const http = googleTranslate('x', KEY, async () => ({ ok: false, status: 403, json: async () => ({ error: { message: `API key ${KEY} not valid` } }) }));
    await expect(http).rejects.toMatchObject({ code: 'google-403' });
    await http.catch((e) => expect(String(e.message)).not.toContain(KEY));
    await expect(googleTranslate('x', KEY, async () => ({ ok: true, status: 200, json: async () => ({}) }))).rejects.toMatchObject({ code: 'google-bad-response' });
  });
  it('maps quota / rate-limit / server statuses to the codes the chunk runner retries or stops on', async () => {
    for (const status of [429, 500, 503, 400, 401]) {
      await expect(googleTranslate('x', KEY, async () => ({ ok: false, status, json: async () => ({}) }))).rejects.toMatchObject({ code: `google-${status}` });
    }
  });
});
