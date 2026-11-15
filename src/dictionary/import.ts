/**
 * Parses user-supplied dictionary datasets (JSON or CSV) into validated entries.
 * Nothing is trusted: every field is type-checked, trimmed and length-limited.
 */
import type { DictEntry, Pos, Sense, SenseTag } from '@/shared/types';
import { headerIndex, parseCsv } from '@/shared/csv';

export const MAX_IMPORT_ENTRIES = 200_000;

const POS_ALIASES: Record<string, Pos> = {
  n: 'noun', noun: 'noun', 'danh từ': 'noun', v: 'verb', verb: 'verb', 'động từ': 'verb', adj: 'adj', a: 'adj',
  adjective: 'adj', 'tính từ': 'adj', adv: 'adv', r: 'adv', adverb: 'adv', 'trạng từ': 'adv', pron: 'pron',
  pronoun: 'pron', det: 'det', determiner: 'det', prep: 'prep', preposition: 'prep', conj: 'conj', conjunction: 'conj',
  interj: 'interj', interjection: 'interj', exclamation: 'interj', num: 'num', number: 'num', modal: 'modal',
  aux: 'aux', phrase: 'phrase', phr: 'phrase', idiom: 'phrase', 'phrasal verb': 'phrase',
};
const TAGS = new Set<SenseTag>(['slang', 'informal', 'vulgar', 'idiom', 'phrasal', 'expression', 'abbr', 'contraction', 'archaic', 'formal', 'interjection']);

export interface ImportResult {
  entries: DictEntry[];
  skipped: number;
  errors: string[];
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};
const list = (v: unknown, max: number, split = /\s*[;|]\s*/): string[] | undefined => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(split) : [];
  const out = arr.map((x) => str(x, max)).filter((x): x is string => !!x);
  return out.length ? out.slice(0, 20) : undefined;
};

export function normalizePos(v: unknown): Pos {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/\.$/, '') : '';
  return POS_ALIASES[s] ?? 'other';
}

function toEntry(raw: Record<string, unknown>, sourceId: string): { entry?: DictEntry; error?: string } {
  const headword = str(raw.word ?? raw.headword ?? raw.term ?? raw.en_word, 80)?.toLowerCase();
  if (!headword) return { error: 'thiếu trường "word"' };
  const vi = list(raw.vi ?? raw.meaning ?? raw.vietnamese ?? raw.nghia, 300);
  const en = str(raw.en ?? raw.definition ?? raw.english, 600);
  if (!vi && !en) return { error: `"${headword}": cần ít nhất "vi" hoặc "en"` };
  const tags = list(raw.tags, 20, /\s*[,;|]\s*/)?.map((t) => t.toLowerCase()).filter((t): t is SenseTag => TAGS.has(t as SenseTag));
  const sense: Sense = {
    pos: normalizePos(raw.pos ?? raw.type),
    vi,
    en,
    examples: list(raw.examples ?? raw.example, 300),
    synonyms: list(raw.synonyms, 60, /\s*[,;|]\s*/),
    antonyms: list(raw.antonyms, 60, /\s*[,;|]\s*/),
    tags: tags?.length ? tags : undefined,
    note: str(raw.note ?? raw.notes, 400),
    source: sourceId,
  };
  const ipa = str(raw.ipa ?? raw.pronunciation, 80);
  return { entry: { headword, ipa, senses: [sense], source: sourceId } };
}

/** Merge several senses of the same headword into one entry. */
function group(entries: DictEntry[]): DictEntry[] {
  const map = new Map<string, DictEntry>();
  for (const e of entries) {
    const g = map.get(e.headword);
    if (g) {
      g.senses.push(...e.senses);
      g.ipa ??= e.ipa;
    } else map.set(e.headword, { ...e, senses: [...e.senses] });
  }
  return [...map.values()];
}

export function parseDictionaryImport(text: string, format: 'json' | 'csv', sourceId: string): ImportResult {
  const errors: string[] = [];
  let skipped = 0;
  const out: DictEntry[] = [];
  const push = (raw: unknown, where: string) => {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      if (errors.length < 50) errors.push(`${where}: không phải object`);
      return;
    }
    const r = toEntry(raw as Record<string, unknown>, sourceId);
    if (r.entry) out.push(r.entry);
    else {
      skipped++;
      if (errors.length < 50) errors.push(`${where}: ${r.error}`);
    }
  };

  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { entries: [], skipped: 0, errors: [`JSON không hợp lệ: ${(e as Error).message}`] };
    }
    const arr = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries) ? (data as { entries: unknown[] }).entries : null;
    if (!arr) return { entries: [], skipped: 0, errors: ['JSON phải là một mảng hoặc { "entries": [...] }'] };
    if (arr.length > MAX_IMPORT_ENTRIES) errors.push(`Chỉ nhập ${MAX_IMPORT_ENTRIES} mục đầu tiên.`);
    arr.slice(0, MAX_IMPORT_ENTRIES).forEach((raw, i) => push(raw, `mục ${i + 1}`));
  } else {
    const rows = parseCsv(text);
    if (rows.length < 2) return { entries: [], skipped: 0, errors: ['CSV cần dòng tiêu đề và ít nhất một dòng dữ liệu'] };
    const idx = headerIndex(rows[0], {
      word: ['word', 'headword', 'term', 'english', 'tu', 'từ'],
      pos: ['pos', 'type', 'partofspeech', 'tuloai', 'từloại'],
      vi: ['vi', 'meaning', 'vietnamese', 'nghia', 'nghĩa'],
      en: ['en', 'definition', 'englishdefinition', 'define'],
      ipa: ['ipa', 'pronunciation', 'phienam', 'phiênâm'],
      example: ['example', 'examples', 'vidu', 'vídụ'],
      synonyms: ['synonyms', 'synonym'],
      antonyms: ['antonyms', 'antonym'],
      tags: ['tags', 'tag', 'label'],
      note: ['note', 'notes', 'ghichu', 'ghichú'],
    });
    if (idx.word === undefined) return { entries: [], skipped: 0, errors: ['CSV thiếu cột "word"'] };
    const body = rows.slice(1, MAX_IMPORT_ENTRIES + 1);
    body.forEach((r, i) => {
      const raw: Record<string, unknown> = {};
      for (const [k, col] of Object.entries(idx)) raw[k] = r[col];
      push(raw, `dòng ${i + 2}`);
    });
  }
  return { entries: group(out), skipped, errors };
}
