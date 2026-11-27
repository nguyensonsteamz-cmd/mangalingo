/**
 * Vocabulary notebook stored in chrome.storage.local. Only the word, its meaning and the sentence
 * it was found in are stored – never whole pages. Source URLs are stripped of query/hash parts.
 */
import type { LearningStatus, VocabEntry } from '@/shared/types';
import { headerIndex, parseCsv, toCsv } from '@/shared/csv';
import { QuotaError, type KV } from './kv';

export const VOCAB_KEY = 'vocab:v1';
export const MAX_VOCAB = 20_000;

export type VocabInput = Omit<VocabEntry, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: LearningStatus };

const clip = (s: unknown, n: number): string | undefined => {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, n) : undefined;
};

export function cleanUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return undefined;
    return `${u.origin === 'null' ? 'file://' : u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return undefined;
  }
}

const STATUSES: LearningStatus[] = ['new', 'learning', 'known'];

export function sanitizeEntry(raw: Partial<VocabEntry>, now = Date.now()): VocabEntry | null {
  const word = clip(raw.word, 80);
  if (!word) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : crypto.randomUUID(),
    word,
    lemma: clip(raw.lemma, 80)?.toLowerCase() ?? word.toLowerCase(),
    ipa: clip(raw.ipa, 80),
    meaning: clip(raw.meaning, 400) ?? '',
    pos: clip(raw.pos, 30),
    sentence: clip(raw.sentence, 400),
    translation: clip(raw.translation, 500),
    sourceUrl: cleanUrl(raw.sourceUrl),
    sourceTitle: clip(raw.sourceTitle, 140),
    status: STATUSES.includes(raw.status as LearningStatus) ? (raw.status as LearningStatus) : 'new',
    notes: clip(raw.notes, 1000),
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : now,
  };
}

export interface VocabFilter {
  q?: string;
  status?: LearningStatus | 'all';
  sort?: 'newest' | 'oldest' | 'az';
}

export function filterVocab(list: VocabEntry[], f: VocabFilter = {}): VocabEntry[] {
  const q = f.q?.trim().toLowerCase();
  let out = list.filter((e) => (!f.status || f.status === 'all' || e.status === f.status));
  if (q) out = out.filter((e) => [e.word, e.lemma, e.meaning, e.notes, e.sentence].some((x) => x?.toLowerCase().includes(q)));
  const sort = f.sort ?? 'newest';
  out.sort((a, b) => (sort === 'az' ? a.word.localeCompare(b.word) : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  return out;
}

const CSV_COLUMNS: (keyof VocabEntry)[] = ['word', 'lemma', 'ipa', 'pos', 'meaning', 'sentence', 'translation', 'sourceUrl', 'sourceTitle', 'status', 'notes', 'createdAt'];

export class VocabStore {
  constructor(
    private kv: KV,
    /** Called when storage is full; should free space (e.g. evict OCR cache) and return bytes freed. */
    private onQuota?: () => Promise<number>,
  ) {}

  private async read(): Promise<Record<string, VocabEntry>> {
    return (await this.kv.get<Record<string, VocabEntry>>(VOCAB_KEY)) ?? {};
  }

  private async write(map: Record<string, VocabEntry>) {
    try {
      await this.kv.set({ [VOCAB_KEY]: map });
    } catch (e) {
      if (e instanceof QuotaError && this.onQuota && (await this.onQuota()) > 0) {
        await this.kv.set({ [VOCAB_KEY]: map });
        return;
      }
      throw e;
    }
  }

  async list(): Promise<VocabEntry[]> {
    return Object.values(await this.read());
  }

  async findByLemma(lemma: string): Promise<VocabEntry | undefined> {
    const l = lemma.toLowerCase();
    return (await this.list()).find((e) => e.lemma === l);
  }

  /** Adds a word; if the lemma is already saved, the existing entry is returned unchanged. */
  async add(input: VocabInput): Promise<{ entry: VocabEntry; created: boolean }> {
    const map = await this.read();
    const entry = sanitizeEntry({ ...input, id: undefined, createdAt: undefined, updatedAt: undefined });
    if (!entry) throw new Error('Từ không hợp lệ.');
    const existing = Object.values(map).find((e) => e.lemma === entry.lemma);
    if (existing) return { entry: existing, created: false };
    if (Object.keys(map).length >= MAX_VOCAB) throw new Error(`Sổ từ vựng đã đạt giới hạn ${MAX_VOCAB} từ.`);
    map[entry.id] = entry;
    await this.write(map);
    return { entry, created: true };
  }

  async update(id: string, patch: Partial<Pick<VocabEntry, 'status' | 'notes' | 'meaning' | 'translation' | 'ipa' | 'pos' | 'word'>>): Promise<VocabEntry> {
    const map = await this.read();
    const cur = map[id];
    if (!cur) throw new Error('Không tìm thấy từ.');
    if (patch.word !== undefined) {
      // a re-worded entry: its lemma follows the new text, and must not collide with another saved word
      const word = patch.word.trim();
      if (!word) throw new Error('Từ không được để trống.');
      const changed = word.toLowerCase() !== cur.word.toLowerCase(); // only a different text gets a new lemma (not a case change)
      const lemma = changed ? word.toLowerCase() : cur.lemma;
      if (changed && Object.values(map).some((e) => e.id !== id && e.lemma === lemma)) throw new Error(`“${word}” đã có trong sổ từ.`);
      patch = { ...patch, word, lemma } as typeof patch;
    }
    const next = sanitizeEntry({ ...cur, ...patch, updatedAt: Date.now() })!;
    map[id] = next;
    await this.write(map);
    return next;
  }

  setStatus(id: string, status: LearningStatus) {
    return this.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    const map = await this.read();
    delete map[id];
    await this.write(map);
  }

  async clear(): Promise<void> {
    await this.kv.remove(VOCAB_KEY);
  }

  async exportJson(): Promise<string> {
    const list = filterVocab(await this.list(), { sort: 'oldest' });
    return JSON.stringify({ format: 'mangalingo-vocab', version: 1, exportedAt: new Date().toISOString(), entries: list }, null, 2);
  }

  async exportCsv(): Promise<string> {
    const list = filterVocab(await this.list(), { sort: 'oldest' });
    return toCsv([CSV_COLUMNS, ...list.map((e) => CSV_COLUMNS.map((c) => (c === 'createdAt' ? new Date(e.createdAt).toISOString() : (e[c] as string | undefined))))]);
  }

  /** Imports JSON (export format or plain array) or CSV. Existing lemmas are kept; new ones added. */
  async importText(text: string, format: 'json' | 'csv'): Promise<{ added: number; skipped: number; errors: string[] }> {
    const errors: string[] = [];
    let raws: Partial<VocabEntry>[] = [];
    if (format === 'json') {
      try {
        const data = JSON.parse(text);
        raws = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [];
        if (!raws.length) errors.push('Không có mục nào (cần mảng hoặc { "entries": [...] }).');
      } catch (e) {
        return { added: 0, skipped: 0, errors: [`JSON không hợp lệ: ${(e as Error).message}`] };
      }
    } else {
      const rows = parseCsv(text);
      const idx = headerIndex(rows[0] ?? [], Object.fromEntries(CSV_COLUMNS.map((c) => [c, [c.toLowerCase()]])) as Record<string, string[]>);
      if (idx.word === undefined) return { added: 0, skipped: 0, errors: ['CSV thiếu cột "word".'] };
      raws = rows.slice(1).map((r) => {
        const o: Record<string, unknown> = {};
        // undo the formula-injection guard added by toCsv ('=x → =x)
        for (const [k, i] of Object.entries(idx)) o[k] = typeof r[i] === 'string' ? r[i].replace(/^'(?=[=+@-])/, '') : r[i];
        if (typeof o.createdAt === 'string') o.createdAt = Date.parse(o.createdAt as string) || undefined;
        return o as Partial<VocabEntry>;
      });
    }
    const map = await this.read();
    const lemmas = new Set(Object.values(map).map((e) => e.lemma));
    let added = 0;
    let skipped = 0;
    for (const raw of raws) {
      const e = sanitizeEntry({ ...raw, id: undefined });
      if (!e) {
        skipped++;
        continue;
      }
      if (lemmas.has(e.lemma) || Object.keys(map).length >= MAX_VOCAB) {
        skipped++;
        continue;
      }
      map[e.id] = e;
      lemmas.add(e.lemma);
      added++;
    }
    if (added) await this.write(map);
    return { added, skipped, errors };
  }

  async usage(): Promise<{ bytes: number; total: number; quota: number; count: number }> {
    const [bytes, total, list] = await Promise.all([this.kv.bytesInUse(VOCAB_KEY), this.kv.bytesInUse(null), this.list()]);
    return { bytes, total, quota: this.kv.quota, count: list.length };
  }

  subscribe(cb: () => void): () => void {
    return this.kv.onChange((c) => {
      if (VOCAB_KEY in c) cb();
    });
  }
}
