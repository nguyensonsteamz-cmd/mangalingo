/**
 * Minimal key-value abstraction over chrome.storage.local so stores can be unit-tested with an
 * in-memory implementation.
 */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  bytesInUse(keys?: string | string[] | null): Promise<number>;
  /** Total quota in bytes (chrome.storage.local.QUOTA_BYTES = 10 MB without unlimitedStorage). */
  quota: number;
  onChange(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void): () => void;
}

export class QuotaError extends Error {
  constructor(message = 'Bộ nhớ của tiện ích đã đầy (giới hạn chrome.storage.local).') {
    super(message);
    this.name = 'QuotaError';
  }
}

const isQuota = (e: unknown) => /quota|QUOTA_BYTES/i.test(String((e as Error)?.message ?? e));

export function chromeLocal(): KV {
  const area = chrome.storage.local;
  return {
    quota: (area as unknown as { QUOTA_BYTES?: number }).QUOTA_BYTES ?? 10 * 1024 * 1024,
    async get<T>(key: string) {
      const r = await area.get(key);
      return r[key] as T | undefined;
    },
    async set(items) {
      try {
        await area.set(items);
      } catch (e) {
        if (isQuota(e)) throw new QuotaError();
        throw e;
      }
    },
    async remove(keys) {
      await area.remove(keys);
    },
    async bytesInUse(keys = null) {
      try {
        return await area.getBytesInUse(keys as string[] | null);
      } catch {
        return 0;
      }
    },
    onChange(cb) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
        if (name === 'local') cb(changes);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

/** In-memory KV with a byte quota (JSON length), used in tests. */
export function memoryKV(quota = 10 * 1024 * 1024): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const listeners = new Set<(c: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void>();
  const size = (k: string, v: unknown) => k.length + JSON.stringify(v).length;
  const used = () => [...data].reduce((n, [k, v]) => n + size(k, v), 0);
  return {
    data,
    quota,
    async get<T>(key: string) {
      const v = data.get(key);
      return v === undefined ? undefined : (structuredClone(v) as T);
    },
    async set(items) {
      let next = used();
      for (const [k, v] of Object.entries(items)) next += size(k, v) - (data.has(k) ? size(k, data.get(k)) : 0);
      if (next > quota) throw new QuotaError();
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) };
        data.set(k, structuredClone(v));
      }
      listeners.forEach((l) => l(changes));
    },
    async remove(keys) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      listeners.forEach((l) => l(changes));
    },
    async bytesInUse(keys = null) {
      if (keys === null) return used();
      return (Array.isArray(keys) ? keys : [keys]).reduce((n, k) => n + (data.has(k) ? size(k, data.get(k)) : 0), 0);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
