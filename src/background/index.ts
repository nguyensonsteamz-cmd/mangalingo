/**
 * LingoLens service worker: dictionary + translation engine host, OCR orchestration,
 * side panel, context menus and keyboard commands.
 */
import type { PageEvent, TabEvent } from '@/shared/messages';
import { drawLogo } from '@/ui/logo-data';
import { lemmaCandidates } from '@/language/morphology';
import { isSiteEnabled, type Settings } from '@/shared/settings';
import { callOffscreen } from './offscreen-client';
import type { LocalHost } from '@/modules/mt/local/host';
import { createDictionary } from '@/dictionary/create';
import { parseDictionaryImport } from '@/dictionary/import';
import { UserDictProvider } from '@/storage/user-dict';
import { chromeLocal } from '@/storage/kv';
import { SettingsStore } from '@/storage/settings-store';
import { OcrCache } from '@/storage/ocr-cache';
import type { OffscreenProgress } from '@/offscreen/protocol';
import { OcrService } from './ocr-service';
import { SidebarState } from './sidebar';
import { createRouter } from './router';
import { UsageService } from '@/modules/usage';
import { WebCryptoSecretStore, idbKeyStorage } from '@/modules/smart-setup/secrets';

const kv = chromeLocal();
const settings = new SettingsStore(kv);
const ocrCache = new OcrCache(kv);

const loader = async (path: string) => {
  const res = await fetch(chrome.runtime.getURL(`data/${path}`));
  if (!res.ok) throw new Error(`data/${path}: HTTP ${res.status}`);
  return res.json();
};
const userDict = new UserDictProvider();
const dict = createDictionary(loader, [userDict]);

const sendToTab = (tabId: number, e: TabEvent) => chrome.tabs.sendMessage(tabId, e).catch(() => {});
const broadcast = async (e: PageEvent) => {
  await chrome.runtime.sendMessage(e).catch(() => {});
};

const sidebar = new SidebarState(chrome.storage.session, broadcast);

const ocr = new OcrService(
  ocrCache,
  async () => {
    const s = await settings.load();
    return { threshold: s.ocr.confidenceThreshold, autoCache: s.ocr.autoCache };
  },
  (tabId, jobId, status, progress) => void sendToTab(tabId, { type: 'ocr:progress', progress: { jobId, status, progress } }),
  {
    begin: async (tabId) => {
      await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'ocr:capture', phase: 'begin' } satisfies TabEvent).catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
    },
    end: async (tabId) => void sendToTab(tabId, { type: 'ocr:capture', phase: 'end' }),
  },
  async (words) => {
    let n = 0;
    for (const w of words) {
      for (const c of lemmaCandidates(w)) {
        if ((await dict.store.get(c.lemma).catch(() => null)) || dict.starter.peek(c.lemma)) {
          n++;
          break;
        }
      }
    }
    return n;
  },
);

// ---------- side panel: per tab ----------
// The panel is disabled globally and enabled only for the tab where the user opens it, so it does
// not follow the user to other tabs. If that tab navigates to another site, the panel closes.
const PANEL_PATH = 'sidepanel/index.html';
const PANEL_HOSTS = 'panelHosts';
const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
};

/** Enables + opens the panel for one tab. Must run synchronously in the gesture turn – no awaits before open(). */
export function openPanelForTab(tabId: number, url?: string): Promise<void> {
  void chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  const opening = chrome.sidePanel.open({ tabId });
  void chrome.storage.session.get(PANEL_HOSTS).then((r) => chrome.storage.session.set({ [PANEL_HOSTS]: { ...(r[PANEL_HOSTS] ?? {}), [tabId]: hostOf(url) } }));
  return opening;
}

async function closePanelForTab(tabId: number) {
  await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  const r = await chrome.storage.session.get(PANEL_HOSTS);
  const map = { ...(r[PANEL_HOSTS] ?? {}) };
  delete map[tabId];
  await chrome.storage.session.set({ [PANEL_HOSTS]: map });
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  void chrome.storage.session.get(PANEL_HOSTS).then((r) => {
    const host = (r[PANEL_HOSTS] ?? {})[tabId];
    if (host !== undefined && host !== hostOf(info.url)) void closePanelForTab(tabId);
  });
});
chrome.tabs.onRemoved.addListener((tabId) => void closePanelForTab(tabId));

