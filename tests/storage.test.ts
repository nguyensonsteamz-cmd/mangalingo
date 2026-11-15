import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { memoryKV, QuotaError } from '@/storage/kv';
import { SettingsStore, SETTINGS_KEY } from '@/storage/settings-store';
import { VocabStore, cleanUrl, filterVocab, sanitizeEntry, VOCAB_KEY } from '@/storage/vocab-store';
import { OcrCache, sha256 } from '@/storage/ocr-cache';
import { UserDictProvider } from '@/storage/user-dict';
import { DEFAULT_SETTINGS, isSiteIgnored, mergeSettings, normalizeHost, sanitizeSettings } from '@/shared/settings';
import { parseCsv, toCsv } from '@/shared/csv';
import { parseDictionaryImport } from '@/dictionary/import';
import type { OcrResult } from '@/shared/types';

describe('settings schema & validation', () => {
  it('fills defaults for missing/corrupt data', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ popup: { width: 'wide', opacity: 5, position: 'left' }, appearance: { accent: 'red', theme: 'light' } });
    expect(s.popup.width).toBe(DEFAULT_SETTINGS.popup.width);
    expect(s.popup.opacity).toBe(1); // clamped
    expect(s.popup.position).toBe('auto');
    expect(s.appearance.accent).toBe(DEFAULT_SETTINGS.appearance.accent);
    expect(s.appearance.theme).toBe('light');
  });
  it('clamps numbers and rounds integers', () => {
    const s = sanitizeSettings({ popup: { width: 9999 }, typography: { fontSize: 3.7, lineHeight: 1.234 } });
    expect(s.popup.width).toBe(600);
    expect(s.typography.fontSize).toBe(11);
    expect(s.typography.lineHeight).toBe(1.23);
  });
  it('validates ignored hosts', () => {
    expect(normalizeHost('https://www.Example.com/path?q=1')).toBe('www.example.com');
    expect(normalizeHost('*.manga.net')).toBe('manga.net');
    expect(normalizeHost('not a host')).toBeNull();
    const s = sanitizeSettings({ reading: { ignoredSites: ['a.com', 'bad host', 'A.com', 42] } });
    expect(s.reading.ignoredSites).toEqual(['a.com']);
    expect(isSiteIgnored(s, 'sub.a.com')).toBe(true);
    expect(isSiteIgnored(s, 'nota.com')).toBe(false);
  });
  it('deep-merges partial updates', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { popup: { sections: { grammar: false } } });
    expect(s.popup.sections).toEqual({ ...DEFAULT_SETTINGS.popup.sections, grammar: false });
    expect(s.popup.width).toBe(DEFAULT_SETTINGS.popup.width);
  });
});

describe('settings persistence', () => {
  it('saves, reloads, notifies subscribers and resets', async () => {
    const kv = memoryKV();
    const a = new SettingsStore(kv);
    const b = new SettingsStore(kv); // another extension context
    const seen: string[] = [];
    b.subscribe((s) => seen.push(s.appearance.theme));
    await a.update({ appearance: { theme: 'light' }, ocr: { confidenceThreshold: 70 } });
    expect((await b.load()).appearance.theme).toBe('light');
    expect((await b.load()).ocr.confidenceThreshold).toBe(70);
    expect(seen).toEqual(['light']);
    await a.reset();
    expect(await b.load()).toEqual(DEFAULT_SETTINGS);
    expect(seen).toEqual(['light', 'dark']);
  });
  it('sanitises values written by other code', async () => {
    const kv = memoryKV();
    await kv.set({ [SETTINGS_KEY]: { popup: { width: -5 } } });
    expect((await new SettingsStore(kv).load()).popup.width).toBe(300);
  });
});

const sample = { word: 'Destroyed', lemma: 'destroy', meaning: 'phá hủy', ipa: '/dɪˈstrɔɪ/', pos: 'verb', sentence: 'The village was destroyed.', sourceUrl: 'https://example.com/read/1?token=SECRET#p2', sourceTitle: 'Ch. 1' };

