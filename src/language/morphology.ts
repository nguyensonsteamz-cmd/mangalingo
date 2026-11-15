/**
 * Morphology: lemma candidates (WordNet "morphy" detachment rules + irregular tables + consonant
 * un-doubling) and rule-generated word forms. Existence of a candidate is checked by the dictionary.
 */
import type { WordForm } from '@/shared/types';
import {
  AUX_LEMMA,
  IRREGULAR_ADJ,
  IRREGULAR_COMPARATIVES,
  IRREGULAR_PLURALS,
  IRREGULAR_SINGULAR_TO_PLURAL,
  IRREGULAR_VERB_FORMS,
  IRREGULAR_VERBS,
} from './irregular';

export type MorphPos = 'noun' | 'verb' | 'adj' | 'any';

export interface LemmaCandidate {
  lemma: string;
  pos: MorphPos;
  rule: string;
}

const RULES: [MorphPos, string, string][] = [
  ['noun', 's', ''], ['noun', 'ses', 's'], ['noun', 'xes', 'x'], ['noun', 'zes', 'z'], ['noun', 'ches', 'ch'],
  ['noun', 'shes', 'sh'], ['noun', 'men', 'man'], ['noun', 'ies', 'y'], ['noun', 'ves', 'f'], ['noun', 'ves', 'fe'],
  ['verb', 's', ''], ['verb', 'ies', 'y'], ['verb', 'es', 'e'], ['verb', 'es', ''], ['verb', 'ed', 'e'],
  ['verb', 'ed', ''], ['verb', 'ied', 'y'], ['verb', 'ing', 'e'], ['verb', 'ing', ''], ['verb', 'ying', 'ie'],
  ['adj', 'er', ''], ['adj', 'est', ''], ['adj', 'er', 'e'], ['adj', 'est', 'e'], ['adj', 'ier', 'y'], ['adj', 'iest', 'y'],
];

const CLIPPED: Record<string, string> = {
  "'em": 'them', "'cause": 'because', "'bout": 'about', "'til": 'until', "'round": 'around', cuz: 'because',
};

