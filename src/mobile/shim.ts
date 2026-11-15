/**
 * Minimal `chrome.*` for the Android app's WebView, so the extension's UI (Settings Center, lookup
 * panel, vocabulary notebook) runs unchanged:
 *  - storage.local  → window.localStorage (JSON per key), with onChanged events (also across the
 *                     app's WebViews through the "storage" event);
 *  - storage.session → in memory;
 *  - runtime.sendMessage → the same request router the extension's service worker uses, running
 *                          in-page with the bundled dictionary data.
 * Must be imported before any module that touches `chrome`.
 */
import type { Envelope } from '@/shared/messages';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;
type Router = (msg: unknown, sender: unknown) => Promise<Envelope<unknown> | undefined>;

const PREFIX = 'ml:';
const QUOTA_BYTES = 10 * 1024 * 1024;
const changeListeners = new Set<ChangeListener>();
const messageListeners = new Set<(msg: unknown) => void>();
let router: Router | null = null;
const routerReady: Promise<Router> = new Promise((resolve) => {
  (globalThis as { __mlSetRouter?: (r: Router) => void }).__mlSetRouter = (r) => {
    router = r;
    resolve(r);
  };
});

function readKey(key: string): unknown {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function keysOf(keys: string | string[] | Record<string, unknown> | null | undefined): string[] {
  if (keys == null) {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }
  if (typeof keys === 'string') return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

function emit(changes: Changes) {
  if (!Object.keys(changes).length) return;
  for (const l of changeListeners) {
    try {
      l(changes, 'local');
    } catch (e) {
      console.error(e);
    }
  }
}

export function bytesInUse(keys?: string[] | null): number {
  let n = 0;
  for (const k of keysOf(keys ?? null)) n += (localStorage.getItem(PREFIX + k)?.length ?? 0) + k.length;
  return n;
}

const local = {
  QUOTA_BYTES,
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    const out: Record<string, unknown> = {};
    for (const k of keysOf(keys)) {
      const v = readKey(k);
      if (v !== undefined) out[k] = v;
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = (keys as Record<string, unknown>)[k];
    }
    return out;
  },
  async set(items: Record<string, unknown>) {
    const changes: Changes = {};
    const size = JSON.stringify(items).length;
    if (bytesInUse(null) + size > QUOTA_BYTES) throw new Error('QUOTA_BYTES quota exceeded');
    for (const [k, v] of Object.entries(items)) {
      const oldValue = readKey(k);
      try {
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
      } catch (e) {
        throw new Error(`QUOTA_BYTES quota exceeded (${(e as Error).message})`);
      }
      changes[k] = { oldValue, newValue: v };
    }
    emit(changes);
  },
  async remove(keys: string | string[]) {
    const changes: Changes = {};
    for (const k of keysOf(keys)) {
      const oldValue = readKey(k);
      localStorage.removeItem(PREFIX + k);
      if (oldValue !== undefined) changes[k] = { oldValue, newValue: undefined };
    }
    emit(changes);
  },
  async clear() {
    await local.remove(keysOf(null));
  },
  async getBytesInUse(keys?: string[] | null) {
    return bytesInUse(keys);
  },
};

const sessionMap = new Map<string, unknown>();
const session = {
  async get(keys?: string | string[] | null) {
    const out: Record<string, unknown> = {};
    for (const k of keys == null ? [...sessionMap.keys()] : typeof keys === 'string' ? [keys] : keys) if (sessionMap.has(k)) out[k] = sessionMap.get(k);
    return out;
  },
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) sessionMap.set(k, v);
  },
  async remove(keys: string | string[]) {
    for (const k of typeof keys === 'string' ? [keys] : keys) sessionMap.delete(k);
  },
};

// Another WebView of the app (e.g. the floating result card) changed a value.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const parse = (s: string | null) => {
      try {
        return s === null ? undefined : JSON.parse(s);
      } catch {
        return undefined;
      }
    };
    emit({ [e.key.slice(PREFIX.length)]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } });
  });
}

const VERSION = (import.meta.env?.VITE_ML_VERSION as string | undefined) ?? '0.1.0';

const chromeShim = {
  storage: {
    local,
    session,
    onChanged: {
      addListener: (l: ChangeListener) => void changeListeners.add(l),
      removeListener: (l: ChangeListener) => void changeListeners.delete(l),
    },
  },
  runtime: {
    id: 'mangalingo-android',
    getURL: (path: string) => new URL(path.replace(/^\//, ''), location.href).href,
    getManifest: () => ({ version: VERSION, name: 'LingoLens' }),
    async sendMessage(msg: unknown) {
      const r = router ?? (await routerReady);
      const res = await r(msg, {});
      // page events (sidebar:update…) go to in-page listeners, like chrome.runtime.onMessage
      if (res === undefined) for (const l of messageListeners) l(msg);
      return res;
    },
    onMessage: {
      addListener: (l: (msg: unknown) => void) => void messageListeners.add(l),
      removeListener: (l: (msg: unknown) => void) => void messageListeners.delete(l),
    },
    connect: () => ({ onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }),
    openOptionsPage: async () => {
      location.hash = 'settings';
    },
    lastError: undefined,
  },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: { sendMessage: async () => undefined, query: async () => [], create: async () => undefined },
  commands: { getAll: async () => [] },
};

(globalThis as unknown as { chrome: typeof chromeShim }).chrome = chromeShim;
export {};
