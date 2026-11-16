import { describe, expect, it, vi } from 'vitest';
import { EN_VI, MtError, ProviderRegistry, VI_EN, type Availability, type MtProvider, type Platform, type LanguagePair, pairKey } from '@/modules/mt';

function fake(id: string, o: Partial<{ kind: MtProvider['kind']; local: boolean; metered: boolean; pairs: LanguagePair[]; platforms: Platform[]; avail: Availability; fn: (t: string) => Promise<string> }> = {}): MtProvider & { calls: number } {
  const p = {
    id,
    kind: o.kind ?? 'native',
    label: id,
    capabilities: {
      pairs: o.pairs ?? [EN_VI, VI_EN],
      platforms: o.platforms ?? ['chrome', 'android', 'ios'],
      local: o.local ?? true,
      metered: o.metered ?? false,
      cancellable: false,
      streaming: false,
      needsDownload: false,
    },
    limits: { targetChars: 4500, maxChars: 5000 },
    calls: 0,
    availability: async () => o.avail ?? 'available',
    translate: async (req: { text: string }) => {
      p.calls++;
      const text = await (o.fn ? o.fn(req.text) : Promise.resolve(`[${id}] ${req.text}`));
      return { text, providerId: id, pair: EN_VI, chars: req.text.length };
    },
  };
  return p as MtProvider & { calls: number };
}
const cfg = (preferred = 'auto', extra = {}) => ({ preferred, platform: 'chrome' as const, cloudReady: false, ...extra });

describe('ProviderRegistry', () => {
  it('discovers providers per pair and platform', () => {
    const r = new ProviderRegistry();
    r.register(fake('a', { pairs: [EN_VI] })).register(fake('b')).register(fake('ios-only', { platforms: ['ios'] }));
    expect(r.forPair(VI_EN, 'chrome').map((p) => p.id)).toEqual(['b']);
    expect(r.forPair(EN_VI, 'chrome').map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.forPair(EN_VI, 'ios').map((p) => p.id)).toEqual(['a', 'b', 'ios-only']);
  });

  it('auto picks local providers by priority and never a cloud one', async () => {
    const r = new ProviderRegistry();
    r.register(fake('google', { kind: 'cloud-byok', local: false, metered: true }), 1).register(fake('native'), 10).register(fake('model'), 20);
    const s = await r.select(EN_VI, cfg('auto', { cloudReady: true }));
    expect(s.provider.id).toBe('native');
  });

  it('auto with no local provider fails instead of using the cloud', async () => {
    const r = new ProviderRegistry();
    r.register(fake('google', { kind: 'cloud-byok', local: false, metered: true }));
    await expect(r.select(EN_VI, cfg('auto', { cloudReady: true }))).rejects.toMatchObject({ code: 'no-provider' });
  });

  it('auto skips an unavailable provider and offers a download-needing one only when nothing is ready', async () => {
    const r = new ProviderRegistry();
    r.register(fake('native', { avail: 'unavailable' }), 1).register(fake('model', { avail: 'downloadable', kind: 'local-model' }), 2);
    const s = await r.select(EN_VI, cfg());
    expect(s.provider.id).toBe('model');
    expect(s.availability).toBe('downloadable');
    await expect(r.translate({ text: 'hi', pair: EN_VI }, cfg())).rejects.toMatchObject({ code: 'needs-download' });
  });

  it('explicit choice is exact: no silent switch to another provider', async () => {
    const r = new ProviderRegistry();
    const native = fake('native');
    const model = fake('model', { avail: 'unavailable' });
    r.register(native, 1).register(model, 2);
    await expect(r.select(EN_VI, cfg('model'))).resolves.toMatchObject({ provider: { id: 'model' }, fallbacks: [] });
    await expect(r.translate({ text: 'x', pair: EN_VI }, cfg('model'))).rejects.toMatchObject({ code: 'unavailable' });
    expect(model.calls).toBe(0);
    expect(native.calls).toBe(0);
  });

  it('unsupported pair is rejected before anything is sent', async () => {
    const r = new ProviderRegistry();
    const p = fake('only-en-vi', { pairs: [EN_VI] });
    r.register(p);
    await expect(r.translate({ text: 'x', pair: VI_EN }, cfg('only-en-vi'))).rejects.toMatchObject({ code: 'unsupported-pair' });
    expect(p.calls).toBe(0);
  });

  it('cloud provider needs a valid key; with a key it may fall back to a LOCAL provider only', async () => {
    const r = new ProviderRegistry();
    const google = fake('google', { kind: 'cloud-byok', local: false, metered: true, fn: async () => { throw new MtError('unavailable', 'offline'); } });
    const native = fake('native');
    r.register(google, 1).register(native, 2);
    await expect(r.select(EN_VI, cfg('google'))).rejects.toMatchObject({ code: 'unavailable' }); // no key
    const out = await r.translate({ text: 'hello', pair: EN_VI }, cfg('google', { cloudReady: true }));
    expect(out.providerId).toBe('native'); // transparent: the response says who translated
  });

  it('a local provider never falls back to a cloud provider', async () => {
    const r = new ProviderRegistry();
    const native = fake('native', { fn: async () => { throw new MtError('unavailable', 'no model'); } });
    const google = fake('google', { kind: 'cloud-byok', local: false, metered: true });
    r.register(native, 1).register(google, 2);
    await expect(r.translate({ text: 'secret', pair: EN_VI }, cfg('native', { cloudReady: true }))).rejects.toMatchObject({ code: 'unavailable' });
    expect(google.calls).toBe(0);
  });

  it('blocked / fatal errors are not retried on another provider', async () => {
    const r = new ProviderRegistry();
    const google = fake('google', { kind: 'cloud-byok', local: false, metered: true, fn: async () => { throw new MtError('blocked', 'quota'); } });
    const native = fake('native');
    r.register(google, 1).register(native, 2);
    await expect(r.translate({ text: 'x', pair: EN_VI }, cfg('google', { cloudReady: true }))).rejects.toMatchObject({ code: 'blocked' });
    expect(native.calls).toBe(0);
  });

  it('times out and aborts', async () => {
    vi.useFakeTimers();
    const r = new ProviderRegistry();
    r.register(fake('slow', { fn: () => new Promise(() => {}) }));
    const p = r.translate({ text: 'x', pair: EN_VI, timeoutMs: 50 }, cfg('slow'));
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
    const ac = new AbortController();
    const q = r.translate({ text: 'x', pair: EN_VI, signal: ac.signal }, cfg('slow'));
    const assertion2 = expect(q).rejects.toMatchObject({ code: 'aborted' });
    await new Promise((res) => setTimeout(res, 5));
    ac.abort();
    await assertion2;
  });

  it('response names provider and pair (transparency)', async () => {
    const r = new ProviderRegistry();
    r.register(fake('native'));
    const out = await r.translate({ text: 'hi', pair: EN_VI }, cfg());
    expect(out).toMatchObject({ providerId: 'native', pair: EN_VI });
    expect(pairKey(out.pair)).toBe('en-vi');
  });
});