describe('vocabulary storage', () => {
  it('saves, deduplicates by lemma, updates status/notes and removes', async () => {
    const store = new VocabStore(memoryKV());
    const { entry, created } = await store.add(sample);
    expect(created).toBe(true);
    expect(entry.status).toBe('new');
    expect(entry.sourceUrl).toBe('https://example.com/read/1'); // query/hash stripped
    expect((await store.add({ ...sample, word: 'destroys' })).created).toBe(false);
    await store.setStatus(entry.id, 'learning');
    await store.update(entry.id, { notes: 'hay gặp trong truyện' });
    const [e] = await store.list();
    expect(e).toMatchObject({ status: 'learning', notes: 'hay gặp trong truyện' });
    await store.setStatus(entry.id, 'known');
    expect((await store.findByLemma('destroy'))?.status).toBe('known');
    await store.remove(entry.id);
    expect(await store.list()).toEqual([]);
  });
  it('searches and filters', async () => {
    const store = new VocabStore(memoryKV());
    await store.add(sample);
    const { entry } = await store.add({ word: 'ninja', lemma: 'ninja', meaning: 'ninja' });
    await store.setStatus(entry.id, 'known');
    const all = await store.list();
    expect(filterVocab(all, { q: 'phá' }).map((e) => e.lemma)).toEqual(['destroy']);
    expect(filterVocab(all, { status: 'known' }).map((e) => e.lemma)).toEqual(['ninja']);
    expect(filterVocab(all, { sort: 'az' }).map((e) => e.word)).toEqual(['Destroyed', 'ninja']);
  });
  it('exports JSON/CSV and re-imports them', async () => {
    const a = new VocabStore(memoryKV());
    await a.add(sample);
    await a.add({ word: 'formula', lemma: '=cmd', meaning: '=HYPERLINK("x")' });
    const json = await a.exportJson();
    const csv = await a.exportCsv();
    expect(csv.split('\r\n')[0]).toContain('word,lemma,ipa');
    expect(csv).toContain("'=HYPERLINK"); // spreadsheet formula injection neutralised
    const b = new VocabStore(memoryKV());
    expect(await b.importText(json, 'json')).toMatchObject({ added: 2, skipped: 0 });
    const c = new VocabStore(memoryKV());
    const r = await c.importText(csv, 'csv');
    expect(r.added).toBe(2);
    expect((await c.findByLemma('destroy'))?.meaning).toBe('phá hủy');
    expect(await c.importText(json, 'json')).toMatchObject({ added: 0, skipped: 2 }); // duplicates
    expect((await c.importText('{bad', 'json')).errors[0]).toMatch(/JSON/);
  });
  it('handles storage quota: frees OCR cache, then reports a clear error', async () => {
    const kv = memoryKV(2000);
    const onQuota = vi.fn(async () => 0);
    const store = new VocabStore(kv, onQuota);
    await store.add({ word: 'a', lemma: 'a', meaning: 'x' });
    await expect(store.add({ word: 'big', lemma: 'big', meaning: 'x'.repeat(380), sentence: 'y'.repeat(400), translation: 'z'.repeat(500), notes: 'n'.repeat(900) })).rejects.toBeInstanceOf(QuotaError);
    expect(onQuota).toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });
  it('sanitises entries (length limits, unsafe URLs)', () => {
    const e = sanitizeEntry({ word: 'x'.repeat(500), meaning: 'm', sourceUrl: 'javascript:alert(1)', status: 'weird' as never })!;
    expect(e.word).toHaveLength(80);
    expect(e.sourceUrl).toBeUndefined();
    expect(e.status).toBe('new');
    expect(cleanUrl('file:///C:/manga/ch1.html?x')).toBe('file:///C:/manga/ch1.html');
    expect(sanitizeEntry({ word: '   ' })).toBeNull();
  });
  it('does not store page content beyond the sentence', async () => {
    const kv = memoryKV();
    await new VocabStore(kv).add({ ...sample, sentence: 'z'.repeat(5000) });
    const stored = Object.values((kv.data.get(VOCAB_KEY) as Record<string, { sentence: string }>))[0];
    expect(stored.sentence.length).toBeLessThanOrEqual(400);
  });
});

const ocrResult = (key: string, text = 'HELLO'): OcrResult => ({
  key, blocks: [{ id: 'b0', text, confidence: 90, box: { x: 0, y: 0, w: 1, h: 1 }, lines: [] }], text, meanConfidence: 90, lang: 'eng',
  acquisition: 'image-fetch', partial: false, durationMs: 10, fromCache: false, createdAt: 0,
});

describe('OCR cache', () => {
  it('stores and returns results marked fromCache', async () => {
    const c = new OcrCache(memoryKV());
    await c.put(ocrResult('k1'));
    expect(await c.get('k1')).toMatchObject({ text: 'HELLO', fromCache: true });
    expect(await c.get('nope')).toBeNull();
  });
  it('evicts least recently used entries beyond the limit', async () => {
    const c = new OcrCache(memoryKV(), 2);
    await c.put(ocrResult('a'));
    await c.put(ocrResult('b'));
    await c.get('a');
    await c.put(ocrResult('c'));
    expect(await c.get('b')).toBeNull();
    expect(await c.get('a')).not.toBeNull();
    expect((await c.stats()).entries).toBe(2);
    expect(await c.clear()).toBe(2);
  });
  it('hashes keys deterministically', async () => {
    expect(await sha256('abc')).toBe(await sha256('abc'));
    expect(await sha256('abc')).not.toBe(await sha256('abd'));
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, newlines and detects delimiters', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n"multi\nline"\t2')).toEqual([['a', 'b'], ['multi\nline', '2']]);
    expect(parseCsv(toCsv([['x,1', 'q"q']]))).toEqual([['x,1', 'q"q']]);
  });
});

