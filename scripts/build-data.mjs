/**
 * Generates the packaged dictionary data into build-data/data/:
 *   lex/<xx>.json  lemma shards  { lemma: { s?: {n,v,a,r: synsetIds[]}, i?: ipa, m?: [phrase, type][] } }
 *   syn/<n>.json   synset buckets [ [pos, words[], gloss, examples[], antonyms[], tags[]] ... ] (256 per file)
 *   starter.json   curated EN→VI data compiled from data/starter/*.txt
 *   meta.json      counts + source/licence info
 * Sources: WordNet 3.1 (wordnet-db), CMU Pronouncing Dictionary (cmu-pronouncing-dictionary).
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { arpabetToIpa } from '../src/dictionary/ipa.ts';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'build-data/data');
const { existsSync } = await import('node:fs');
if (process.argv.includes('--if-missing') && existsSync(resolve(out, 'meta.json'))) {
  console.log('[data] up to date (build-data/data/meta.json exists)');
  process.exit(0);
}
const wnDir = resolve(root, 'node_modules/wordnet-db/dict');
const BUCKET = 256;
const t0 = Date.now();

export const shardKey = (lemma) => {
  const s = lemma.toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = s[0] ?? '_';
  const b = s[1] ?? '_';
  return `${a}${b}`;
};

const POS_FILES = [['noun', 'n'], ['verb', 'v'], ['adj', 'a'], ['adv', 'r']];
const PARTICLES = new Set('up down out off in on away back over through around about along by forward apart aside together into onto with for at after across'.split(' '));

// ---------- WordNet: synsets ----------
const synsets = []; // index = global id
const offsetToId = new Map(); // `${pos}:${offset}` → id
const rawPointers = []; // per id: [{sym, offset, pos, st}]
for (const [file, p] of POS_FILES) {
  const text = await readFile(join(wnDir, `data.${file}`), 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const [head, ...glossParts] = line.split(' | ');
    const gloss = glossParts.join(' | ').trim();
    const f = head.trim().split(' ');
    const offset = f[0];
    const ssType = f[2] === 's' ? 'a' : f[2];
    const wCnt = parseInt(f[3], 16);
    const words = [];
    let k = 4;
    for (let i = 0; i < wCnt; i++) {
      words.push(f[k].replace(/\([a-z]+\)$/, '').replace(/_/g, ' '));
      k += 2;
    }
    const pCnt = parseInt(f[k], 10);
    k++;
    const ptrs = [];
    for (let i = 0; i < pCnt; i++) {
      ptrs.push({ sym: f[k], offset: f[k + 1], pos: f[k + 2] === 's' ? 'a' : f[k + 2], st: f[k + 3] });
      k += 4;
    }
    // gloss: definition; "example"; "example"
    const examples = [];
    const exRe = /"([^"]+)"/g;
    let m;
    while ((m = exRe.exec(gloss))) examples.push(m[1].trim());
    const definition = gloss.replace(/;?\s*"[^"]*"/g, '').replace(/[;\s]+$/, '').trim();
    const id = synsets.length;
    offsetToId.set(`${ssType}:${offset}`, id);
    synsets.push([ssType, words, definition, examples.slice(0, 3), [], []]);
    rawPointers.push(ptrs);
  }
}

// usage-domain tags + antonyms
const USAGE_TAGS = { colloquialism: 'informal', slang: 'slang', archaism: 'archaic', vulgarism: 'vulgar', obscenity: 'vulgar', disparagement: 'informal', 'ethnic slur': 'vulgar' };
for (let id = 0; id < synsets.length; id++) {
  const s = synsets[id];
  for (const ptr of rawPointers[id]) {
    if (ptr.sym === ';u') {
      const target = synsets[offsetToId.get(`${ptr.pos}:${ptr.offset}`)];
      const tag = target && USAGE_TAGS[target[1][0]];
      if (tag && !s[5].includes(tag)) s[5].push(tag);
    } else if (ptr.sym === '!') {
      const target = synsets[offsetToId.get(`${ptr.pos}:${ptr.offset}`)];
      if (!target) continue;
      const tw = parseInt(ptr.st.slice(2), 16);
      const word = tw > 0 ? target[1][tw - 1] : target[1][0];
      if (word && !s[4].includes(word)) s[4].push(word);
    }
  }
}

// ---------- WordNet: index (lemma → ordered synsets) ----------
const lex = new Map(); // lemma → { s: {n:[],...}, i, m }
const getLex = (lemma) => {
  let e = lex.get(lemma);
  if (!e) lex.set(lemma, (e = {}));
  return e;
};
const verbLemmas = new Set();
for (const [file, p] of POS_FILES) {
  const text = await readFile(join(wnDir, `index.${file}`), 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0].replace(/_/g, ' ');
    const synCnt = parseInt(f[2], 10);
    const pCnt = parseInt(f[3], 10);
    const offsets = f.slice(4 + pCnt + 2, 4 + pCnt + 2 + synCnt);
    const ids = offsets.map((o) => offsetToId.get(`${p}:${o}`)).filter((x) => x !== undefined);
    if (!ids.length) continue;
    const e = getLex(lemma);
    e.s ??= {};
    e.s[p] = ids;
    if (p === 'v') verbLemmas.add(lemma);
  }
}

// ---------- Multi-word expression index ----------
const mweType = (phrase, posSet) => {
  const toks = phrase.split(' ');
  if (posSet.has('v')) {
    if (toks.length <= 3 && toks.slice(1).some((t) => PARTICLES.has(t)) && verbLemmas.has(toks[0])) return 'p';
    return 'i';
  }
  if (posSet.has('r') || posSet.has('a')) return 'e';
  return 'c';
};
const contains = new Map(); // word → [phrase, type][]
for (const [lemma, e] of lex) {
  if (!lemma.includes(' ') || !e.s) continue;
  const toks = lemma.split(' ');
  if (toks.length > 6) continue;
  const type = mweType(lemma, new Set(Object.keys(e.s)));
  for (const [idx, t] of toks.entries()) {
    if (t.length < 2 || ['the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', "one's", 'one'].includes(t)) continue;
    if (!contains.has(t)) contains.set(t, []);
    contains.get(t).push([lemma, type, idx]);
  }
}

// ---------- CMUdict → IPA ----------
const { dictionary: cmu } = await import('cmu-pronouncing-dictionary');
let ipaCount = 0;
for (const [key, arpa] of Object.entries(cmu)) {
  if (/\(\d+\)$/.test(key)) continue; // keep the primary pronunciation only
  if (!/^[a-z'][a-z'.-]*$/.test(key)) continue;
  if (/'s$/.test(key) && key.length > 3) continue;
  const e = getLex(key);
  e.i = arpabetToIpa(arpa);
  ipaCount++;
}

// ---------- Curated starter dataset ----------
const POS_CODES = { n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', pron: 'pron', det: 'det', prep: 'prep', conj: 'conj', interj: 'interj', num: 'num', modal: 'modal', aux: 'aux', phr: 'phrase', part: 'part' };
const PHRASE_TYPES = new Set(['phrasal', 'idiom', 'slang', 'expression', 'collocation']);
async function readTable(name) {
  const text = await readFile(resolve(root, 'data/starter', name), 'utf8');
  return text.split(/\r?\n/).map((l, i) => [l, i + 1]).filter(([l]) => l.trim() && !l.startsWith('#'));
}
const starter = { words: {}, phrases: {} };
const problems = [];
for (const [line, n] of await readTable('words.txt')) {
  const [word, pos, vi, tags = '', note = ''] = line.split('|').map((x) => x.trim());
  if (!word || !pos || !vi || !POS_CODES[pos]) {
    problems.push(`words.txt:${n}: invalid line`);
    continue;
  }
  const key = word.trim().toLowerCase();
  (starter.words[key] ??= []).push({
    pos: POS_CODES[pos],
    vi: vi.split(/\s*;\s*/).filter(Boolean),
    ...(tags.trim() ? { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });
}
for (const [line, n] of await readTable('phrases.txt')) {
  const [phrase, type, vi, explain = '', example = ''] = line.split('|').map((x) => x.trim());
  if (!phrase || !PHRASE_TYPES.has(type) || !vi) {
    problems.push(`phrases.txt:${n}: invalid line`);
    continue;
  }
  const key = phrase.trim().toLowerCase();
  starter.phrases[key] = {
    type,
    vi: vi.split(/\s*;\s*/).filter(Boolean),
    ...(explain.trim() ? { explain: explain.trim() } : {}),
    ...(example.trim() ? { ex: example.trim() } : {}),
  };
  // index curated phrases in the "contains" map too
  const toks = key.split(' ');
  const t = type === 'phrasal' ? 'p' : type === 'idiom' ? 'i' : type === 'slang' ? 's' : 'e';
  for (const [idx, w] of toks.entries()) {
    if (w.length < 2 || ['the', 'a', 'an', 'of', 'to', "one's", 'someone', 'something'].includes(w)) continue;
    if (!contains.has(w)) contains.set(w, []);
    const list = contains.get(w);
    const existing = list.find((x) => x[0] === key);
    if (existing) existing[1] = t;
    else list.push([key, t, idx]);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  throw new Error(`starter dataset has ${problems.length} invalid lines`);
}
// curated words/phrases must exist in the lemma index so lookups find their shard
for (const w of Object.keys(starter.words)) getLex(w);
for (const p of Object.keys(starter.phrases)) getLex(p);

const typeRank = { s: 0, p: 1, i: 2, e: 3, c: 4 };
for (const [w, list] of contains) {
  list.sort((a, b) => Number(b[2] === 0) - Number(a[2] === 0) || typeRank[a[1]] - typeRank[b[1]] || a[0].length - b[0].length);
  const e = getLex(w);
  e.m = list.slice(0, 40).map(([p, t]) => [p, t]);
}

// ---------- write ----------
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'lex'), { recursive: true });
await mkdir(join(out, 'syn'), { recursive: true });

