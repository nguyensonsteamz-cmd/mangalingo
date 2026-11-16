/**
 * Entry point for every lookup: language check → mode detection → word / phrase / sentence /
 * paragraph analysis.
 */
import type { LookupMode, LookupRequest, LookupResult, PhraseLookup } from '@/shared/types';
import { detectLanguage, isEnglishLike } from '@/language/detect';
import { splitSentences } from '@/language/segment';
import { tokenize } from '@/language/tokenize';
import type { DictionaryEngine } from '@/dictionary/engine';
import type { StarterProvider } from '@/dictionary/providers';
import { phraseCandidates } from './phrase-matcher';
import { DictionaryModeTranslator } from './dictionary-translator';
import type { TranslationProvider } from './types';
import { toneNotes } from './explain';

export const MAX_LOOKUP_CHARS = 6000;

export function detectMode(text: string): LookupMode {
  const t = text.trim();
  const toks = tokenize(t).filter((x) => x.type === 'word' || x.type === 'num');
  if (toks.length <= 1 && !/\s/.test(t.replace(/^\W+|\W+$/g, ''))) return 'word';
  if (/\n\s*\n/.test(t) || splitSentences(t).length > 1) return 'paragraph';
  if (toks.length <= 6 && !/[.!?…]["'”’)]*$/.test(t)) return 'phrase';
  return 'sentence';
}

export class LookupService {
  readonly translator: DictionaryModeTranslator;

  constructor(
    private engine: DictionaryEngine,
    starter: StarterProvider,
    translator?: TranslationProvider,
  ) {
    this.translator = (translator as DictionaryModeTranslator) ?? new DictionaryModeTranslator(engine, starter);
  }

  async lookup(req: LookupRequest): Promise<LookupResult> {
    const text0 = (req.text ?? '').replace(/ /g, ' ').trim();
    // the dictionary / grammar analysis is capped (MAX_LOOKUP_CHARS); the translation is NOT: `fullText` carries the whole input
    const full = text0;
    const text = full.slice(0, MAX_LOOKUP_CHARS);
    if (!text) throw new Error('Không có văn bản để tra cứu.');
    const language = detectLanguage(text);
    if (!req.assumeEnglish && !isEnglishLike(language)) return { kind: 'unsupported', text, language };

    const mode = req.mode ?? detectMode(text);
    if (mode === 'word') {
      const word = tokenize(text).find((t) => t.type === 'word')?.text ?? text;
      return this.engine.lookupWord(word, req.context);
    }
    if (mode === 'phrase') {
      const phrase = await this.lookupPhrase(text);
      if (phrase.found) return phrase;
      const words = tokenize(text).filter((t) => t.type === 'word').length;
      if (words >= 2) return this.translator.translateSentence(text);
      return phrase;
    }
    const result = mode === 'paragraph' ? await this.translator.translateParagraph(text) : await this.translator.translateSentence(text);
    if (full.length > result.text.length) result.fullText = full;
    return result;
  }

  /** Whole-text phrase lookup ("gave up", "lost my mind", "what the hell"). */
  async lookupPhrase(text: string): Promise<PhraseLookup> {
    const clean = text.replace(/[.!?…,;:"“”]+$/g, '').trim();
    const tokens = tokenize(clean);
    const { words, candidates } = phraseCandidates(tokens);
    const full = candidates.filter((c) => c.from === 0 && c.to === words.length - 1);
    const strings = [...new Set(full.flatMap((c) => c.strings))];
    await this.engine.prepare(words.map((w) => w.text), strings);
    const hit = strings.find((s) => this.engine.peekPhrase(s));
    const { chunks, tagged } = await this.translator.chunk(clean);
    const base: PhraseLookup = {
      kind: 'phrase',
      query: text,
      phrase: hit ?? clean.toLowerCase(),
      found: !!hit,
      senses: [],
      chunks,
      gloss: DictionaryModeTranslator.gloss(chunks),
      notes: toneNotes(clean, tagged, chunks),
      sources: [],
    };
    if (!hit) return base;
    const entries = await this.engine.lookupEntries(hit);
    const curated = entries.find((e) => e.phraseType || e.explanation);
    base.senses = entries.flatMap((e) => e.senses).sort((a, b) => Number(!a.vi?.length) - Number(!b.vi?.length));
    base.phraseType = curated?.phraseType ?? (base.senses.some((s) => s.pos === 'verb') ? 'phrasal' : 'expression');
    base.explanation = curated?.explanation;
    const used = new Set(base.senses.map((s) => s.source));
    base.sources = this.engine.sources.filter((s) => used.has(s.id));
    return base;
  }
}
