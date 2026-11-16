import { describe, expect, it } from 'vitest';
import { LocalMtEngine, LocalModelHost, MtError, type LocalModelSpec, type WorkerLike } from '@/modules/mt';

const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);

class FakeCache {
  m = new Map<string, Uint8Array>();
  async keys() {
    return [...this.m.keys()].map((url) => ({ url }) as Request);
  }
  async match(r: Request) {
    const b = this.m.get(r.url);
    return b ? new Response(b as BufferSource) : undefined;
  }
  async delete(r: Request) {
    return this.m.delete(r.url);
  }
}
const storage = (c: FakeCache) => ({ open: async () => c }) as unknown as CacheStorage;

async function rig(o: { corrupt?: boolean; truncate?: boolean; quota?: { quota: number; usage: number }; loadFails?: boolean; hang?: boolean } = {}) {
  const A = bytes(2000, 1);
  const B = bytes(3000, 2);
  const spec: LocalModelSpec = {
    id: 'local-opus-mt-en-vi', label: 't', repo: 'T/model', revision: 'a'.repeat(40),
    upstream: { repo: 'U/model', revision: 'b'.repeat(40), license: 'apache-2.0' },
    dtype: 'q8', pair: { source: 'en', target: 'vi' }, downloadBytes: 5000, peakRamBytes: 1, maxChars: 900,
    files: [
      { path: 'onnx/encoder.onnx', bytes: 2000, sha256: await sha(A) },
      { path: 'onnx/decoder.onnx', bytes: 3000, sha256: await sha(B) },
    ],
  };
  const cache = new FakeCache();
  const url = (p: string, rev = spec.revision) => `https://huggingface.co/T/model/resolve/${rev}/${p}`;
  const log = { spawned: 0, terminated: 0, prepares: 0, translates: 0 };
  const makeWorker = (): WorkerLike => {
    log.spawned++;
    const w: WorkerLike = {
      onmessage: null, onerror: null,
      terminate: () => void log.terminated++,
      postMessage: (m: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const reply = (x: object) => setTimeout(() => w.onmessage?.({ data: { id: m.id, ...x } }), 0);
        if (m.op === 'init') return reply({ type: 'done' });
        if (m.op === 'prepare') {
          log.prepares++;
          if (o.hang) return; // never answers: a download in flight
          cache.m.set(url('onnx/encoder.onnx'), o.corrupt ? bytes(2000, 9) : o.truncate ? A.slice(0, 10) : A);
          cache.m.set(url('onnx/decoder.onnx'), B);
          return reply({ type: 'done' });
        }
        if (m.op === 'translate') {
          log.translates++;
          return o.loadFails ? reply({ type: 'error', code: 'load-failed', message: 'bad onnx' }) : reply({ type: 'done', text: `T(${m.text})` });
        }
      },
    };
    return w;
  };
  const engine = new LocalMtEngine(makeWorker, 'x/', storage(cache), async () => o.quota ?? { quota: 1e12, usage: 0 }, async (b) => crypto.subtle.digest('SHA-256', b));
  return { engine, spec, cache, url, log, A, B };
}

