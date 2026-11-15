/**
 * Dictionary Engine: normalisation → lemma candidates → provider merge → context ranking.
 * Providers are queried in parallel; results are cached per normalised surface form.
 */
import type { ContextNote, DictEntry, PhraseRef, Pos, Sense, SenseTag, SourceInfo, WordLookup } from '@/shared/types';
import { lemmaCandidates, generateForms, type LemmaCandidate } from '@/language/morphology';
import { normalizeWord } from '@/language/tokenize';
import { expandContraction, PRONOUNS, DETERMINERS, PREPOSITIONS, COORDINATORS, SUBORDINATORS, BE_FORMS, HAVE_FORMS, DO_FORMS, MODALS } from '@/language/lexicon';
import { tagSentence, type Tag } from '@/language/postag';
import type { DictionaryProvider } from './types';
import type { LexiconStore } from './lexicon-store';
import { SOURCES, type StarterProvider, type WordNetProvider } from './providers';

const TAG_TO_POS: Partial<Record<Tag, Pos>> = {
  NOUN: 'noun', PROPN: 'noun', VERB: 'verb', AUX: 'verb', ADJ: 'adj', ADV: 'adv', PRON: 'pron', DET: 'det',
  ADP: 'prep', CCONJ: 'conj', SCONJ: 'conj', INTJ: 'interj', MODAL: 'modal', NUM: 'num', PART: 'part',
};

