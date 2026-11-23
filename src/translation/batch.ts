/**
 * Translating SEVERAL short texts (the speech bubbles of one scan) through the selected Google provider with few requests.
 *
 * Google Translate (web) is called one request at a time with a minimum gap, so 12 bubbles as 12 requests would take 15+ s. The
 * bubbles are joined one per line, translated together and split back by line. The split is VERIFIED (same number of lines, none
 * empty); if Google changed the line structure, the group is translated text by text instead (bounded, still in order). Nothing is
 * ever returned for a text that was not translated.
 */
import { send } from '@/shared/messages';
import { googleActive } from './chrome-mt';
import type { TranslateOutcome } from '@/modules/usage/types';

const MAX_GROUP_CHARS = 1200;
const MAX_GROUP_ITEMS = 25;

export interface BatchDeps {
  active(): Promise<boolean>;
  translate(text: string): Promise<TranslateOutcome>;
}

const defaultDeps: BatchDeps = {
  active: googleActive,
  translate: (text) => send({ type: 'usage:translate', text, keepBreaks: true }),
};

/** One result per input text, or `null` when Google Translate (web) is NOT the selected provider (the caller uses its own translator). */
export async function translateBatchViaGoogle(texts: string[], deps: BatchDeps = defaultDeps): Promise<string[] | null> {
  if (!(await deps.active())) return null;
  const clean = texts.map((t) => t.replace(/\s+/g, ' ').trim());
  const out: string[] = clean.map(() => '');

  const one = async (i: number): Promise<boolean> => {
    if (!clean[i]) return true;
    const r = await deps.translate(clean[i]);
    if (r.source !== 'google') return false; // the provider was switched meanwhile
    out[i] = r.text;
    return true;
  };

  let group: number[] = [];
  let size = 0;
  const flush = async (): Promise<boolean> => {
    const g = group;
    group = [];
    size = 0;
    if (!g.length) return true;
    if (g.length === 1) return one(g[0]);
    const r = await deps.translate(g.map((i) => clean[i]).join('\n'));
    if (r.source !== 'google') return false;
    const parts = r.text.split('\n').map((p) => p.trim());
    if (parts.length === g.length && parts.every(Boolean)) {
      g.forEach((i, k) => (out[i] = parts[k]));
      return true;
    }
    for (const i of g) if (!(await one(i))) return false; // line structure not kept: text by text
    return true;
  };

  for (let i = 0; i < clean.length; i++) {
    if (!clean[i]) continue;
    const len = [...clean[i]].length;
    if (group.length && (size + len + 1 > MAX_GROUP_CHARS || group.length >= MAX_GROUP_ITEMS)) if (!(await flush())) return null;
    group.push(i);
    size += len + 1;
  }
  if (!(await flush())) return null;
  return out;
}
