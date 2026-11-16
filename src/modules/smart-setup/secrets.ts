/**
 * Secure storage of the translation API key.
 *  - Chrome (and the fallback anywhere else): AES-GCM with a NON-EXTRACTABLE WebCrypto key kept in IndexedDB; only
 *    ciphertext is written to chrome.storage.local, so the key cannot be read from the profile files and cannot be
 *    exported by scripts (malware running as the same OS user can still ask the browser to decrypt: documented).
 *  - iPhone: Keychain (WhenUnlockedThisDeviceOnly). Android: Keystore-backed AES-GCM. Both live in native code and
 *    are reached through the existing bridges (see src/mobile/secrets.ts).
 */
import type { KV } from '@/storage/kv';

export type SecretKind = 'webcrypto' | 'keychain' | 'keystore' | 'memory';

export interface SecretStore {
  readonly kind: SecretKind;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Where the non-extractable AES key lives (IndexedDB in browsers, memory in tests). */
export interface KeyStorage {
  load(): Promise<CryptoKey | null>;
  save(key: CryptoKey): Promise<void>;
  clear(): Promise<void>;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface Sealed {
  v: 1;
  iv: string;
  ct: string;
}
const PREFIX = 'secret:';

export class WebCryptoSecretStore implements SecretStore {
  readonly kind = 'webcrypto' as const;
  private cached: Promise<CryptoKey> | null = null;

  constructor(
    private kv: KV,
    private keys: KeyStorage,
    private c: Crypto = globalThis.crypto,
  ) {}

  private key(): Promise<CryptoKey> {
    this.cached ??= (async () => {
      const existing = await this.keys.load();
      if (existing) return existing;
      const k = await this.c.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false /* non-extractable */, ['encrypt', 'decrypt']);
      await this.keys.save(k);
      return k;
    })();
    return this.cached;
  }

  async get(name: string): Promise<string | null> {
    const rec = await this.kv.get<Sealed>(PREFIX + name);
    if (!rec || rec.v !== 1) return null;
    try {
      const pt = await this.c.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, await this.key(), unb64(rec.ct));
      return new TextDecoder().decode(pt);
    } catch {
      return null; // key lost / data tampered: behave as "no secret"
    }
  }

  async set(name: string, value: string): Promise<void> {
    const iv = this.c.getRandomValues(new Uint8Array(12));
    const ct = await this.c.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(), new TextEncoder().encode(value));
    await this.kv.set({ [PREFIX + name]: { v: 1, iv: b64(iv), ct: b64(ct) } satisfies Sealed });
  }

  async remove(name: string): Promise<void> {
    await this.kv.remove(PREFIX + name);
  }
}

/** The AES key in IndexedDB (a CryptoKey is structured-cloneable, and stays non-extractable). */
export function idbKeyStorage(dbName = 'lingolens-secrets'): KeyStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const r = fn(db.transaction('keys', mode).objectStore('keys'));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    load: async () => ((await run('readonly', (s) => s.get('aes'))) as CryptoKey | undefined) ?? null,
    save: async (k) => void (await run('readwrite', (s) => s.put(k, 'aes'))),
    clear: async () => void (await run('readwrite', (s) => s.delete('aes'))),
  };
}

export const memoryKeyStorage = (): KeyStorage => {
  let k: CryptoKey | null = null;
  return { load: async () => k, save: async (x) => void (k = x), clear: async () => void (k = null) };
};

/** A store whose real storage is native code (Keychain / Keystore). */
export interface NativeSecretApi {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}
export class NativeSecretStore implements SecretStore {
  constructor(
    readonly kind: 'keychain' | 'keystore',
    private api: NativeSecretApi,
  ) {}
  get = (n: string) => this.api.get(n);
  set = (n: string, v: string) => this.api.set(n, v);
  remove = (n: string) => this.api.remove(n);
}

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  readonly kind = 'memory' as const;
  readonly data = new Map<string, string>();
  async get(n: string) {
    return this.data.get(n) ?? null;
  }
  async set(n: string, v: string) {
    this.data.set(n, v);
  }
  async remove(n: string) {
    this.data.delete(n);
  }
}
