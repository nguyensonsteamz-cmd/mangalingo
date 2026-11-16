/**
 * Splits long text into chunks for a translation provider. Rules:
 *  - LOSSLESS: concat(prefix + source + suffix) of all chunks === the input (nothing dropped, nothing duplicated);
 *  - ORDER is the order of the text (each chunk carries its index);
 *  - sizes are in Unicode CODE POINTS (what Google counts), target ≈ 4,800, never above `max`;
 *  - cut at the best boundary available: paragraph break > end of sentence > line break > clause punctuation >
 *    whitespace > (last resort) a hard cut that never lands inside a surrogate pair / combining sequence / ZWJ sequence.
 * `prefix` / `suffix` hold the whitespace around a chunk's text, so paragraph breaks survive the merge.
 */

export interface Chunk {
  index: number;
  /** the text to translate (no leading / trailing whitespace) */
  source: string;
  prefix: string;
  suffix: string;
  /** code points of `source` */
  chars: number;
}

export interface ChunkOptions {
  /** preferred size in code points */
  target?: number;
  /** hard ceiling in code points (the provider's limit) */
  max?: number;
}

export const DEFAULT_TARGET = 4800;
export const DEFAULT_MAX = 5000;

const SENTENCE_END = /[.!?…。！？।؟]/u;
const CLOSERS = /["'”’)\]}»」』]/u;
const CLAUSE = /[;:,、，；：]/u;
const COMBINING = /[\p{M}‍︎️]/u;
const SPACE = /\s/u;

const isNewline = (c: string) => c === '\n' || c === '\r' || c === ' ' || c === ' ';

/** May a cut be made right before cps[i]? (never inside a combining / ZWJ / variation-selector sequence) */
const safeCut = (cps: string[], i: number) => i > 0 && i < cps.length && !COMBINING.test(cps[i]) && cps[i - 1] !== '‍';

type Kind = 'paragraph' | 'sentence' | 'line' | 'clause' | 'space';

/** Does a boundary of this kind exist right before cps[i] (i.e. the chunk would end at i)? */
function boundary(cps: string[], i: number, kind: Kind): boolean {
  if (!safeCut(cps, i)) return false;
  const prev = cps[i - 1];
  switch (kind) {
    case 'paragraph': {
      // the whitespace run ending at i contains two line breaks
      let nl = 0;
      let j = i - 1;
      while (j >= 0 && SPACE.test(cps[j])) {
        if (cps[j] === '\n' || cps[j] === ' ') nl++;
        j--;
      }
      return nl >= 2 && SPACE.test(prev);
    }
    case 'sentence': {
      // after ". " / "!" / "?" / "…" (+ closing quotes) and followed by whitespace
      if (!SPACE.test(prev)) {
        let j = i - 1;
        while (j >= 0 && CLOSERS.test(cps[j])) j--;
        return j >= 0 && SENTENCE_END.test(cps[j]) && (i >= cps.length || SPACE.test(cps[i]) || /[。！？]/u.test(cps[j]));
      }
      let j = i - 1;
      while (j >= 0 && SPACE.test(cps[j])) j--;
      while (j >= 0 && CLOSERS.test(cps[j])) j--;
      return j >= 0 && SENTENCE_END.test(cps[j]);
    }
    case 'line':
      return isNewline(prev);
    case 'clause': {
      let j = i - 1;
      while (j >= 0 && SPACE.test(cps[j])) j--;
      return j >= 0 && j < i - 1 && CLAUSE.test(cps[j]);
    }
    case 'space':
      return SPACE.test(prev);
  }
}

/** Minimum fill (share of `target`) a boundary of each kind must reach so chunks do not get needlessly small. */
const MIN_FILL: Record<Kind, number> = { paragraph: 0.8, sentence: 0.5, line: 0.5, clause: 0.5, space: 0.3 };
const ORDER: Kind[] = ['paragraph', 'sentence', 'line', 'clause', 'space'];

function findCut(cps: string[], pos: number, target: number, max: number): number {
  const hi = Math.min(cps.length, pos + max);
  const near = Math.min(cps.length, pos + target);
  for (const kind of ORDER) {
    const lo = pos + Math.floor(target * MIN_FILL[kind]);
    // closest boundary at or before the target, not too small …
    for (let i = near; i >= lo; i--) if (i > pos && boundary(cps, i, kind)) return i;
    // … otherwise the first one just above the target, still within the provider's limit
    for (let i = near + 1; i <= hi; i++) if (boundary(cps, i, kind)) return i;
  }
  // hard cut: as close to the target as possible without splitting a sequence
  for (let i = near; i > pos; i--) if (safeCut(cps, i)) return i;
  for (let i = near + 1; i <= hi; i++) if (safeCut(cps, i)) return i;
  return hi; // a single endless unbreakable sequence: cut at the limit
}

export function splitIntoChunks(text: string, opts: ChunkOptions = {}): Chunk[] {
  const max = Math.max(1, Math.floor(opts.max ?? DEFAULT_MAX));
  const target = Math.max(1, Math.min(max, Math.floor(opts.target ?? DEFAULT_TARGET)));
  const cps = Array.from(text); // code points: never splits a surrogate pair
  const out: Chunk[] = [];
  let pos = 0;
  while (pos < cps.length) {
    const cut = cps.length - pos <= max ? cps.length : findCut(cps, pos, target, max);
    let a = pos;
    let b = cut;
    while (a < b && SPACE.test(cps[a])) a++;
    while (b > a && SPACE.test(cps[b - 1])) b--;
    const prefix = cps.slice(pos, a).join('');
    const suffix = cps.slice(b, cut).join('');
    if (a === b) {
      // whitespace only: keep it, attached to the neighbour
      if (out.length) out[out.length - 1].suffix += prefix + suffix;
      else if (cut < cps.length) {
        // leading whitespace before the first chunk
        const next = splitIntoChunks(cps.slice(cut).join(''), { target, max });
        if (next.length) next[0].prefix = prefix + suffix + next[0].prefix;
        return next.map((c, i) => ({ ...c, index: i }));
      }
    } else {
      out.push({ index: out.length, source: cps.slice(a, b).join(''), prefix, suffix, chars: b - a });
    }
    pos = cut;
  }
  return out;
}

/** Glues the translated chunks back together in order. A chunk without a translation keeps its source text (flagged by the caller). */
export function mergeChunks(chunks: Chunk[], translated: (string | null | undefined)[]): string {
  return chunks.map((c, i) => c.prefix + (translated[i] ?? c.source) + c.suffix).join('');
}

/** The original text again (proves nothing was lost). */
export const joinSources = (chunks: Chunk[]) => chunks.map((c) => c.prefix + c.source + c.suffix).join('');
