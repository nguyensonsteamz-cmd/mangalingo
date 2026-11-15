import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDictionary, type DictionaryStack } from '@/dictionary/create';
import type { DictionaryProvider } from '@/dictionary/types';

export const DATA_DIR = resolve(__dirname, '../../build-data/data');

export function fsLoader(dir = DATA_DIR) {
  return async (path: string) => JSON.parse(await readFile(resolve(dir, path), 'utf8'));
}

let shared: DictionaryStack | null = null;
/** Real packaged data (requires `npm run data`). */
export function realDictionary(extra: DictionaryProvider[] = []): DictionaryStack {
  if (!existsSync(resolve(DATA_DIR, 'meta.json'))) throw new Error('Run `npm run data` before the tests.');
  if (extra.length) return createDictionary(fsLoader(), extra);
  shared ??= createDictionary(fsLoader());
  return shared;
}
