import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@/shared/settings';

const load = async () => {
  vi.resetModules();
  return import('@/translation/chrome-mt');
};
afterEach(() => {
  delete (globalThis as { Translator?: unknown }).Translator;
});

describe('machine translation (Chrome Translator API, opt-in)', () => {
  it('is the default translation mode and the setting is validated', () => {
    expect(DEFAULT_SETTINGS.reading.translationMode).toBe('machine');
    expect(sanitizeSettings({ reading: { translationMode: 'ai' } }).reading.translationMode).toBe('machine');
    expect(sanitizeSettings({ reading: { translationMode: 'dictionary' } }).reading.translationMode).toBe('dictionary');
    // the old opt-in boolean (saved as false by earlier builds) no longer disables the new default
    expect(sanitizeSettings({ reading: { machineTranslation: false } }).reading.translationMode).toBe('machine');
  });

  it('reports unsupported browsers and unavailable language pairs', async () => {
    const mt = await load();
    expect(await mt.mtAvailability()).toBe('unsupported');
    (globalThis as { Translator?: unknown }).Translator = { availability: async () => 'unavailable', create: vi.fn() };
    expect(await mt.mtAvailability()).toBe('unavailable');
    (globalThis as { Translator?: unknown }).Translator = { availability: async () => { throw new Error('x'); }, create: vi.fn() };
    expect(await mt.mtAvailability()).toBe('unavailable');
  });

  it('asks for the en→vi pair, prepares OCR text, translates and caches', async () => {
    const mt = await load();
    const translate = vi.fn(async (t: string) => `VI(${t})`);
    const availability = vi.fn(async () => 'available');
    const create = vi.fn(async () => ({ translate }));
    (globalThis as { Translator?: unknown }).Translator = { availability, create };
    expect(await mt.mtAvailability()).toBe('available');
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'vi' });
    expect(await mt.machineTranslate("T-THAT'S IMPOSSI-\n BLE!!")).toBe("VI(T-that's impossible!!)");
    expect(await mt.machineTranslate("T-THAT'S  IMPOSSI- BLE!!")).toBe("VI(T-that's impossible!!)");
    expect(translate).toHaveBeenCalledTimes(1); // cached
    expect(create).toHaveBeenCalledTimes(1); // one translator instance
  });

  it('reports download progress and recovers after a failed create', async () => {
    const mt = await load();
    let fail = true;
    const create = vi.fn(async (o: { monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) => {
      o.monitor?.({ addEventListener: (_t, cb) => [0.5, 1].forEach((loaded) => cb({ loaded })) });
      if (fail) throw new Error('download failed');
      return { translate: async () => 'ok' };
    });
    (globalThis as { Translator?: unknown }).Translator = { availability: async () => 'downloadable', create };
    const seen: number[] = [];
    await expect(mt.getTranslator((p) => seen.push(p))).rejects.toThrow('download failed');
    expect(seen).toEqual([0.5, 1]);
    fail = false;
    await expect(mt.machineTranslate('hi')).resolves.toBe('ok');
  });

  it('translates Vietnamese → English with its own translator instance; en→vi stays the default and the cache is per direction', async () => {
    const mt = await load();
    const { EN_VI, VI_EN } = await import('@/modules/mt');
    const seen: Array<{ sourceLanguage: string; targetLanguage: string }> = [];
    const create = vi.fn(async (o: { sourceLanguage: string; targetLanguage: string }) => {
      seen.push({ sourceLanguage: o.sourceLanguage, targetLanguage: o.targetLanguage });
      return { translate: async (t: string) => `${o.sourceLanguage}>${o.targetLanguage}(${t})` };
    });
    const availability = vi.fn(async () => 'available');
    (globalThis as { Translator?: unknown }).Translator = { availability, create };
    expect(await mt.mtAvailability(VI_EN)).toBe('available');
    expect(availability).toHaveBeenLastCalledWith({ sourceLanguage: 'vi', targetLanguage: 'en' });
    expect(await mt.machineTranslate('Xin chào', VI_EN)).toBe('vi>en(Xin chào)');
    expect(await mt.machineTranslate('Xin chào')).toBe('en>vi(Xin chào)'); // same text, other direction: not served from the vi→en cache
    expect(await mt.machineTranslate('Xin chào', EN_VI)).toBe('en>vi(Xin chào)');
    expect(seen).toEqual([
      { sourceLanguage: 'vi', targetLanguage: 'en' },
      { sourceLanguage: 'en', targetLanguage: 'vi' },
    ]);
  });

  it('reports which provider translates (transparency label)', async () => {
    const mt = await load();
    const { VI_EN } = await import('@/modules/mt');
    (globalThis as { Translator?: unknown }).Translator = { availability: async () => 'available', create: async () => ({ translate: async (t: string) => t }) };
    expect(await mt.activeProviderLabel()).toContain('Chrome Translator');
    expect(await mt.activeProviderLabel(VI_EN)).toContain('Việt → Anh');
  });
});