const STOP = new Set([...PRONOUNS, ...DETERMINERS, ...PREPOSITIONS, ...COORDINATORS, ...SUBORDINATORS, ...BE_FORMS, ...HAVE_FORMS, ...DO_FORMS, ...MODALS, 'not', 'very', 'just', 'so', 'too']);

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const contentTokens = (s: string) =>
  (s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

interface Gathered {
  candidate: LemmaCandidate;
  entries: DictEntry[];
}

export interface EngineDeps {
  store: LexiconStore;
  wordnet: WordNetProvider;
  starter: StarterProvider;
  /** Pronunciation provider + any extra bilingual providers (user imports, future sources). */
  providers: DictionaryProvider[];
}

export class DictionaryEngine {
  private cache = new Map<string, Promise<Gathered[]>>();
  private readonly all: DictionaryProvider[];

  constructor(private deps: EngineDeps) {
    this.all = [...deps.providers, deps.starter, deps.wordnet];
  }

  get sources(): SourceInfo[] {
    return this.all.map((p) => p.info);
  }

  /** Clears cached lookups (e.g. after a user dictionary import). */
  invalidate() {
    this.cache.clear();
  }

  private gather(norm: string): Promise<Gathered[]> {
    let p = this.cache.get(norm);
    if (!p) {
      p = (async () => {
        const cands = lemmaCandidates(norm);
        const results = await Promise.all(
          cands.map(async (c) => ({
            candidate: c,
            entries: (await Promise.all(this.all.map((pr) => pr.lookup(c.lemma).catch(() => null)))).filter((e): e is DictEntry => !!e),
          })),
        );
        return results.filter((r) => r.entries.length);
      })();
      this.cache.set(norm, p);
      if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value as string);
    }
    return p;
  }

  /** Loads everything needed for synchronous `posOf` / `peek*` calls on these words and phrases. */
  async prepare(words: string[], phrases: string[] = []): Promise<void> {
    const heads = new Set<string>(phrases);
    for (const w of words) for (const c of lemmaCandidates(normalizeWord(w))) heads.add(c.lemma);
    const list = [...heads];
    await Promise.all(this.all.map((p) => p.prefetch?.(list)));
  }

  private peekEntries(head: string): DictEntry[] {
    const out: DictEntry[] = [];
    for (const p of this.all) {
      const e = p.peek?.(head);
      if (e) out.push(e);
    }
    return out;
  }

  /** POS inventory for a surface word across valid lemma candidates (sync, after prepare). */
  posOf = (word: string): Set<Pos> => {
    const out = new Set<Pos>();
    for (const c of lemmaCandidates(normalizeWord(word))) {
      for (const e of this.peekEntries(c.lemma)) {
        for (const s of e.senses) {
          if (c.pos === 'any' || s.pos === c.pos || (c.pos === 'adj' && s.pos === 'adv')) out.add(s.pos);
        }
      }
    }
    return out;
  };

  /** Sync: best lemma for a surface form given an expected POS. */
  resolveLemma(word: string, pos?: Pos): string {
    const norm = normalizeWord(word);
    let fallback: string | undefined;
    for (const c of lemmaCandidates(norm)) {
      const entries = this.peekEntries(c.lemma).filter((e) => e.senses.length);
      if (!entries.length) continue;
      const okPos = entries.some((e) => e.senses.some((s) => !pos || s.pos === pos));
      if (okPos && (c.pos === 'any' || !pos || c.pos === pos || (pos === 'verb' && c.pos === 'verb'))) {
        if (c.rule === 'surface' && pos === 'verb' && /(ing|ed|s)$/.test(norm)) {
          fallback ??= c.lemma;
          continue; // prefer the verb lemma over e.g. noun "running"
        }
        return c.lemma;
      }
      fallback ??= c.lemma;
    }
    return fallback ?? norm;
  }

  /** Sync Vietnamese gloss from bilingual providers (curated/user) for a lemma, POS-aware. */
  peekVi(lemma: string, pos?: Pos): { vi: string; source: string } | null {
    for (const e of this.peekEntries(lemma)) {
      const withVi = e.senses.filter((s) => s.vi?.length);
      if (!withVi.length) continue;
      const best = (pos && withVi.find((s) => s.pos === pos || (pos === 'verb' && (s.pos === 'aux' || s.pos === 'modal')))) || withVi[0];
      return { vi: best.vi!.slice(0, 2).join(', '), source: best.source };
    }
    return null;
  }

  /** Sync Vietnamese gloss trying the surface form first, then lemma candidates compatible with `pos`. */
  viFor(surface: string, pos?: Pos): { vi: string; source: string; lemma: string } | null {
    for (const c of lemmaCandidates(normalizeWord(surface))) {
      if (pos && c.pos !== 'any' && c.pos !== pos && !(c.pos === 'verb' && (pos === 'aux' || pos === 'modal'))) continue;
      const v = this.peekVi(c.lemma, pos);
      if (v) return { ...v, lemma: c.lemma };
    }
    return null;
  }

  /** Sync phrase membership: curated phrases, user entries or WordNet multi-word lemmas. */
  peekPhrase(phrase: string): DictEntry | null {
    const entries = this.peekEntries(phrase).filter((e) => e.senses.length);
    if (!entries.length) return null;
    return entries.find((e) => e.senses.some((s) => s.vi?.length)) ?? entries[0];
  }

  async firstGloss(lemma: string, pos?: Pos): Promise<string | undefined> {
    const p = pos === 'noun' ? 'n' : pos === 'verb' ? 'v' : pos === 'adj' ? 'a' : pos === 'adv' ? 'r' : undefined;
    return this.deps.wordnet.firstGloss(lemma, p);
  }

  async lookupEntries(headword: string): Promise<DictEntry[]> {
    return (await Promise.all(this.all.map((p) => p.lookup(headword).catch(() => null)))).filter((e): e is DictEntry => !!e);
  }

  private suggestions(norm: string): string[] {
    if (norm.length < 3 || /\s/.test(norm)) return [];
    const keys = this.deps.store.shardKeys(norm).filter((k) => !k.includes(' '));
    const scored = keys
      .map((k) => [k, levenshtein(norm, k, 2)] as const)
      .filter(([, d]) => d <= 2)
      .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length);
    const out: string[] = [];
    for (const [k] of scored) {
      const rec = this.deps.store.peek(k);
      if (rec?.s || this.deps.starter.peek(k)) out.push(k);
      if (out.length >= 5) break;
    }
    return out;
  }

  async lookupWord(surface: string, context?: string): Promise<WordLookup> {
    const query = surface.trim();
    const norm = normalizeWord(query);
    const empty: WordLookup = {
      kind: 'word', query, lemma: norm, found: false, hasVietnamese: false, inflections: [], posList: [], senses: [],
      forms: [], synonyms: [], antonyms: [], collocations: [], phrasalVerbs: [], idioms: [], tags: [], notes: [], sources: [], suggestions: [],
    };
    if (!norm) return empty;

    const gathered = await this.gather(norm);
    const withSenses = gathered.filter((g) => g.entries.some((e) => e.senses.length));
    const hasVi = (g: Gathered) => g.entries.some((e) => e.senses.some((s) => s.vi?.length));
    const surfaceHit = withSenses.find((g) => g.candidate.rule === 'surface');
    // Prefer the base form when only it has Vietnamese data ("destroyed" adj in WordNet → destroy).
    const viLemma = surfaceHit && !hasVi(surfaceHit) ? withSenses.find((g) => g !== surfaceHit && g.candidate.rule !== 'compound head' && hasVi(g)) : undefined;
    const primary = viLemma ?? surfaceHit ?? withSenses[0];
    const lemma = primary?.candidate.lemma ?? norm;

    // Merge senses: surface entries + inflectional candidates (POS-filtered by the rule that produced them).
    const senses: Sense[] = [];
    const inflections: { lemma: string; rule: string }[] = [];
    const seenSense = new Set<string>();
    const addSenses = (g: Gathered) => {
      for (const e of g.entries) {
        for (const s of e.senses) {
          if (g.candidate.pos !== 'any' && s.pos !== g.candidate.pos && !(g.candidate.pos === 'verb' && (s.pos === 'aux' || s.pos === 'modal'))) continue;
          const key = `${s.source}|${s.pos}|${s.en ?? ''}|${s.vi?.join(';') ?? ''}`;
          if (seenSense.has(key)) continue;
          seenSense.add(key);
          senses.push(s);
        }
      }
    };
    if (primary) addSenses(primary);
    for (const g of withSenses) {
      if (g === primary) continue;
      if (g.candidate.rule === 'compound head') continue;
      if (g.candidate.rule === 'surface') {
        addSenses(g); // e.g. adjective "destroyed" when the verb "destroy" is primary
        continue;
      }
      // only accept inflection candidates that actually have senses of the right POS
      const before = senses.length;
      addSenses(g);
      if (senses.length > before && g.candidate.lemma !== lemma) inflections.push({ lemma: g.candidate.lemma, rule: g.candidate.rule });
      else if (senses.length > before && g.candidate.lemma === lemma && primary?.candidate.rule !== 'surface') inflections.push({ lemma, rule: g.candidate.rule });
    }
    if (primary && primary.candidate.rule !== 'surface' && !inflections.some((x) => x.lemma === lemma)) {
      inflections.unshift({ lemma, rule: primary.candidate.rule });
    }
    // Curated/user (Vietnamese) senses first, then WordNet – stable within each group.
    senses.sort((a, b) => Number(!a.vi?.length) - Number(!b.vi?.length));

    // IPA: surface first, then lemma
    let ipa: string | undefined;
    let ipaSource: string | undefined;
    for (const g of [gathered.find((x) => x.candidate.rule === 'surface'), primary, ...gathered]) {
      const e = g?.entries.find((x) => x.ipa);
      if (e) {
        ipa = e.ipa;
        ipaSource = e.source;
        break;
      }
    }

    // Related multi-word expressions (WordNet MWEs + curated phrases)
    const related: PhraseRef[] = [];
    for (const g of [primary, ...withSenses]) for (const e of g?.entries ?? []) for (const r of e.related ?? []) if (!related.some((x) => x.phrase === r.phrase)) related.push(r);
    const starterData = await this.deps.starter.ready();
    const withVi = (r: PhraseRef): PhraseRef => ({ ...r, vi: starterData.phrases[r.phrase]?.vi.join('; ') });
    const phrasalVerbs = related.filter((r) => r.type === 'phrasal' && r.phrase.startsWith(`${lemma} `)).slice(0, 12).map(withVi);
    const idioms = related.filter((r) => r.type === 'idiom' || r.type === 'slang' || r.type === 'expression').slice(0, 12).map(withVi);
    const collocations = related.filter((r) => r.type === 'compound' || r.type === 'collocation').slice(0, 10).map((r) => r.phrase);
    phrasalVerbs.sort((a, b) => Number(!a.vi) - Number(!b.vi));
    idioms.sort((a, b) => Number(!a.vi) - Number(!b.vi));

    const posList = [...new Set(senses.map((s) => s.pos))];
    const synonyms = [...new Set(senses.flatMap((s) => s.synonyms ?? []))].slice(0, 14);
    const antonyms = [...new Set(senses.flatMap((s) => s.antonyms ?? []))].slice(0, 10);
    const tags = [...new Set(senses.flatMap((s) => s.tags ?? []))] as SenseTag[];

    const notes: ContextNote[] = [];
    const exp = expandContraction(norm);
    if (exp) notes.push({ kind: 'contraction', text: query, title: 'Dạng rút gọn', explanation: exp.note, source: 'rules' });
    const curatedNote = senses.find((s) => s.note)?.note;
    if (curatedNote) notes.push({ kind: tags.includes('slang') ? 'slang' : 'expression', text: query, title: 'Ghi chú cách dùng', explanation: curatedNote, source: 'starter' });
    if (tags.includes('slang') || tags.includes('vulgar') || tags.includes('informal')) {
      notes.push({
        kind: 'slang',
        text: query,
        title: tags.includes('vulgar') ? 'Từ thô tục / chửi thề' : tags.includes('slang') ? 'Tiếng lóng' : 'Khẩu ngữ',
        explanation: tags.includes('vulgar')
          ? 'Từ mang sắc thái thô tục; trong truyện thường thể hiện nhân vật tức giận hoặc thô lỗ. Tránh dùng trong giao tiếp trang trọng.'
          : 'Dùng trong văn nói thân mật; nghĩa có thể thay đổi theo vùng miền và nhóm người dùng.',
        source: senses.find((s) => s.tags?.some((t) => t === 'slang' || t === 'vulgar' || t === 'informal'))?.source ?? 'rules',
      });
    }

    const usedSources = new Set<string>([...senses.map((s) => s.source), ...(ipaSource ? [ipaSource] : [])]);
    if (inflections.length) usedSources.add('rules');
    const sources = [...this.all.map((p) => p.info), SOURCES.rules].filter((s) => usedSources.has(s.id));

    const result: WordLookup = {
      ...empty,
      lemma,
      found: senses.length > 0,
      hasVietnamese: senses.some((s) => s.vi?.length),
      inflections,
      ipa,
      ipaSource,
      posList,
      senses,
      forms: generateForms(lemma, posList),
      synonyms,
      antonyms,
      collocations,
      phrasalVerbs,
      idioms,
      tags,
      notes,
      sources,
      suggestions: senses.length ? [] : this.suggestions(norm),
    };
    if (context && senses.length) await this.rankByContext(result, norm, context);
    return result;
  }

  /** Simplified Lesk + POS-in-context ranking. Mutates `r.senses` order and sets `r.context`. */
  private async rankByContext(r: WordLookup, norm: string, context: string) {
    const sentence = context.replace(/\s+/g, ' ').trim().slice(0, 600);
    const toks = sentence.match(/[\p{L}'’-]+/gu) ?? [];
    await this.prepare(toks);
    const tagged = tagSentence(sentence, this.posOf);
    const hit = tagged.find((t) => t.norm === norm || normalizeWord(t.from ?? '') === norm);
    let likelyPos = hit ? TAG_TO_POS[hit.tag] : undefined;
    if (likelyPos && !r.posList.includes(likelyPos)) {
      if (likelyPos === 'verb' && (r.posList.includes('aux') || r.posList.includes('modal'))) likelyPos = r.posList.includes('aux') ? 'aux' : 'modal';
      else likelyPos = undefined;
    }

    const ctxWords = new Set<string>();
    for (const w of contentTokens(sentence)) {
      if (w === norm) continue;
      ctxWords.add(w);
      const base = lemmaCandidates(w).find((c) => c.rule !== 'surface');
      if (base) ctxWords.add(base.lemma);
    }
    const score = (s: Sense) => {
      const bag = new Set(contentTokens([s.en ?? '', ...(s.examples ?? []), ...(s.synonyms ?? []), ...(s.vi ?? [])].join(' ')));
      let n = 0;
      for (const w of ctxWords) if (bag.has(w)) n++;
      return n;
    };

    if (likelyPos) {
      const lp = likelyPos;
      const order = r.senses.map((s, i) => ({ s, i, m: s.pos === lp ? 0 : 1 }));
      order.sort((a, b) => a.m - b.m || a.i - b.i);
      r.senses = order.map((o) => o.s);
    }
    let best = -1;
    let bestScore = 0;
    r.senses.forEach((s, i) => {
      if (likelyPos && s.pos !== likelyPos) return;
      if (!s.en && !s.examples) return;
      const sc = score(s);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    if (best < 0) best = r.senses.findIndex((s) => !likelyPos || s.pos === likelyPos);
    const strongPos = hit && ['DET', 'MODAL', 'PART'].includes(String(tagged[tagged.indexOf(hit) - 1]?.tag));
    r.context = {
      sentence,
      likelyPos,
      bestSense: best >= 0 ? best : undefined,
      confidence: bestScore >= 2 && likelyPos ? 'high' : likelyPos && (bestScore >= 1 || strongPos) ? 'medium' : 'low',
      method: `Từ loại theo ngữ cảnh: quy tắc gán nhãn${likelyPos ? ` → ${likelyPos}` : ' (không xác định)'}; chọn nghĩa: trùng từ giữa câu và định nghĩa (Lesk rút gọn, ${bestScore} từ trùng).`,
    };
  }
}
