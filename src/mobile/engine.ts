/**
 * In-page request router for the Android app: the same handlers the extension's service worker
 * uses (dictionary, translation-by-dictionary, imports), backed by the dictionary data bundled in
 * the app's assets. OCR runs natively (ML Kit) and is not routed here.
 */
import './shim';
import { createRouter } from '@/background/router';
import { SidebarState } from '@/background/sidebar';
import { createDictionary } from '@/dictionary/create';
import { parseDictionaryImport } from '@/dictionary/import';
import { MessageError, type PageEvent } from '@/shared/messages';
import { chromeLocal } from '@/storage/kv';
import { SettingsStore } from '@/storage/settings-store';
import { UserDictProvider } from '@/storage/user-dict';
import { UsageService } from '@/modules/usage';

const settings = new SettingsStore(chromeLocal());

const loader = async (path: string) => {
  const res = await fetch(`data/${path}`);
  if (!res.ok) throw new Error(`data/${path}: HTTP ${res.status}`);
  return res.json();
};
const userDict = new UserDictProvider();
export const dict = createDictionary(loader, [userDict]);

const broadcast = async (e: PageEvent) => {
  await chrome.runtime.sendMessage(e);
};

const route = createRouter({
  usage: new UsageService(chromeLocal()),
  lookup: async (req) => {
    if (!req.assumeEnglish) {
      const s = await settings.load();
      if (!s.reading.autoDetectLanguage) req = { ...req, assumeEnglish: true };
    }
    return dict.service.lookup(req);
  },
  scan: async () => {
    throw new MessageError('Trên Android, hãy quét bằng nút nổi LingoLens.', 'unsupported');
  },
  cancelScan: async () => false,
  warmOcr: async () => true,
  clearOcrCache: async () => 0,
  sidebar: new SidebarState(chrome.storage.session as never, broadcast),
  openSidePanel: async () => {
    location.hash = 'lookup';
  },
  openOptions: async () => {
    location.hash = 'settings';
  },
  openShortcuts: async () => {},
  dictStats: async () => {
    const meta = (await loader('meta.json')) as { counts: Record<string, number> };
    const [userEntries, userSets] = await Promise.all([userDict.count().catch(() => 0), userDict.sets().catch(() => [])]);
    return {
      sources: [
        { ...dict.wordnet.info, entries: meta.counts.synsets },
        { id: 'cmudict', name: 'CMU Pronouncing Dictionary → IPA', license: 'BSD-2-Clause', kind: 'established', entries: meta.counts.ipa },
        { ...dict.starter.info, entries: meta.counts.starterWords + meta.counts.starterPhrases },
        { ...userDict.info, entries: userEntries },
      ],
      userEntries,
      userSets,
    };
  },
  dictImport: async (name, format, text) => {
    const parsed = parseDictionaryImport(text, format, 'user');
    if (!parsed.entries.length) return { imported: 0, skipped: parsed.skipped, errors: parsed.errors.length ? parsed.errors : ['Không có mục hợp lệ.'] };
    const imported = await userDict.importSet(name, parsed.entries);
    dict.engine.invalidate();
    return { imported, skipped: parsed.skipped, errors: parsed.errors };
  },
  dictClearUser: async () => {
    await userDict.clear();
    dict.engine.invalidate();
  },
});

(globalThis as { __mlSetRouter?: (r: typeof route) => void }).__mlSetRouter?.(route);