export function lemmaCandidates(input: string): LemmaCandidate[] {
  const w = input.toLowerCase();
  const out: LemmaCandidate[] = [];
  const seen = new Set<string>();
  const add = (lemma: string, pos: MorphPos, rule: string) => {
    if (!lemma || lemma.length < 1) return;
    const key = `${lemma}|${pos}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ lemma, pos, rule });
  };

  add(w, 'any', 'surface');
  if (CLIPPED[w]) add(CLIPPED[w], 'any', 'clipped form');
  if (w.endsWith("in'") && w.length > 4) add(`${w.slice(0, -1)}g`, 'any', "g-dropping (goin' → going)");
  if (AUX_LEMMA.has(w)) add(AUX_LEMMA.get(w)!, 'verb', 'auxiliary form');
  for (const f of IRREGULAR_VERB_FORMS.get(w) ?? []) add(f.base, 'verb', `irregular ${f.kind === 'past' ? 'past' : 'past participle'}`);
  if (IRREGULAR_PLURALS.has(w)) add(IRREGULAR_PLURALS.get(w)!, 'noun', 'irregular plural');
  for (const b of IRREGULAR_COMPARATIVES.get(w) ?? []) add(b, 'adj', 'irregular comparison');

  for (const [pos, suffix, repl] of RULES) {
    if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
      const stem = w.slice(0, -suffix.length) + repl;
      if (stem.length < 2) continue;
      add(stem, pos, `-${suffix} → ${repl ? `-${repl}` : '∅'}`);
      // stopped → stop, running → run, bigger → big
      if (!repl && /([bcdfgklmnprstvz])\1$/.test(stem)) add(stem.slice(0, -1), pos, `-${suffix} + doubled consonant`);
    }
  }
  // Possessive and "s'" already stripped by normalizeWord; hyphen compounds: try the head.
  if (w.includes('-') && !w.startsWith('-')) {
    const parts = w.split('-').filter(Boolean);
    if (parts.length > 1) add(parts[parts.length - 1], 'any', 'compound head');
  }
  return out;
}

const VOWELS = /[aeiouy]+/g;
function syllables(w: string): number {
  return (w.toLowerCase().replace(/e$/, '').match(VOWELS) ?? []).length || 1;
}
function shouldDouble(w: string): boolean {
  return syllables(w) === 1 && /[^aeiou][aeiou][bdgklmnprt]$/.test(w) && !/[wxy]$/.test(w);
}

export function thirdPerson(v: string): string {
  if (v === 'be') return 'is';
  if (v === 'have') return 'has';
  if (/(s|x|z|ch|sh|o)$/.test(v)) return `${v}es`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ies`;
  return `${v}s`;
}

export function regularPast(v: string): string {
  if (v.endsWith('e')) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  if (shouldDouble(v)) return `${v}${v.slice(-1)}ed`;
  return `${v}ed`;
}

export function presentParticiple(v: string): string {
  if (v === 'be') return 'being';
  if (v.endsWith('ie')) return `${v.slice(0, -2)}ying`;
  if (v.endsWith('e') && !/(ee|ye|oe)$/.test(v) && v.length > 2) return `${v.slice(0, -1)}ing`;
  if (shouldDouble(v)) return `${v}${v.slice(-1)}ing`;
  return `${v}ing`;
}

export function plural(n: string): string {
  if (IRREGULAR_SINGULAR_TO_PLURAL.has(n)) return IRREGULAR_SINGULAR_TO_PLURAL.get(n)!;
  if (/(s|x|z|ch|sh)$/.test(n)) return `${n}es`;
  if (/[^aeiou]y$/.test(n)) return `${n.slice(0, -1)}ies`;
  return `${n}s`;
}

/** Rule-generated inflections for display. Only produced for single, alphabetic lemmas. */
export function generateForms(lemma: string, posList: string[]): WordForm[] {
  if (!/^[a-z]+$/.test(lemma) || lemma.length < 2) return [];
  const forms: WordForm[] = [];
  if (posList.includes('verb')) {
    const irr = IRREGULAR_VERBS.get(lemma);
    if (lemma === 'be') {
      forms.push({ label: 'present', form: 'am / is / are' }, { label: 'past', form: 'was / were' }, { label: 'past participle', form: 'been' });
    } else {
      forms.push({ label: '3rd person', form: thirdPerson(lemma) });
      forms.push({ label: 'past', form: irr ? irr.past.join(' / ') : regularPast(lemma) });
      forms.push({ label: 'past participle', form: irr ? irr.pp.join(' / ') : regularPast(lemma) });
    }
    forms.push({ label: '-ing', form: presentParticiple(lemma) });
  }
  if (posList.includes('noun')) {
    forms.push({ label: 'plural', form: plural(lemma) });
  }
  if (posList.includes('adj')) {
    const irr = IRREGULAR_ADJ.get(lemma);
    if (irr) {
      forms.push({ label: 'comparative', form: irr.comp.join(' / ') }, { label: 'superlative', form: irr.sup.join(' / ') });
    } else if (syllables(lemma) === 1 || (syllables(lemma) === 2 && lemma.endsWith('y'))) {
      const base = /[^aeiou]y$/.test(lemma) ? lemma.slice(0, -1) + 'i' : shouldDouble(lemma) ? lemma + lemma.slice(-1) : lemma;
      const e = base.endsWith('e');
      forms.push({ label: 'comparative', form: `${base}${e ? 'r' : 'er'}` }, { label: 'superlative', form: `${base}${e ? 'st' : 'est'}` });
    } else {
      forms.push({ label: 'comparative', form: `more ${lemma}` }, { label: 'superlative', form: `most ${lemma}` });
    }
  }
  return forms;
}
