// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { realDictionary } from './helpers/dict';
import { lookupWord } from '@/ui/vocab-enrich';
import { AddWordForm } from '@/ui/AddWordForm';
import type { VocabStore } from '@/storage/vocab-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { service } = realDictionary();

beforeAll(() => {
  // the page talks to the background router: answer 'lookup' with the real dictionary
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (msg: { type: string; req: Parameters<typeof service.lookup>[0] }) => {
        if (msg.type === 'lookup') return { ok: true, data: await service.lookup(msg.req) };
        return { ok: false, error: 'unexpected ' + msg.type };
      },
    },
  });
});

describe('dictionary data for a word the user adds', () => {
  it('a known word gets its pronunciation, part of speech and Vietnamese meaning', async () => {
    const info = await lookupWord('village');
    expect(info?.lemma).toBe('village');
    expect(info?.pos).toBe('noun');
    expect(info?.ipa).toBeTruthy();
    expect(info?.meaning).toMatch(/làng/);
  });
  it('a phrase, an empty text or an unknown word gives nothing (never an invented entry)', async () => {
    expect(await lookupWord('piece of cake')).toBeNull();
    expect(await lookupWord('   ')).toBeNull();
    expect(await lookupWord('zzqxjv')).toBeNull();
  });
  it('a failing background never throws', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => Promise.reject(new Error('gone')) } });
    expect(await lookupWord('village')).toBeNull();
  });
});

describe('"Thêm từ" form of the vocabulary notebook', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  const setup = () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: async (msg: { type: string; req: Parameters<typeof service.lookup>[0] }) => ({ ok: true, data: await service.lookup(msg.req) }) },
    });
    const added: unknown[] = [];
    const store = { add: vi.fn(async (input: unknown) => (added.push(input), { entry: input, created: true })) } as unknown as VocabStore;
    const done = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<AddWordForm store={store} onDone={done} />));
    const type = (sel: string, value: string) => {
      const el = host.querySelector(sel) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const click = async (sel: string) => {
      await act(async () => {
        (host.querySelector(sel) as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 30));
      });
    };
    return { host, store, added, done, type, click };
  };

  it('Lưu is disabled until a word is typed; nothing is added before it is pressed', () => {
    const { host, store, type } = setup();
    expect((host.querySelector('[data-ml-add-word-save]') as HTMLButtonElement).disabled).toBe(true);
    type('[data-ml-add-word-input]', 'village');
    expect((host.querySelector('[data-ml-add-word-save]') as HTMLButtonElement).disabled).toBe(false);
    expect(store.add).not.toHaveBeenCalled();
  });

  it('pressing Lưu adds the word with its dictionary data when no meaning was typed', async () => {
    const { store, added, done, type, click } = setup();
    type('[data-ml-add-word-input]', 'village');
    await click('[data-ml-add-word-save]');
    expect(store.add).toHaveBeenCalledTimes(1);
    const w = added[0] as { word: string; lemma: string; ipa?: string; pos?: string; meaning: string };
    expect(w).toMatchObject({ word: 'village', lemma: 'village', pos: 'noun' });
    expect(w.ipa).toBeTruthy();
    expect(w.meaning).toMatch(/làng/);
    expect(done).toHaveBeenCalledWith(expect.stringContaining('Đã lưu'));
  });

  it('the meaning the user typed is kept (the dictionary only fills the rest)', async () => {
    const { added, type, click } = setup();
    type('[data-ml-add-word-input]', 'village');
    type('[data-ml-add-word-meaning]', 'xóm nhỏ của tôi');
    await click('[data-ml-add-word-save]');
    expect((added[0] as { meaning: string; ipa?: string }).meaning).toBe('xóm nhỏ của tôi');
    expect((added[0] as { ipa?: string }).ipa).toBeTruthy();
  });

  it('a word the dictionary does not know is still saved (without invented data) and the user is told', async () => {
    const { added, done, type, click } = setup();
    type('[data-ml-add-word-input]', 'zzqxjv');
    await click('[data-ml-add-word-save]');
    expect(added[0]).toMatchObject({ word: 'zzqxjv', lemma: 'zzqxjv', meaning: '' });
    expect((added[0] as { ipa?: string }).ipa).toBeUndefined();
    expect(done).toHaveBeenCalledWith(expect.stringContaining('chưa có trong từ điển'));
  });

  it('Hủy closes the form without adding anything', async () => {
    const { store, done, click } = setup();
    await click('[data-ml-add-word-cancel]');
    expect(done).toHaveBeenCalledWith('');
    expect(store.add).not.toHaveBeenCalled();
  });
});
