/**
 * Lazy loader for the packaged WordNet/CMUdict shards. Shards are small JSON files keyed by the
 * first two letters of a lemma; synsets live in fixed-size buckets. Loaded files are kept in a
 * bounded cache so a long reading session does not grow memory without limit.
 */
import type { DataLoader, LexRecord, SynsetRow } from './types';

export function shardKey(lemma: string): string {
  const s = lemma.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${s[0] ?? '_'}${s[1] ?? '_'}`;
}

class BoundedCache<V> {
  private map = new Map<string, V>();
  constructor(private limit: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
  }
  has(k: string) {
    return this.map.has(k);
  }
}

export class LexiconStore {
  private shards = new BoundedCache<Record<string, LexRecord>>(160);
  private buckets = new BoundedCache<SynsetRow[]>(220);
  private pending = new Map<string, Promise<unknown>>();
  private missing = new Set<string>();

  constructor(
    private load: DataLoader,
    private bucketSize = 256,
  ) {}

  private async loadOnce<T>(path: string, cache: BoundedCache<T>, key: string, fallback: T): Promise<T> {
    const hit = cache.get(key);
    if (hit) return hit;
    if (this.missing.has(path)) return fallback;
    let p = this.pending.get(path) as Promise<T> | undefined;
    if (!p) {
      p = (this.load(path) as Promise<T>)
        .then((data) => {
          cache.set(key, data);
          return data;
        })
        .catch(() => {
          this.missing.add(path); // shard does not exist (no lemma with that prefix)
          return fallback;
        })
        .finally(() => this.pending.delete(path));
      this.pending.set(path, p);
    }
    return p;
  }

  async shard(key: string): Promise<Record<string, LexRecord>> {
    return this.loadOnce(`lex/${key}.json`, this.shards, key, {});
  }

  async get(lemma: string): Promise<LexRecord | null> {
    const s = await this.shard(shardKey(lemma));
    return Object.prototype.hasOwnProperty.call(s, lemma) ? s[lemma] : null;
  }

  /** Synchronous read from already-loaded shards. `undefined` = shard not loaded. */
  peek(lemma: string): LexRecord | null | undefined {
    const s = this.shards.get(shardKey(lemma));
    if (!s) return this.missing.has(`lex/${shardKey(lemma)}.json`) ? null : undefined;
    return Object.prototype.hasOwnProperty.call(s, lemma) ? s[lemma] : null;
  }

  /** Keys of a loaded shard (used for spelling suggestions). */
  shardKeys(lemma: string): string[] {
    return Object.keys(this.shards.get(shardKey(lemma)) ?? {});
  }

  async ensure(lemmas: Iterable<string>): Promise<void> {
    const keys = new Set<string>();
    for (const l of lemmas) keys.add(shardKey(l));
    await Promise.all([...keys].map((k) => this.shard(k)));
  }

  async synset(id: number): Promise<SynsetRow | null> {
    const b = Math.floor(id / this.bucketSize);
    const rows = await this.loadOnce(`syn/${b}.json`, this.buckets, String(b), [] as SynsetRow[]);
    return rows[id - b * this.bucketSize] ?? null;
  }

  async synsets(ids: number[]): Promise<(SynsetRow | null)[]> {
    return Promise.all(ids.map((id) => this.synset(id)));
  }
}
