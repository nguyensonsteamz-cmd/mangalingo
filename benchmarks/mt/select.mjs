// Model selection from MEASURED results only (results/summary.json). The weights are the ones fixed by the task:
// quality 35 · latency 20 · RAM 15 · size 10 · platform compatibility 10 · long text 10 · commercial licence = gate (not a score).
// Only candidates with a verified commercial licence AND measured results in BOTH directions are scored.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'results/summary.json'), 'utf8'));

// Licence gate (read from the model cards / READMEs on 2026-11-16, see docs/MT_ENGINE_MODEL_SELECTION.md)
const LICENSE = {
  'opus-mt': { eligible: true, weights: 'apache-2.0 (model card of Helsinki-NLP/opus-mt-en-vi and -vi-en)', note: 'training data is OPUS/Tatoeba (mixed per-corpus licences); weights are published under Apache-2.0' },
  'm2m100-418m': { eligible: true, weights: 'mit (model card of facebook/m2m100_418M)', note: 'training data CCMatrix/CCAligned (web-crawled)' },
  envit5: { eligible: false, weights: 'openrail (VietAI/envit5-translation)', note: 'trained on PhoMT, whose terms allow "research or educational purposes only" and forbid redistribution → commercial use not established; OpenRAIL adds use restrictions' },
  'chrome-translator': { eligible: null, weights: 'not a distributable model: Chrome built-in, already integrated', note: 'reference only' },
};
// Hard minimums (decided BEFORE looking at the ranking): fit a phone, usable latency, no degeneration.
const MIN = { peakRssMb: 1000, diskMb: 150, p95s: 3, repetitionPct: 2 };

const by = {};
for (const r of rows) (by[r.model] ??= {})[r.direction] = r;
const cand = [];
for (const [model, d] of Object.entries(by)) {
  if (!d['en-vi'] || !d['vi-en']) continue;
  if (d['en-vi'].status !== 'ok' || d['vi-en'].status !== 'ok') { cand.push({ model, excluded: 'benchmark failed' }); continue; }
  const lic = LICENSE[model];
  const avg = (f) => (f(d['en-vi']) + f(d['vi-en'])) / 2;
  const m = {
    model, license: lic,
    quality: avg((r) => r.quality.verified_refs.chrfpp),
    qualityBleu: avg((r) => r.quality.verified_refs.bleu),
    p50: avg((r) => r.perf.latency_s.p50), p95: Math.max(d['en-vi'].perf.latency_s.p95, d['vi-en'].perf.latency_s.p95),
    peakRssMb: Math.max(d['en-vi'].perf.peak_rss_mb ?? 0, d['vi-en'].perf.peak_rss_mb ?? 0) || null,
    diskMb: (d['en-vi'].perf.disk_mb ?? 0) + (d['vi-en'].perf.disk_mb ?? 0) > 0 ? Math.max(d['en-vi'].perf.disk_mb, d['vi-en'].perf.disk_mb) : null,
    long: avg((r) => r.quality.long.chunked.chrfpp * 0.6 + r.quality.long.chunked.term_recall_pct * 0.4),
    repetition: Math.max(d['en-vi'].quality.iwslt.repetition_pct, d['vi-en'].quality.iwslt.repetition_pct),
  };
  if (model === 'opus-mt') m.diskMb = (d['en-vi'].perf.disk_mb ?? 0) + (d['vi-en'].perf.disk_mb ?? 0); // two separate checkpoints are needed (one per direction)
  m.fitsMin = m.peakRssMb != null && m.peakRssMb < MIN.peakRssMb && m.diskMb < MIN.diskMb * 2 && m.p95 < MIN.p95s && m.repetition < MIN.repetitionPct;
  cand.push(m);
}
const scored = cand.filter((c) => c.license?.eligible === true && !c.excluded);
const norm = (vals, higherBetter) => { const lo = Math.min(...vals), hi = Math.max(...vals); return vals.map((v) => (hi === lo ? 1 : higherBetter ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo))); };
const q = norm(scored.map((c) => c.quality), true), lat = norm(scored.map((c) => c.p50), false), ram = norm(scored.map((c) => c.peakRssMb), false), size = norm(scored.map((c) => c.diskMb), false), lng = norm(scored.map((c) => c.long), true);
scored.forEach((c, i) => {
  // platform compatibility: share of the three platforms where the measured peak RAM is below the phone limit (Chrome desktop always ok; Android / iOS need < 1 GB) - an inference from dev-machine numbers, NOT a device test
  const compat = (1 + 2 * (c.peakRssMb < MIN.peakRssMb ? 1 : 0)) / 3;
  c.parts = { quality: q[i], latency: lat[i], ram: ram[i], size: size[i], compat, long: lng[i] };
  c.score = +(100 * (0.35 * q[i] + 0.2 * lat[i] + 0.15 * ram[i] + 0.1 * size[i] + 0.1 * compat + 0.1 * lng[i])).toFixed(1);
});
scored.sort((a, b) => b.score - a.score);
const out = { minimums: MIN, scored, ineligible: cand.filter((c) => c.license?.eligible !== true), winner: scored.find((c) => c.fitsMin)?.model ?? null };
fs.writeFileSync(path.join(HERE, 'results/selection.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ winner: out.winner, scored: scored.map((c) => ({ m: c.model, score: c.score, fitsMin: c.fitsMin, quality: +c.quality.toFixed(2), p50: +c.p50.toFixed(3), rss: c.peakRssMb, disk: c.diskMb, long: +c.long.toFixed(1) })), ineligible: out.ineligible.map((c) => c.model) }, null, 1));