function openSidePanel(tab: { id?: number; windowId?: number; url?: string }): Promise<void> {
  if (tab.id !== undefined) return openPanelForTab(tab.id, tab.url);
  return Promise.reject(new Error('Không xác định được tab để mở sidebar.'));
}

// the API key lives only as AES-GCM ciphertext; the (non-extractable) key is in IndexedDB
const usage = new UsageService(chromeLocal(), { secrets: new WebCryptoSecretStore(chromeLocal(), idbKeyStorage()) });

/** The local translation model lives in the offscreen document (a service worker cannot run ONNX Runtime Web). */
const mtLocal: LocalHost = {
  cached: (modelId) => callOffscreen<boolean>({ target: 'offscreen', type: 'mt-local', op: 'cached', modelId }),
  start: (modelId) => callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'start', modelId }),
  status: (modelId) => callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'status', modelId }),
  translate: (modelId, text) => callOffscreen<string>({ target: 'offscreen', type: 'mt-local', op: 'translate', modelId, text }),
  cancel: (modelId) => callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'cancel', modelId }),
  verify: (modelId) => callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'verify', modelId }),
  remove: async (modelId) => {
    await callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'remove', modelId });
  },
  release: async () => {
    await callOffscreen({ target: 'offscreen', type: 'mt-local', op: 'release' }).catch(() => {});
  },
};

const route = createRouter({
  usage,
  mtLocal,
  lookup: async (req) => {
    if (!req.assumeEnglish) {
      const s = await settings.load();
      if (!s.reading.autoDetectLanguage) req = { ...req, assumeEnglish: true };
    }
    return dict.service.lookup(req);
  },
  scan: (jobId, target, tab) => ocr.scan(jobId, target, tab),
  cancelScan: (jobId) => ocr.cancel(jobId),
  warmOcr: async (lang) => {
    await callOffscreen({ target: 'offscreen', type: 'warmup', lang }).catch(() => {});
    return true;
  },
  clearOcrCache: () => ocrCache.clear(),
  sidebar,
  openSidePanel,
  openOptions: async (section) => {
    if (!section) return chrome.runtime.openOptionsPage(); // focuses an already open Settings tab
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options/index.html#${encodeURIComponent(section)}`) });
  },
  openShortcuts: async () => {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  },
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if ((msg as OffscreenProgress)?.type === 'offscreen:progress') {
    const p = msg as OffscreenProgress;
    ocr.progress(p.jobId, p.status, p.progress);
    return false;
  }
  if ((msg as { target?: string })?.target === 'offscreen') return false; // handled by the offscreen document
  const pending = route(msg, sender);
  pending.then((res) => res && sendResponse(res));
  return true;
});

// ---------- toolbar icon ----------
// The icon opens the action popup (on/off switch, sidebar, settings). Its badge shows "OFF" while
// LingoLens is switched off, and the context-menu entries are hidden.
const tabHost = (url?: string) => {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' ? u.hostname : null;
  } catch {
    return null;
  }
};

/** Badge "ON" on tabs whose site has LingoLens switched on; nothing elsewhere. */
async function updateTabState(tab: chrome.tabs.Tab, s?: Settings) {
  if (tab.id === undefined) return;
  s ??= await settings.load();
  const host = tabHost(tab.url);
  const on = host !== null && isSiteEnabled(s, host);
  await chrome.action.setBadgeText({ tabId: tab.id, text: on ? 'ON' : '' }).catch(() => {});
  await chrome.action.setTitle({ tabId: tab.id, title: on ? `LingoLens – đang bật trên ${host}` : 'LingoLens – đang tắt trên trang này (bấm để bật)' }).catch(() => {});
  if (tab.active) for (const id of MENU_IDS) chrome.contextMenus.update(id, { visible: on }, () => void chrome.runtime.lastError);
}

/** Toolbar icon = the logo chosen in Settings → Giao diện (drawn in the worker with OffscreenCanvas). */
function logoImage(id: string, size: number): ImageData {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d')!;
  drawLogo(ctx, id, size);
  return ctx.getImageData(0, 0, size, size);
}
let shownLogo = '';
async function applyLogo(id: string) {
  if (id === shownLogo) return;
  shownLogo = id;
  await chrome.action.setIcon({ imageData: { 16: logoImage(id, 16), 32: logoImage(id, 32) } }).catch(() => (shownLogo = ''));
}

