/**
 * Built-in dictionary providers:
 *  - WordNetProvider: English definitions, examples, synonyms, antonyms, usage tags, MWEs.
 *  - CmuIpaProvider:  IPA (General American) converted from CMUdict.
 *  - StarterProvider: hand-curated English → Vietnamese meanings, phrases, slang notes.
 */
import type { DictEntry, PhraseRef, PhraseType, Sense, SenseTag, SourceInfo } from '@/shared/types';
import type { LexiconStore } from './lexicon-store';
import { WN_POS, type DataLoader, type DictionaryProvider, type StarterData } from './types';

export const SOURCES: Record<string, SourceInfo> = {
  wordnet: { id: 'wordnet', name: 'WordNet 3.1', license: 'WordNet License (Princeton University)', kind: 'established' },
  cmudict: { id: 'cmudict', name: 'CMU Pronouncing Dictionary', license: 'BSD-2-Clause', kind: 'established' },
  starter: { id: 'starter', name: 'MangaLingo Starter (biên soạn thủ công)', license: 'CC0-1.0', kind: 'curated' },
  rules: { id: 'rules', name: 'Quy tắc ngôn ngữ MangaLingo', license: 'MangaLingo source code', kind: 'rules' },
};

const MWE_TYPE: Record<string, PhraseType> = { p: 'phrasal', i: 'idiom', e: 'expression', c: 'compound', s: 'slang' };
const TAG_MAP: Record<string, SenseTag> = { slang: 'slang', informal: 'informal', vulgar: 'vulgar', archaic: 'archaic' };

export class WordNetProvider implements DictionaryProvider {
  readonly info = SOURCES.wordnet;
  constructor(private store: LexiconStore) {}

  async lookup(headword: string): Promise<DictEntry | null> {
    const rec = await this.store.get(headword);
    if (!rec || (!rec.s && !rec.m)) return null;
    const senses: Sense[] = [];
    for (const p of ['n', 'v', 'a', 'r'] as const) {
      const ids = rec.s?.[p];
      if (!ids) continue;
      const rows = await this.store.synsets(ids.slice(0, 12));
      for (const row of rows) {
        if (!row) continue;
        const [pos, words, gloss, examples, antonyms, tags] = row;
        senses.push({
          pos: WN_POS[pos],
          en: gloss,
          examples: examples.length ? examples : undefined,
          synonyms: words.filter((w) => w !== headword).slice(0, 8),
          antonyms: antonyms.length ? antonyms : undefined,
          tags: tags.length ? tags.map((t) => TAG_MAP[t]).filter(Boolean) : undefined,
          source: 'wordnet',
        });
      }
    }
    const related: PhraseRef[] = (rec.m ?? []).map(([phrase, t]) => ({ phrase, type: MWE_TYPE[t] ?? 'expression' }));
    if (!senses.length && !related.length) return null;
    return { headword, senses, related, source: 'wordnet' };
  }

  peek(headword: string): DictEntry | null | undefined {
    const rec = this.store.peek(headword);
    if (rec === undefined) return undefined;
    if (!rec?.s) return null;
    // Synchronous view without glosses: enough for POS inventory / existence checks.
    const senses: Sense[] = [];
    for (const p of ['n', 'v', 'a', 'r'] as const) if (rec.s[p]?.length) senses.push({ pos: WN_POS[p], source: 'wordnet' });
    return { headword, senses, source: 'wordnet' };
  }

  async prefetch(headwords: string[]): Promise<void> {
    await this.store.ensure(headwords);
  }

  /** First English gloss for a headword (for chunk glossing when no Vietnamese exists). */
  async firstGloss(headword: string, pos?: string): Promise<string | undefined> {
    const rec = await this.store.get(headword);
    if (!rec?.s) return undefined;
    const order = pos ? [pos, 'n', 'v', 'a', 'r'] : ['n', 'v', 'a', 'r'];
    for (const p of order) {
      const id = rec.s[p as 'n']?.[0];
      if (id !== undefined) return (await this.store.synset(id))?.[2];
    }
    return undefined;
  }
}

export class CmuIpaProvider implements DictionaryProvider {
  readonly info = SOURCES.cmudict;
  constructor(private store: LexiconStore) {}
  async lookup(headword: string): Promise<DictEntry | null> {
    const rec = await this.store.get(headword);
    return rec?.i ? { headword, ipa: rec.i, senses: [], source: 'cmudict' } : null;
  }
  peek(headword: string): DictEntry | null | undefined {
    const rec = this.store.peek(headword);
    if (rec === undefined) return undefined;
    return rec?.i ? { headword, ipa: rec.i, senses: [], source: 'cmudict' } : null;
  }
}

export class StarterProvider implements DictionaryProvider {
  readonly info = SOURCES.starter;
  private data: StarterData | null = null;
  private loading: Promise<StarterData> | null = null;
  constructor(private load: DataLoader) {}

  async ready(): Promise<StarterData> {
    if (this.data) return this.data;
    this.loading ??= (this.load('starter.json') as Promise<StarterData>).then((d) => (this.data = d));
    return this.loading;
  }

  private build(headword: string, d: StarterData): DictEntry | null {
    const w = d.words[headword];
    const p = d.phrases[headword];
    if (!w && !p) return null;
    if (p) {
      return {
        headword,
        phraseType: p.type,
        explanation: p.explain,
        senses: [{ pos: 'phrase', vi: p.vi, examples: p.ex ? [p.ex] : undefined, tags: [p.type === 'phrasal' ? 'phrasal' : p.type === 'slang' ? 'slang' : p.type === 'idiom' ? 'idiom' : 'expression'], source: 'starter' }],
        source: 'starter',
      };
    }
    return {
      headword,
      senses: w!.map((s) => ({ pos: s.pos, vi: s.vi, tags: s.tags as SenseTag[] | undefined, note: s.note, source: 'starter' })),
      source: 'starter',
    };
  }

  async lookup(headword: string): Promise<DictEntry | null> {
    return this.build(headword, await this.ready());
  }
  async prefetch(): Promise<void> {
    await this.ready();
  }
  peek(headword: string): DictEntry | null | undefined {
    return this.data ? this.build(headword, this.data) : undefined;
  }
  async count(): Promise<number> {
    const d = await this.ready();
    return Object.keys(d.words).length + Object.keys(d.phrases).length;
  }
  phraseVi(phrase: string): string | undefined {
    return this.data?.phrases[phrase]?.vi.join('; ');
  }
}
