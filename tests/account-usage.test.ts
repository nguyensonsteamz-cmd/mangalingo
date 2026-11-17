import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import { UsageService } from '@/modules/usage';
import { GoogleCloudClient, type FetchFn } from '@/modules/smart-setup';

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
  } as KV;
}

describe('usage by Google account (all platforms)', () => {
  it('the account figure becomes the base; what this device adds afterwards is added on top; a wrong month is ignored', async () => {
    const now = new Date('2026-11-17T10:00:00Z');
    const kv = memoryKV();
    const fetchImpl = async (_u: string, init: { body: string }) => ({ ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: 'x' }] } }), _q: JSON.parse(init.body) });
    const svc = new UsageService(kv, { clock: () => now, fetchImpl: fetchImpl as never });
    await svc.activateGoogle('AIza-test-key-0000000000000000000000000');
    let snap = await svc.snapshot();
    expect(snap.usedChars).toBe(0);
    expect(snap.accountAt).toBeUndefined();

    snap = await svc.setAccountUsage(120_000, '2026-11');
    expect(snap.usedChars).toBe(120_000);
    expect(snap.accountChars).toBe(120_000);
    expect(snap.accountAt).toBe(now.getTime());

    await svc.translate('Hello world'); // 11 chars from this device, after the reading
    snap = await svc.snapshot();
    expect(snap.usedChars).toBe(120_011);

    snap = await svc.setAccountUsage(999, '2026-10'); // another month: ignored
    expect(snap.usedChars).toBe(120_011);
  });

  it('the quota guard uses the account figure: a request that crosses the free quota because of OTHER platforms is not free', async () => {
    const now = new Date('2026-11-17T10:00:00Z');
    const kv = memoryKV();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: 'x' }] } }) });
    const svc = new UsageService(kv, { clock: () => now, fetchImpl: fetchImpl as never });
    await svc.activateGoogle('AIza-test-key-0000000000000000000000000');
    await svc.setAccountUsage(499_998, '2026-11'); // the free quota is 500,000
    const r = await svc.translate('Hello world'); // 11 chars would cross it; paid translation is off by default
    expect(r.source).toBe('blocked');
  });
});

describe('Cloud Monitoring client', () => {
  const client = (body: unknown, seen: string[] = []) =>
    new GoogleCloudClient({
      fetchImpl: (async (url: string) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => body };
      }) as FetchFn,
    });

  it('sums the quota metrics that name characters, per metric', async () => {
    const seen: string[] = [];
    const c = client(
      {
        timeSeries: [
          { metric: { labels: { quota_metric: 'translate.googleapis.com/v2_characters' } }, points: [{ value: { int64Value: '1200' } }, { value: { int64Value: '300' } }] },
          { metric: { labels: { quota_metric: 'translate.googleapis.com/default' } }, points: [{ value: { int64Value: '7' } }] },
        ],
      },
      seen,
    );
    const r = await c.translateUsage('tok', 'my-proj', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-17T00:00:00Z'));
    expect(r.chars).toBe(1500);
    expect(r.byMetric['translate.googleapis.com/default']).toBe(7);
    expect(seen[0]).toContain('/projects/my-proj/timeSeries');
    expect(seen[0]).toContain('translate.googleapis.com');
  });

  it('no series = 0 characters; a metric without "char" in its name = null (the caller says what was found)', async () => {
    expect((await client({}).translateUsage('t', 'p', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'))).chars).toBe(0);
    const r = await client({ timeSeries: [{ metric: { labels: { quota_metric: 'translate.googleapis.com/requests' } }, points: [{ value: { int64Value: '3' } }] }] }).translateUsage('t', 'p', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-02T00:00:00Z'));
    expect(r.chars).toBeNull();
  });
});