describe('model lifecycle: download, integrity, storage', () => {
  it('downloads, verifies SHA-256 + size, then reports it as cached and verified', async () => {
    const { engine, spec, log } = await rig();
    expect(await engine.cached(spec)).toBe(false);
    expect(await engine.verify(spec)).toBe('missing');
    const prog: number[] = [];
    await engine.prepare(spec, (l, t) => prog.push(l / t));
    expect(await engine.cached(spec)).toBe(true);
    expect(await engine.verify(spec)).toBe('ok');
    expect(log.prepares).toBe(1);
  });

  it('a corrupt download (wrong hash) is deleted and reported — never kept', async () => {
    const { engine, spec, cache } = await rig({ corrupt: true });
    await expect(engine.prepare(spec)).rejects.toMatchObject({ code: 'provider-error', extra: { detail: 'corrupt' } });
    expect(cache.m.size).toBe(0);
    expect(await engine.cached(spec)).toBe(false);
  });

  it('a truncated file is not "cached"; verify reports corrupt', async () => {
    const { engine, spec } = await rig({ truncate: true });
    await engine.prepare(spec).catch(() => {});
    const r = await rig({ truncate: true });
    await r.engine.prepare(r.spec).catch(() => {});
    // put the truncated entry back by hand to test cached()/verify() directly
    r.cache.m.set(r.url('onnx/encoder.onnx'), r.A.slice(0, 10));
    r.cache.m.set(r.url('onnx/decoder.onnx'), r.B);
    expect(await r.engine.cached(r.spec)).toBe(false);
    expect(await r.engine.verify(r.spec)).toBe('corrupt');
    expect(engine).toBeTruthy();
  });

  it('refuses to start a download when free storage is too small (nothing is downloaded)', async () => {
    const { engine, spec, log } = await rig({ quota: { quota: 6000, usage: 0 } }); // needs 2 × 5000
    await expect(engine.prepare(spec)).rejects.toMatchObject({ code: 'unavailable', extra: { detail: 'low-storage' } });
    expect(log.prepares).toBe(0);
  });

  it('two simultaneous downloads of the same model share ONE download', async () => {
    const { engine, spec, log } = await rig();
    await Promise.all([engine.prepare(spec), engine.prepare(spec)]);
    expect(log.prepares).toBe(1);
  });

  it('deletes the files of an older pinned revision when the new one is downloaded', async () => {
    const { engine, spec, cache, url } = await rig();
    cache.m.set(url('onnx/encoder.onnx', 'c'.repeat(40)), new Uint8Array(10));
    await engine.prepare(spec);
    expect([...cache.m.keys()].some((u) => u.includes('c'.repeat(40)))).toBe(false);
    expect(await engine.cached(spec)).toBe(true);
  });

  it('cancel stops the download in flight and leaves nothing behind', async () => {
    const { engine, spec, log, cache } = await rig({ hang: true });
    const host = new LocalModelHost(engine);
    await host.start(spec.id).catch(() => {});
    // the host knows only built-in specs: drive the engine directly too
    const p = engine.prepare(spec);
    p.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    await engine.cancel(spec);
    await expect(p).rejects.toBeInstanceOf(MtError);
    expect(log.terminated).toBeGreaterThan(0);
    expect(cache.m.size).toBe(0);
  });

  it('remove deletes the files and frees the worker', async () => {
    const { engine, spec, log, cache } = await rig();
    await engine.prepare(spec);
    await engine.remove(spec);
    expect(cache.m.size).toBe(0);
    expect(log.terminated).toBeGreaterThan(0);
    expect(await engine.cached(spec)).toBe(false);
  });
});

describe('recovery when a cached model cannot be loaded', () => {
  it('damaged files (hash mismatch): the model is deleted and the user is asked to download again', async () => {
    const { engine, spec, cache, url, A } = await rig({ loadFails: true });
    cache.m.set(url('onnx/encoder.onnx'), bytes(2000, 9)); // same size, wrong content
    cache.m.set(url('onnx/decoder.onnx'), bytes(3000, 2));
    expect(A.length).toBe(2000);
    await expect(engine.translate(spec, 'hello')).rejects.toMatchObject({ code: 'needs-download', extra: { detail: 'corrupt' } });
    expect(cache.m.size).toBe(0);
  });

  it('intact files but a load failure (e.g. out of memory): the model is KEPT, no 100 MB re-download is forced', async () => {
    const { engine, spec, cache } = await rig({ loadFails: true });
    await engine.prepare(spec).catch(() => {});
    // prepare ran with loadFails (prepare itself succeeds in the fake); the files are intact
    expect(await engine.verify(spec)).toBe('ok');
    await expect(engine.translate(spec, 'hello')).rejects.toMatchObject({ code: 'provider-error', extra: { detail: 'load-failed-intact' } });
    expect(cache.m.size).toBe(2);
  });
});
