/**
 * OCR result cache (LRU) in chrome.storage.local. Results are small (text + normalised boxes),
 * keyed by a hash of the image URL / pixels + OCR options.
 */
import type { OcrResult } from '@/shared/types';
import { QuotaError, type KV } from './kv';

export const OCR_INDEX_KEY = 'ocr:index';
const entryKey = (k: string) => `ocr:${k}`;
let lastTick = 0;
/** Monotonic timestamp so LRU order is well defined within the same millisecond. */
const tick = () => (lastTick = Math.max(Date.now(), lastTick + 1));

interface IndexItem {
  key: string;
  at: number;
  bytes: number;
}

export class OcrCache {
  constructor(
    private kv: KV,
    private maxEntries = 150,
    private maxBytes = 3 * 1024 * 1024,
  ) {}

  private async index(): Promise<IndexItem[]> {
    return (await this.kv.get<IndexItem[]>(OCR_INDEX_KEY)) ?? [];
  }

  async get(key: string): Promise<OcrResult | null> {
    const r = await this.kv.get<OcrResult>(entryKey(key));
    if (!r) return null;
    const idx = await this.index();
    const item = idx.find((i) => i.key === key);
    if (item) {
      item.at = tick();
      await this.kv.set({ [OCR_INDEX_KEY]: idx }).catch(() => {});
    }
    return { ...r, fromCache: true };
  }

  async put(result: OcrResult): Promise<void> {
    const bytes = JSON.stringify(result).length;
    if (bytes > this.maxBytes / 4) return; // pathological result – do not cache
    let idx = (await this.index()).filter((i) => i.key !== result.key);
    idx.push({ key: result.key, at: tick(), bytes });
    idx.sort((a, b) => b.at - a.at);
    const evict: string[] = [];
    let total = 0;
    idx = idx.filter((i, n) => {
      total += i.bytes;
      if (n >= this.maxEntries || total > this.maxBytes) {
        evict.push(entryKey(i.key));
        return false;
      }
      return true;
    });
    if (evict.length) await this.kv.remove(evict);
    try {
      await this.kv.set({ [entryKey(result.key)]: { ...result, fromCache: false }, [OCR_INDEX_KEY]: idx });
    } catch (e) {
      if (e instanceof QuotaError) {
        await this.evictOldest(Math.ceil(idx.length / 2));
        return; // skip caching this time rather than failing the scan
      }
      throw e;
    }
  }

  /** Removes the `n` least recently used entries; returns approximate bytes freed. */
  async evictOldest(n: number): Promise<number> {
    const idx = (await this.index()).sort((a, b) => a.at - b.at);
    const gone = idx.slice(0, n);
    if (!gone.length) return 0;
    await this.kv.remove(gone.map((g) => entryKey(g.key)));
    await this.kv.set({ [OCR_INDEX_KEY]: idx.slice(n) });
    return gone.reduce((s, g) => s + g.bytes, 0);
  }

  async clear(): Promise<number> {
    const idx = await this.index();
    await this.kv.remove([...idx.map((i) => entryKey(i.key)), OCR_INDEX_KEY]);
    return idx.length;
  }

  async stats(): Promise<{ entries: number; bytes: number }> {
    const idx = await this.index();
    return { entries: idx.length, bytes: idx.reduce((s, i) => s + i.bytes, 0) };
  }
}

/** SHA-256 hex digest of a string (Web Crypto; available in workers, pages and Node). */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
