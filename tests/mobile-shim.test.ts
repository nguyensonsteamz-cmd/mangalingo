// @vitest-environment jsdom
/**
 * Android app: the chrome.* shim lets the extension's storage layer and UI run in a WebView.
 */
import { describe, expect, it, vi } from 'vitest';
import '@/mobile/shim';
import { chromeLocal } from '@/storage/kv';
import { SettingsStore } from '@/storage/settings-store';
import { VocabStore } from '@/storage/vocab-store';

describe('mobile chrome.* shim', () => {
  it('storage.local round-trips JSON through localStorage and reports usage', async () => {
    await chrome.storage.local.set({ a: { x: 1 }, b: [1, 2] });
    expect(await chrome.storage.local.get(['a', 'b', 'missing'])).toEqual({ a: { x: 1 }, b: [1, 2] });
    expect(JSON.parse(localStorage.getItem('ml:a')!)).toEqual({ x: 1 });
    expect(await chrome.storage.local.getBytesInUse(null)).toBeGreaterThan(0);
    await chrome.storage.local.remove('a');
    expect(await chrome.storage.local.get('a')).toEqual({});
  });

  it('fires onChanged so settings apply live (same contract as the extension)', async () => {
    const store = new SettingsStore(chromeLocal());
    const seen = vi.fn();
    const off = store.subscribe((s) => seen(s.popup.width));
    await store.update({ popup: { width: 450 } });
    expect(seen).toHaveBeenCalledWith(450);
    off();
    expect((await store.load()).popup.width).toBe(450);
  });

  it('enforces the 10 MB quota like chrome.storage.local (vocabulary notebook gets a clear error)', async () => {
    await expect(chrome.storage.local.set({ big: 'x'.repeat(11 * 1024 * 1024) })).rejects.toThrow(/QUOTA/);
    const vocab = new VocabStore(chromeLocal());
    const { entry: e, created } = await vocab.add({ word: 'window', lemma: 'window', meaning: 'cửa sổ' });
    expect(created).toBe(true);
    expect((await vocab.list()).map((x) => x.word)).toContain('window');
    expect(e.status).toBe('new');
  });

  it('provides the small runtime surface the UI touches', async () => {
    expect(chrome.runtime.getManifest().name).toBe('LingoLens');
    expect(await chrome.commands.getAll()).toEqual([]);
    expect((await chrome.windows.getCurrent()).id).toBe(1);
  });
});
