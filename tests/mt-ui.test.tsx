// @vitest-environment jsdom
/**
 * The translation block with the downloaded model: when the platform translator cannot do the pair, the block offers the model
 * (with its size), downloads ONLY after the click, then translates; provider name is shown; nothing is downloaded by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DEFAULT_SETTINGS } from '@/shared/settings';

const state = { cached: false, started: 0, translated: [] as string[], progressPolls: 0 };
vi.mock('@/shared/messages', async (orig) => {
  const real = await orig<typeof import('@/shared/messages')>();
  return {
    ...real,
    send: vi.fn(async (req: { type: string; text?: string; modelId?: string }) => {
      switch (req.type) {
        case 'usage:snapshot':
          return { settings: { provider: 'device' }, hasKey: false };
        case 'mtlocal:cached':
          return state.cached;
        case 'mtlocal:start':
          state.started++;
          return { state: 'downloading', loaded: 0, total: 100 };
        case 'mtlocal:status':
          state.progressPolls++;
          if (state.progressPolls < 2) return { state: 'downloading', loaded: 50, total: 100 };
          state.cached = true;
          return { state: 'ready', loaded: 100, total: 100 };
        case 'mtlocal:translate':
          state.translated.push(String(req.text));
          return `EN(${req.text})`;
        default:
          return true;
      }
    }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { chrome?: unknown }).chrome = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } };

const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  state.cached = false;
  state.started = 0;
  state.translated = [];
  state.progressPolls = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // a browser with NO translator for any pair
  (globalThis as { Translator?: unknown }).Translator = { availability: async () => 'unavailable', create: async () => { throw new Error('no'); } };
  vi.resetModules();
});

async function enableModel() {
  (await import('@/translation/mt-providers')).setLocalModelEnabled(true);
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as { Translator?: unknown }).Translator;
});

describe('MachineTranslation with the downloaded model', () => {
  it('offers the model with its size, downloads only after the click, then shows the translation and the provider', async () => {
    await enableModel();
    const { MachineTranslation } = await import('@/ui/MachineTranslation');
    await act(async () => root.render(<MachineTranslation text="Xin chào các bạn, hôm nay trời đẹp quá." s={DEFAULT_SETTINGS} />));
    await tick(30);
    const need = host.querySelector('[data-ml-mt-need-local]');
    expect(need).toBeTruthy();
    expect(need!.textContent).toContain('Việt → Anh');
    expect(need!.textContent).toMatch(/~10\d MB/); // size on the button
    expect(state.started).toBe(0); // NOTHING downloaded yet
    expect(state.translated).toEqual([]);

    await act(async () => (host.querySelector('[data-ml-mt-download-local]') as HTMLButtonElement).click());
    await tick(1500); // polls twice (400 ms apart), then translates
    expect(state.started).toBe(1);
    const done = host.querySelector('[data-ml-mt-text]');
    expect(done?.textContent).toContain('EN(Xin chào các bạn');
    expect(host.querySelector('[data-ml-mt-provider]')).toBeNull(); // product decision: no provider label under the translation
  });

  it('with the model already on the device it translates without any prompt', async () => {
    state.cached = true;
    await enableModel();
    const { MachineTranslation } = await import('@/ui/MachineTranslation');
    await act(async () => root.render(<MachineTranslation text="Tôi muốn đặt một bàn cho bốn người." s={DEFAULT_SETTINGS} />));
    await tick(80);
    expect(host.querySelector('[data-ml-mt-need-local]')).toBeNull();
    expect(host.querySelector('[data-ml-mt-text]')?.textContent).toContain('EN(Tôi muốn đặt một bàn');
    expect(state.started).toBe(0);
  });

  it('English text with no translator and no model: offers the English → Vietnamese model (never goes to the cloud)', async () => {
    await enableModel();
    const { MachineTranslation } = await import('@/ui/MachineTranslation');
    await act(async () => root.render(<MachineTranslation text="Where is the nearest train station, please?" s={DEFAULT_SETTINGS} />));
    await tick(30);
    expect(host.querySelector('[data-ml-mt-need-local]')?.textContent).toContain('Anh → Việt');
    expect(state.started).toBe(0);
  });
});