describe('dictionary import (JSON / CSV)', () => {
  it('parses CSV with header aliases and groups senses', () => {
    const csv = 'Word,POS,Nghĩa,Definition,IPA,Tags\nshuriken,noun,phi tiêu,throwing star,/ʃʊˈrɪkɛn/,slang\nshuriken,verb,ném phi tiêu,,,\n,noun,x,,,\nbad,,,,\n';
    const r = parseDictionaryImport(csv, 'csv', 'user');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].senses.map((s) => s.pos)).toEqual(['noun', 'verb']);
    expect(r.entries[0]).toMatchObject({ headword: 'shuriken', ipa: '/ʃʊˈrɪkɛn/' });
    expect(r.entries[0].senses[0].tags).toEqual(['slang']);
    expect(r.skipped).toBe(2);
  });
  it('parses JSON arrays and { entries } objects; rejects invalid input', () => {
    expect(parseDictionaryImport(JSON.stringify([{ word: 'Kunai', vi: ['dao kunai'], examples: 'He threw a kunai.' }]), 'json', 'user').entries[0]).toMatchObject({ headword: 'kunai' });
    expect(parseDictionaryImport(JSON.stringify({ entries: [{ word: 'x', en: 'y' }] }), 'json', 'user').entries).toHaveLength(1);
    expect(parseDictionaryImport('not json', 'json', 'user').errors[0]).toMatch(/JSON/);
    expect(parseDictionaryImport('{"a":1}', 'json', 'user').errors[0]).toMatch(/mảng/);
    expect(parseDictionaryImport('foo,bar\n1,2', 'csv', 'user').errors[0]).toMatch(/word/);
  });
});

describe('user dictionary provider (IndexedDB)', () => {
  it('imports sets, looks up, replaces and clears', async () => {
    const p = new UserDictProvider(indexedDB);
    const parsed = parseDictionaryImport('word,vi\nshuriken,phi tiêu\nkunai,dao kunai\n', 'csv', 'user');
    expect(await p.importSet('ninja', parsed.entries)).toBe(2);
    expect((await p.lookup('shuriken'))?.senses[0].vi).toEqual(['phi tiêu']);
    await p.prefetch(['kunai', 'missing']);
    expect(p.peek('kunai')?.headword).toBe('kunai');
    expect(p.peek('missing')).toBeNull();
    expect(await p.count()).toBe(2);
    await p.importSet('ninja', parseDictionaryImport('word,vi\nkatana,kiếm katana\n', 'csv', 'user').entries);
    expect(await p.lookup('shuriken')).toBeNull();
    expect((await p.sets()).map((s) => s.name)).toEqual(['ninja']);
    await p.clear();
    expect(await p.count()).toBe(0);
  });
});

describe('per-site switch (toolbar popup): off by default, on only where the user enabled it', () => {
  it('is off everywhere by default and on only for listed sites (+ subdomains, www)', async () => {
    const { DEFAULT_SETTINGS, isInactive, isSiteEnabled, mergeSettings, sanitizeSettings } = await import('@/shared/settings');
    expect(DEFAULT_SETTINGS.general.sites).toEqual([]);
    expect(isInactive(DEFAULT_SETTINGS, 'mangafire.to')).toBe(true);
    const on = mergeSettings(DEFAULT_SETTINGS, { general: { sites: ['mangafire.to', 'www.example.com'] } });
    expect(isSiteEnabled(on, 'mangafire.to')).toBe(true);
    expect(isSiteEnabled(on, 'read.mangafire.to')).toBe(true);
    expect(isSiteEnabled(on, 'www.mangafire.to')).toBe(true);
    expect(isSiteEnabled(on, 'example.com')).toBe(true);
    expect(isSiteEnabled(on, 'notmangafire.to')).toBe(false);
    expect(isSiteEnabled(on, 'google.com')).toBe(false);
    // global pause keeps the list but stops everywhere
    expect(isSiteEnabled(mergeSettings(on, { general: { enabled: false } }), 'mangafire.to')).toBe(false);
    expect(sanitizeSettings({ general: { sites: ['HTTPS://Manga.Site/path', 'bad host!'] } }).general.sites).toEqual(['manga.site']);
  });
});
