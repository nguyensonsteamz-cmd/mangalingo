import type { DictEntry, Pos, SourceInfo } from '@/shared/types';

/**
 * A dictionary data source. Providers are independent: the engine merges their results, so new
 * sources (another bilingual dataset, a user import, a future online provider) can be added
 * without touching the engine or the UI.
 */
export interface DictionaryProvider {
  readonly info: SourceInfo;
  /** Exact headword lookup on a normalised (lower-case) lemma or phrase. */
  lookup(headword: string): Promise<DictEntry | null>;
  /** Called before batch analysis so later `peek` calls can be synchronous. */
  prefetch?(headwords: string[]): Promise<void>;
  /** Synchronous lookup – only valid for headwords passed to `prefetch` (or already cached). */
  peek?(headword: string): DictEntry | null | undefined;
  count?(): Promise<number | null>;
}

/** Loads a JSON file from the packaged data directory (fetch in the extension, fs in tests). */
export type DataLoader = (path: string) => Promise<unknown>;

/** Compact lemma record stored in data/lex/<shard>.json */
export interface LexRecord {
  s?: Partial<Record<'n' | 'v' | 'a' | 'r', number[]>>;
  i?: string;
  m?: [string, 'p' | 'i' | 'e' | 'c' | 's'][];
}

/** Synset row stored in data/syn/<bucket>.json */
export type SynsetRow = [pos: 'n' | 'v' | 'a' | 'r', words: string[], gloss: string, examples: string[], antonyms: string[], tags: string[]];

export interface StarterData {
  words: Record<string, { pos: Pos; vi: string[]; tags?: string[]; note?: string }[]>;
  phrases: Record<string, { type: 'phrasal' | 'idiom' | 'slang' | 'expression' | 'collocation'; vi: string[]; explain?: string; ex?: string }>;
}

export const WN_POS: Record<string, Pos> = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
