/**
 * Core domain types shared by every extension context (content, background, offscreen, pages).
 * Everything here must stay JSON-serialisable because it crosses chrome.runtime messaging.
 */

export type Pos =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'pron'
  | 'det'
  | 'prep'
  | 'conj'
  | 'interj'
  | 'num'
  | 'aux'
  | 'modal'
  | 'part'
  | 'phrase'
  | 'other';

export type SenseTag =
  | 'slang'
  | 'informal'
  | 'vulgar'
  | 'idiom'
  | 'phrasal'
  | 'expression'
  | 'abbr'
  | 'contraction'
  | 'archaic'
  | 'formal'
  | 'interjection';

/** Where a piece of data came from. `curated` = hand-authored, not reviewed by lexicographers. */
export interface SourceInfo {
  id: string;
  name: string;
  license: string;
  kind: 'established' | 'curated' | 'user' | 'rules';
}

export interface Sense {
  pos: Pos;
  vi?: string[];
  en?: string;
  examples?: string[];
  synonyms?: string[];
  antonyms?: string[];
  tags?: SenseTag[];
  /** Vietnamese usage note (curated data only). */
  note?: string;
  source: string;
}

export interface WordForm {
  label: string;
  form: string;
}

export interface PhraseRef {
  phrase: string;
  type: PhraseType;
  vi?: string;
  en?: string;
}

export type PhraseType = 'phrasal' | 'idiom' | 'slang' | 'expression' | 'collocation' | 'compound';

/** A dictionary entry as returned by a single provider. */
export interface DictEntry {
  headword: string;
  ipa?: string;
  senses: Sense[];
  forms?: WordForm[];
  collocations?: string[];
  /** Multi-word expressions that contain this headword (from WordNet / curated data). */
  related?: PhraseRef[];
  phraseType?: PhraseType;
  explanation?: string;
  source: string;
}

export interface ContextInfo {
  sentence: string;
  likelyPos?: Pos;
  /** Index into WordLookup.senses that best matches the context, if any. */
  bestSense?: number;
  confidence: 'low' | 'medium' | 'high';
  method: string;
}

export interface WordLookup {
  kind: 'word';
  query: string;
  lemma: string;
  found: boolean;
  hasVietnamese: boolean;
  /** Base forms this surface form is an inflection of, e.g. "went" → go (irregular past). */
  inflections: { lemma: string; rule: string }[];
  ipa?: string;
  ipaSource?: string;
  posList: Pos[];
  senses: Sense[];
  context?: ContextInfo;
  forms: WordForm[];
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  phrasalVerbs: PhraseRef[];
  idioms: PhraseRef[];
  tags: SenseTag[];
  notes: ContextNote[];
  sources: SourceInfo[];
  suggestions: string[];
}

export interface PhraseLookup {
  kind: 'phrase';
  query: string;
  phrase: string;
  found: boolean;
  phraseType?: PhraseType;
  senses: Sense[];
  explanation?: string;
  chunks: Chunk[];
  gloss: string;
  notes: ContextNote[];
  sources: SourceInfo[];
}

export type ChunkStatus = 'vi' | 'en-only' | 'none' | 'skip';

export interface Chunk {
  text: string;
  start: number;
  end: number;
  kind: 'phrase' | 'word' | 'punct' | 'number' | 'name';
  lemma?: string;
  pos?: Pos;
  vi?: string;
  en?: string;
  status: ChunkStatus;
  phraseType?: PhraseType;
  /** Usage explanation for phrases (curated data). */
  note?: string;
  source?: string;
}

export interface ContextNote {
  kind: 'slang' | 'idiom' | 'phrasal' | 'expression' | 'contraction' | 'tone' | 'abbr';
  text: string;
  title: string;
  explanation: string;
  source: string;
}

export interface Clause {
  text: string;
  type: 'main' | 'subordinate' | 'relative' | 'conditional' | 'coordinate';
  marker?: string;
}

export interface GrammarFeature {
  id: string;
  title: string;
  explanation: string;
  evidence?: string;
}

export type SentenceType = 'declarative' | 'yes-no-question' | 'wh-question' | 'exclamatory' | 'imperative' | 'fragment';

export interface GrammarReport {
  sentenceType: SentenceType;
  tense?: { id: string; name: string; nameVi: string; evidence: string };
  voice: 'active' | 'passive' | 'unknown';
  conditional?: { type: '0' | '1' | '2' | '3' | 'mixed' | 'unknown'; evidence: string };
  negated: boolean;
  roles: { subject?: string; verb?: string; object?: string; complement?: string };
  clauses: Clause[];
  features: GrammarFeature[];
  tags: { text: string; tag: string }[];
  confidence: 'low' | 'medium';
  disclaimer: string;
}

export interface VocabHint {
  word: string;
  lemma: string;
  vi?: string;
  en?: string;
  pos?: Pos;
  reason: string;
}

export interface LanguageResult {
  code: string;
  name: string;
  confidence: number;
  script: string;
  method: string;
}

export interface SentenceAnalysis {
  kind: 'sentence';
  text: string;
  language: LanguageResult;
  chunks: Chunk[];
  gloss: string;
  coverage: number;
  grammar: GrammarReport;
  notes: ContextNote[];
  vocabulary: VocabHint[];
  sources: SourceInfo[];
}

export interface ParagraphAnalysis {
  kind: 'paragraph';
  text: string;
  language: LanguageResult;
  sentences: SentenceAnalysis[];
  vocabulary: VocabHint[];
  notes: ContextNote[];
  coverage: number;
  sources: SourceInfo[];
}

export interface UnsupportedLanguage {
  kind: 'unsupported';
  text: string;
  language: LanguageResult;
}

export type LookupResult = WordLookup | PhraseLookup | SentenceAnalysis | ParagraphAnalysis | UnsupportedLanguage;

export type LookupMode = 'word' | 'phrase' | 'sentence' | 'paragraph';

export interface LookupRequest {
  text: string;
  /** Surrounding sentence for context-sensitive sense ranking. */
  context?: string;
  mode?: LookupMode;
  /** Skip language detection (e.g. auto-detect disabled in settings). */
  assumeEnglish?: boolean;
}

// ---------- OCR ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  /** Normalised 0..1 coordinates relative to the scanned target. */
  box: Box;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: Box;
  words: OcrWord[];
}

export interface OcrBlock {
  id: string;
  text: string;
  confidence: number;
  box: Box;
  lines: OcrLine[];
}

export interface OcrResult {
  key: string;
  blocks: OcrBlock[];
  text: string;
  meanConfidence: number;
  lang: string;
  acquisition: 'image-pixels' | 'image-fetch' | 'visible-capture';
  /** True when only part of the image (the visible part) could be read. */
  partial: boolean;
  durationMs: number;
  fromCache: boolean;
  createdAt: number;
}

export interface OcrProgress {
  jobId: string;
  status: string;
  progress: number;
}

// ---------- Vocabulary ----------

export type LearningStatus = 'new' | 'learning' | 'known';

export interface VocabEntry {
  id: string;
  word: string;
  lemma: string;
  ipa?: string;
  meaning: string;
  pos?: string;
  sentence?: string;
  translation?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  status: LearningStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
