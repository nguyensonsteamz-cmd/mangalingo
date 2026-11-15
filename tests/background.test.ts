/**
 * Integration tests for the service-worker side: message router, sidebar communication and the
 * OCR orchestration (cache → fetch → capture fallback, cancel, failure) with Chrome APIs faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, type RouterDeps } from '@/background/router';
import { SidebarState, SIDEBAR_KEY } from '@/background/sidebar';
import type { PageEvent } from '@/shared/messages';
import { memoryKV } from '@/storage/kv';
import { OcrCache } from '@/storage/ocr-cache';

function session() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k: string) => ({ [k]: data[k] }),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  };
}

describe('sidebar communication', () => {
  it('persists the payload in session storage and broadcasts it to open panels', async () => {
    const s = session();
    const events: PageEvent[] = [];
    const sb = new SidebarState(s, async (e) => void events.push(e));
    await sb.push({ type: 'lookup', text: 'gave up' });
    await sb.push({ type: 'lookup', text: 'dream' });
    await sb.push({ type: 'lookup', text: 'gave up' });
    expect((await sb.current())).toMatchObject({ text: 'gave up' });
    expect(events.map((e) => (e.type === 'sidebar:update' && e.payload.type === 'lookup' ? e.payload.text : ''))).toEqual(['gave up', 'dream', 'gave up']);
    expect((s.data['sidebar:history'] as { text: string }[]).map((h) => h.text)).toEqual(['gave up', 'dream']);
    expect(s.data[SIDEBAR_KEY]).toBeDefined();
  });
  it('tracks open panels per window (for the toggle shortcut)', () => {
    const sb = new SidebarState(session(), async () => {});
    sb.connected(1);
    sb.connected(1);
    sb.disconnected(1);
    expect(sb.isOpen(1)).toBe(true);
    sb.disconnected(1);
    expect(sb.isOpen(1)).toBe(false);
    expect(sb.isOpen(2)).toBe(false);
  });
});

describe('message router', () => {
  let deps: RouterDeps;
  let order: string[];
  beforeEach(() => {
    order = [];
    const sidebar = new SidebarState(session(), async () => void order.push('broadcast'));
    deps = {
      lookup: vi.fn(async (req) => ({ kind: 'unsupported', text: req.text, language: { code: 'fr', name: 'fr', confidence: 1, script: 'Latin', method: 't' } }) as never),
      scan: vi.fn(async () => ({}) as never),
      warmOcr: vi.fn(async () => true),
    cancelScan: vi.fn(async () => true),
      clearOcrCache: vi.fn(async () => 3),
      sidebar,
      openSidePanel: vi.fn((tab) => {
        order.push(`open:${tab.id}`);
        return Promise.resolve();
      }),
      openOptions: vi.fn(async () => {}),
      openShortcuts: vi.fn(async () => {}),
      dictStats: vi.fn(async () => ({ sources: [], userEntries: 0, userSets: [] })),
      dictImport: vi.fn(async () => ({ imported: 1, skipped: 0, errors: [] })),
      dictClearUser: vi.fn(async () => {}),
    };
  });
  const sender = { tab: { id: 7, windowId: 3 } } as chrome.runtime.MessageSender;

  it('wraps results in an envelope and ignores unknown messages', async () => {
    const route = createRouter(deps);
    expect(await route({ type: 'ping' }, sender)).toEqual({ ok: true, data: 'pong' });
    expect(await route({ type: 'lookup', req: { text: 'salut' } }, sender)).toMatchObject({ ok: true, data: { kind: 'unsupported' } });
    expect(await route({ type: 'nope' }, sender)).toBeUndefined();
    expect(await route(null, sender)).toBeUndefined();
  });
  it('turns thrown errors into { ok: false } with the error code', async () => {
    deps.scan = vi.fn(async () => {
      throw Object.assign(new Error('Đã hủy OCR.'), { code: 'cancelled' });
    });
    const r = await createRouter(deps)({ type: 'ocr:scan', jobId: 'j', target: {} as never }, sender);
    expect(r).toEqual({ ok: false, error: 'Đã hủy OCR.', code: 'cancelled' });
  });
  it('opens the side panel synchronously (user gesture) before delivering the payload', async () => {
    const route = createRouter(deps);
    const p = route({ type: 'sidebar:open', payload: { type: 'lookup', text: 'hi' } }, sender);
    expect(order[0]).toBe('open:7'); // called before any await
    await p;
    expect(order).toEqual(['open:7', 'broadcast']);
  });
  it('passes the sender tab to OCR scans and limits import size', async () => {
    const route = createRouter(deps);
    await route({ type: 'ocr:scan', jobId: 'j1', target: { layout: 'sparse' } as never }, sender);
    expect(deps.scan).toHaveBeenCalledWith('j1', { layout: 'sparse' }, { id: 7, windowId: 3 });
    const big = await route({ type: 'dict:import', name: 'x', format: 'csv', text: 'x'.repeat(61 * 1024 * 1024) }, sender);
    expect(big).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------- OCR orchestration
const offscreen = vi.hoisted(() => ({ calls: [] as { type: string }[], impl: null as null | ((m: { type: string }) => unknown) }));
vi.mock('@/background/offscreen-client', () => ({
  callOffscreen: vi.fn(async (msg: { type: string }) => {
    offscreen.calls.push(msg);
    return offscreen.impl!(msg);
  }),
  ensureOffscreen: vi.fn(async () => {}),
}));
const { OcrService } = await import('@/background/ocr-service');

const RAW = {
  blocks: [{ paragraphs: [{ lines: [{ bbox: { x0: 10, y0: 10, x1: 110, y1: 40 }, words: [{ text: 'HELLO', confidence: 92, bbox: { x0: 10, y0: 10, x1: 110, y1: 40 } }] }] }] }],
  width: 200,
  height: 100,
  durationMs: 5,
};

describe('OCR service', () => {
  const capture = vi.fn(async () => 'data:image/png;base64,AAAA');
  beforeEach(() => {
    offscreen.calls = [];
    offscreen.impl = (m) => (m.type === 'prepare' ? { pixelKey: 'px1', width: 200, height: 100 } : m.type === 'recognize' ? RAW : true);
    capture.mockClear();
    vi.stubGlobal('chrome', { tabs: { captureVisibleTab: capture } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })));
  });
  const target = { src: 'https://cdn.example/p1.png', viewportRect: { x: 0, y: 0, w: 200, h: 100 }, visibleFraction: { x: 0, y: 0.5, w: 1, h: 0.5 }, devicePixelRatio: 2, cacheKey: 'https://cdn.example/p1.png|200x100', layout: 'sparse' as const, lang: 'eng', useCache: true };
  const svc = (kv = memoryKV()) => new OcrService(new OcrCache(kv), async () => ({ threshold: 45, autoCache: true }), () => {});

  it('fetches the full image, recognises, post-processes and caches', async () => {
    const s = svc();
    const r = await s.scan('j1', target, { id: 1, windowId: 1 });
    expect(r).toMatchObject({ acquisition: 'image-fetch', partial: false, text: 'HELLO', fromCache: false });
    expect(r.blocks[0].box).toEqual({ x: 0.05, y: 0.1, w: 0.5, h: 0.3 });
    expect(capture).not.toHaveBeenCalled();
    const again = await s.scan('j2', target, { id: 1, windowId: 1 });
    expect(again.fromCache).toBe(true);
    expect(offscreen.calls.filter((c) => c.type === 'recognize')).toHaveLength(1); // no second OCR run
  });
  it('falls back to captureVisibleTab when fetching fails and maps the visible part', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const hooks = { begin: vi.fn(async () => {}), end: vi.fn(async () => {}) };
    const s = new OcrService(new OcrCache(memoryKV()), async () => ({ threshold: 45, autoCache: true }), () => {}, hooks);
    const r = await s.scan('j3', target, { id: 4, windowId: 9 });
    expect(capture).toHaveBeenCalledWith(9, { format: 'png' });
    expect(hooks.begin).toHaveBeenCalledWith(4);
    expect(hooks.end).toHaveBeenCalledWith(4);
    expect(r.acquisition).toBe('visible-capture');
    expect(r.partial).toBe(true);
    expect(r.blocks[0].box.y).toBeCloseTo(0.55); // 0.5 + 0.1 * 0.5
    const prep = offscreen.calls.find((c) => c.type === 'prepare') as unknown as { crop: unknown };
    expect(prep.crop).toEqual({ x: 0, y: 0, w: 400, h: 200 }); // CSS px × devicePixelRatio
  });
  it('reports OCR failures as errors', async () => {
    offscreen.impl = (m) => {
      if (m.type === 'recognize') throw new Error('worker crashed');
      return { pixelKey: 'px2', width: 10, height: 10 };
    };
    await expect(svc().scan('j4', target, { id: 1, windowId: 1 })).rejects.toThrow('worker crashed');
  });
  it('can be cancelled mid-recognition', async () => {
    let release!: () => void;
    offscreen.impl = (m) => {
      if (m.type === 'prepare') return { pixelKey: 'px3', width: 10, height: 10 };
      if (m.type === 'recognize') return new Promise((r) => (release = () => r(RAW)));
      return true;
    };
    const s = svc();
    const p = s.scan('j5', { ...target, useCache: false }, { id: 1, windowId: 1 });
    await vi.waitFor(() => expect(offscreen.calls.some((c) => c.type === 'recognize')).toBe(true));
    expect(await s.cancel('j5')).toBe(true);
    release();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(offscreen.calls.some((c) => c.type === 'cancel')).toBe(true);
  });
  it('rejects languages that are not bundled', async () => {
    await expect(svc().scan('j6', { ...target, lang: 'jpn_vert' }, { id: 1 })).rejects.toMatchObject({ code: 'lang' });
  });
});

describe('connected balloons read with overlapping crops', () => {
  it('a line in two blocks stays only in the upper one; the lower block is rebuilt', async () => {
    const { resolveOverlaps } = await import('@/background/ocr-service');
    const L = (text: string, y: number) => ({ text, confidence: 90, box: { x: 0.1, y, w: 0.2, h: 0.02 }, words: [{ text, confidence: 90, box: { x: 0.1, y, w: 0.2, h: 0.02 } }] });
    const top = { id: 'b0', text: "IF YOU CLIMB UP THE", confidence: 90, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.08 }, lines: [L('IF YOU CLIMB', 0.1), L('UP THE', 0.155)] };
    const low = { id: 'b1', text: 'UP THE WALLS TO', confidence: 90, box: { x: 0.1, y: 0.15, w: 0.2, h: 0.08 }, lines: [L('UP THE', 0.155), L('WALLS TO', 0.2)] };
    const out = resolveOverlaps([top, low]);
    expect(out.map((b) => b.text)).toEqual(['IF YOU CLIMB UP THE', 'WALLS TO']);
    expect(out[1].box.y).toBeGreaterThanOrEqual(0.2);
  });
});
