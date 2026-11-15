/**
 * User-imported dictionary data in IndexedDB (extension origin, service worker). IndexedDB is used
 * instead of chrome.storage because imported datasets can be far larger than the 10 MB storage quota.
 */
import type { DictEntry, SourceInfo } from '@/shared/types';
import type { DictionaryProvider } from '@/dictionary/types';

const DB_NAME = 'mangalingo-userdict';
const VERSION = 1;

interface Row {
  key: string; // `${set}\u0000${headword}`
  set: string;
  headword: string;
  entry: DictEntry;
}
export interface UserSet {
  name: string;
  count: number;
  importedAt: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export class UserDictProvider implements DictionaryProvider {
  readonly info: SourceInfo = { id: 'user', name: 'Từ điển người dùng nhập', license: 'Theo nguồn người dùng cung cấp', kind: 'user' };
  private dbp: Promise<IDBDatabase> | null = null;
  private cache = new Map<string, DictEntry | null>();
  private headwords: Set<string> | null = null;

  constructor(private idb: IDBFactory = globalThis.indexedDB) {}

  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const open = this.idb.open(DB_NAME, VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        const rows = db.createObjectStore('rows', { keyPath: 'key' });
        rows.createIndex('headword', 'headword');
        rows.createIndex('set', 'set');
        db.createObjectStore('sets', { keyPath: 'name' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbp;
  }

  private async allHeadwords(): Promise<Set<string>> {
    if (this.headwords) return this.headwords;
    const db = await this.db();
    const keys = (await req(db.transaction('rows').objectStore('rows').index('headword').getAllKeys())) as string[];
    // getAllKeys on an index returns primary keys; derive headwords from them.
    this.headwords = new Set(keys.map((k) => String(k).split('\u0000')[1]));
    return this.headwords;
  }

  async lookup(headword: string): Promise<DictEntry | null> {
    if (this.cache.has(headword)) return this.cache.get(headword)!;
    const hw = await this.allHeadwords();
    if (!hw.has(headword)) return null;
    const db = await this.db();
    const rows = (await req(db.transaction('rows').objectStore('rows').index('headword').getAll(headword))) as Row[];
    const entry = rows.length
      ? { headword, ipa: rows.find((r) => r.entry.ipa)?.entry.ipa, senses: rows.flatMap((r) => r.entry.senses), source: 'user' }
      : null;
    this.cache.set(headword, entry);
    return entry;
  }

  async prefetch(headwords: string[]): Promise<void> {
    const hw = await this.allHeadwords();
    await Promise.all(headwords.filter((h) => hw.has(h)).map((h) => this.lookup(h)));
  }

  peek(headword: string): DictEntry | null | undefined {
    if (this.cache.has(headword)) return this.cache.get(headword);
    if (this.headwords && !this.headwords.has(headword)) return null;
    return undefined;
  }

  async count(): Promise<number> {
    const db = await this.db();
    return req(db.transaction('rows').objectStore('rows').count());
  }

  async sets(): Promise<UserSet[]> {
    const db = await this.db();
    return (await req(db.transaction('sets').objectStore('sets').getAll())) as UserSet[];
  }

  /** Replaces the set `name` with `entries`. Writes in chunks to keep transactions small. */
  async importSet(name: string, entries: DictEntry[]): Promise<number> {
    const db = await this.db();
    await this.removeSet(name);
    const CHUNK = 2000;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const tx = db.transaction('rows', 'readwrite');
      const store = tx.objectStore('rows');
      for (const e of entries.slice(i, i + CHUNK)) {
        store.put({ key: `${name}\u0000${e.headword}`, set: name, headword: e.headword, entry: { ...e, source: 'user' } } satisfies Row);
      }
      await done(tx);
    }
    const tx = db.transaction('sets', 'readwrite');
    tx.objectStore('sets').put({ name, count: entries.length, importedAt: Date.now() } satisfies UserSet);
    await done(tx);
    this.invalidate();
    return entries.length;
  }

  async removeSet(name: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['rows', 'sets'], 'readwrite');
    const keys = await req(tx.objectStore('rows').index('set').getAllKeys(name));
    for (const k of keys) tx.objectStore('rows').delete(k);
    tx.objectStore('sets').delete(name);
    await done(tx);
    this.invalidate();
  }

  async clear(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['rows', 'sets'], 'readwrite');
    tx.objectStore('rows').clear();
    tx.objectStore('sets').clear();
    await done(tx);
    this.invalidate();
  }

  private invalidate() {
    this.cache.clear();
    this.headwords = null;
  }
}