const shards = new Map();
for (const [lemma, e] of lex) {
  const k = shardKey(lemma);
  if (!shards.has(k)) shards.set(k, {});
  shards.get(k)[lemma] = e;
}
for (const [k, obj] of shards) await writeFile(join(out, 'lex', `${k}.json`), JSON.stringify(obj));
const buckets = Math.ceil(synsets.length / BUCKET);
for (let b = 0; b < buckets; b++) {
  await writeFile(join(out, 'syn', `${b}.json`), JSON.stringify(synsets.slice(b * BUCKET, (b + 1) * BUCKET)));
}
await writeFile(join(out, 'starter.json'), JSON.stringify(starter));

const meta = {
  generatedAt: new Date().toISOString(),
  bucketSize: BUCKET,
  counts: {
    lemmas: lex.size,
    synsets: synsets.length,
    ipa: ipaCount,
    starterWords: Object.keys(starter.words).length,
    starterSenses: Object.values(starter.words).reduce((n, l) => n + l.length, 0),
    starterPhrases: Object.keys(starter.phrases).length,
    shards: shards.size,
    buckets,
  },
  sources: [
    { id: 'wordnet', name: 'WordNet 3.1 (Princeton University)', license: 'WordNet License (see licenses/WordNet-LICENSE.txt)', kind: 'established' },
    { id: 'cmudict', name: 'CMU Pronouncing Dictionary → IPA (rule conversion)', license: 'BSD-2-Clause (cmudict) / ISC (package)', kind: 'established' },
    { id: 'starter', name: 'LingoLens Starter EN–VI (hand-curated)', license: 'CC0-1.0 (see licenses/LingoLens-Starter-LICENSE.md)', kind: 'curated' },
  ],
};
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`[data] ${JSON.stringify(meta.counts)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