async function applyEnabledState() {
  const s = await settings.load();
  void applyLogo(s.appearance.logo);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  await chrome.sidePanel.setOptions({ enabled: false }).catch(() => {}); // global default: off (per-tab only)
  await chrome.action.setBadgeText({ text: '' }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' }).catch(() => {});
  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) await updateTabState(t, s);
}
settings.subscribe(() => void applyEnabledState());
chrome.tabs.onActivated.addListener(({ tabId }) => void chrome.tabs.get(tabId).then((t) => updateTabState(t)).catch(() => {}));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url || info.status === 'complete') void updateTabState(tab);
});
chrome.runtime.onStartup.addListener(() => void applyEnabledState());

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('sidepanel:')) return;
  const windowId = Number(port.name.split(':')[1]);
  if (!Number.isFinite(windowId)) return;
  sidebar.connected(windowId);
  port.onDisconnect.addListener(() => sidebar.disconnected(windowId));
});

// ---------- context menus ----------
const MENU_IDS = ['ml-lookup', 'ml-scan-image', 'ml-scan-region', 'ml-sidebar'];
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ml-lookup', title: 'LingoLens: tra “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ml-scan-image', title: 'LingoLens: quét chữ trong ảnh (OCR)', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'ml-scan-region', title: 'LingoLens: chọn vùng để quét OCR', contexts: ['page', 'image', 'frame'] });
    chrome.contextMenus.create({ id: 'ml-sidebar', title: 'LingoLens: mở sidebar', contexts: ['page', 'selection', 'image'] });
    void applyEnabledState();
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'ml-sidebar') {
    void openPanelForTab(tab.id, tab.url).catch(() => {});
    return;
  }
  if (info.menuItemId === 'ml-lookup' && info.selectionText) void sendToTab(tab.id, { type: 'ctx:lookup', text: info.selectionText });
  if (info.menuItemId === 'ml-scan-image') void sendToTab(tab.id, { type: 'ctx:scan-image', srcUrl: info.srcUrl });
  if (info.menuItemId === 'ml-scan-region') void sendToTab(tab.id, { type: 'ctx:scan-region' });
});

// ---------- keyboard commands ----------
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-sidebar') {
    const windowId = tab?.windowId;
    if (windowId === undefined || tab?.id === undefined) return;
    if (sidebar.isOpen(windowId)) void closePanelForTab(tab.id);
    else void openPanelForTab(tab.id, tab.url).catch(() => {});
    return;
  }
  if (!tab?.id) return;
  if (command === 'lookup-selection') void sendToTab(tab.id, { type: 'cmd:lookup-selection' });
  if (command === 'scan-image') void sendToTab(tab.id, { type: 'cmd:scan-image' });
});

/**
 * Makes sure the content script runs in a tab (Chrome does not inject it into tabs that were already
 * open when the extension was installed / reloaded). Returns true when it is (now) present.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  const alive = await chrome.tabs.sendMessage(tabId, { type: 'ml:ping' } satisfies TabEvent).catch(() => false);
  if (alive) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false; // chrome://, Web Store, PDF viewer… – extensions cannot run there
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  // first install: open the sign-in page (Settings, wrapped by the sign-in gate)
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#setup') }).catch(() => {});
  createMenus();
  void applyEnabledState();
  // After an install/update/reload: start LingoLens in already-open tabs of enabled sites (no F5 needed).
  void (async () => {
    const s = await settings.load();
    if (!s.general.sites.length) return;
    for (const t of await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[])) {
      const host = tabHost(t.url);
      if (t.id !== undefined && host && isSiteEnabled(s, host)) await ensureContentScript(t.id);
    }
  })();
});

// When a site is switched on, start LingoLens in its open tabs right away (no F5 needed).
settings.subscribe((s) => {
  void chrome.tabs.query({}).then(async (tabs) => {
    for (const t of tabs) {
      const host = tabHost(t.url);
      if (t.id !== undefined && host && isSiteEnabled(s, host)) await ensureContentScript(t.id);
    }
  });
});
