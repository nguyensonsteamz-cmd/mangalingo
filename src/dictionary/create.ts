import { DictionaryEngine } from './engine';
import { LexiconStore } from './lexicon-store';
import { CmuIpaProvider, StarterProvider, WordNetProvider } from './providers';
import type { DataLoader, DictionaryProvider } from './types';
import { LookupService } from '@/translation/lookup-service';

export interface DictionaryStack {
  store: LexiconStore;
  starter: StarterProvider;
  wordnet: WordNetProvider;
  engine: DictionaryEngine;
  service: LookupService;
}

/** Wires the bundled providers (+ optional extra providers such as user imports) together. */
export function createDictionary(load: DataLoader, extra: DictionaryProvider[] = []): DictionaryStack {
  const store = new LexiconStore(load);
  const starter = new StarterProvider(load);
  const wordnet = new WordNetProvider(store);
  const engine = new DictionaryEngine({ store, wordnet, starter, providers: [...extra, new CmuIpaProvider(store)] });
  const service = new LookupService(engine, starter);
  return { store, starter, wordnet, engine, service };
}
