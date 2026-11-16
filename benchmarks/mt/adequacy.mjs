// Adequacy PROXY: cosine similarity between LaBSE embeddings of source and hypothesis (cross-lingual). This is not COMET and not
// a human judgement; it only flags hypotheses that drift semantically. LaBSE (sentence-transformers/LaBSE) is Apache-2.0.
// Run AFTER the latency benchmarks (it uses the CPU).
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';

env.cacheDir = 'D:/extension/.tmp/hf-js/labse';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RES = path.join(HERE, 'results');
const emb = await pipeline('feature-extraction', 'Xenova/LaBSE', { dtype: 'q8' });
const vec = async (t) => Array.from((await emb(t, { pooling: 'mean', normalize: true })).data);
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const out = {};
for (const f of fs.readdirSync(RES).filter((f) => /__/.test(f) && f.endsWith('.json') && !f.includes('.download'))) {
  const r = JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
  if (r.status !== 'ok') continue;
  const scores = [];
  for (const items of Object.values(r.sets)) for (const it of items) scores.push(cos(await vec(it.src), await vec(it.hyp)));
  // reference vs source as the ceiling for the same items
  const ceil = [];
  for (const items of Object.values(r.sets)) for (const it of items) ceil.push(cos(await vec(it.src), await vec(it.ref)));
  const m = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4);
  out[`${r.model}__${r.dtype}__${r.direction}`] = { mean: m(scores), reference_ceiling: m(ceil), n: scores.length };
  console.log(f, out[`${r.model}__${r.dtype}__${r.direction}`]);
}
fs.writeFileSync(path.join(RES, 'adequacy.json'), JSON.stringify(out, null, 1));
