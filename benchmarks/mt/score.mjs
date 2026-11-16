// Computes quality metrics from results/*.json (hypotheses are stored in the result files) and writes results/summary.json + summary.md.
// Optional adequacy proxy (LaBSE cosine) is added by adequacy.mjs into results/adequacy.json.
import fs from 'node:fs';
import path from 'node:path';
import { bleu, chrfpp, repetition, termRecall } from './metrics.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RES = path.join(HERE, 'results');
const files = fs.readdirSync(RES).filter((f) => f.endsWith('.json') && !f.includes('.download') && !['summary.json', 'adequacy.json'].includes(f));
const adequacy = fs.existsSync(path.join(RES, 'adequacy.json')) ? JSON.parse(fs.readFileSync(path.join(RES, 'adequacy.json'), 'utf8')) : {};
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const rows = [];
for (const f of files.sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
  const id = `${r.model}__${r.dtype}__${r.direction}`;
  const row = { id, model: r.model, dtype: r.dtype, direction: r.direction, status: r.status, error: r.error };
  if (r.status === 'ok') {
    const q = {};
    for (const [name, items] of Object.entries(r.sets)) {
      const h = items.map((i) => i.hyp), t = items.map((i) => i.ref);
      q[name] = { n: items.length, bleu: bleu(h, t), chrfpp: chrfpp(h, t), repetition_pct: repetition(h), len_ratio: +(h.join('').length / t.join('').length).toFixed(3) };
      if (name === 'categories') {
        q.by_category = {};
        for (const c of new Set(items.map((i) => i.cat))) {
          const sub = items.filter((i) => i.cat === c);
          q.by_category[c] = { n: sub.length, chrfpp: chrfpp(sub.map((i) => i.hyp), sub.map((i) => i.ref)) };
        }
      }
    }
    // reference-based "verified" aggregate: only the public human-translated sets (iwslt + alt)
    const ver = [...r.sets.iwslt, ...r.sets.alt];
    q.verified_refs = { n: ver.length, bleu: bleu(ver.map((i) => i.hyp), ver.map((i) => i.ref)), chrfpp: chrfpp(ver.map((i) => i.hyp), ver.map((i) => i.ref)) };
    q.long = {
      src_chars: r.long.src_chars,
      chunked: { chrfpp: chrfpp([r.long.chunked], [r.long.ref]), bleu: bleu([r.long.chunked], [r.long.ref]), term_recall_pct: termRecall(r.long.chunked, r.direction), seconds: r.long.chunked_s, chars_per_s: r.long.chars_per_s_chunked },
      whole: { chrfpp: chrfpp([r.long.whole], [r.long.ref]), out_chars: r.long.whole.length, ref_chars: r.long.ref.length, ratio: +(r.long.whole.length / r.long.ref.length).toFixed(2), seconds: r.long.whole_s },
    };
    row.quality = q;
    row.perf = { cold_start_s: r.cold_start_s, disk_mb: r.disk_bytes == null ? null : Math.round(r.disk_bytes / 2 ** 20), download_s: r.download?.download_s, rss_after_load_mb: r.rss_after_load_mb, peak_rss_mb: r.peak_rss_mb, cpu_util_pct: r.cpu_util_pct_of_all_cores, latency_s: r.latency_s, throughput_chars_per_s: r.throughput_chars_per_s };
    row.adequacy_labse = adequacy[id] ?? null;
  }
  rows.push(row);
}
fs.writeFileSync(path.join(RES, 'summary.json'), JSON.stringify(rows, null, 1));
const f1 = (x) => (x == null ? 'n/a' : x);
let md = '| model | dtype | dir | chrF++ (verified refs) | BLEU (verified refs) | chrF++ (categories*) | LaBSE adequacy | p50 s | p95 s | cold s | disk MB | peak RSS MB |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows) {
  if (r.status !== 'ok') { md += `| ${r.model} | ${r.dtype} | ${r.direction} | FAILED: ${String(r.error).slice(0, 60)} |||||||||\n`; continue; }
  md += `| ${r.model} | ${r.dtype} | ${r.direction} | ${r.quality.verified_refs.chrfpp} | ${r.quality.verified_refs.bleu} | ${r.quality.categories.chrfpp} | ${f1(r.adequacy_labse?.mean)} | ${r.perf.latency_s.p50.toFixed(3)} | ${r.perf.latency_s.p95.toFixed(3)} | ${r.perf.cold_start_s} | ${f1(r.perf.disk_mb)} | ${f1(r.perf.peak_rss_mb)} |\n`;
}
fs.writeFileSync(path.join(RES, 'summary.md'), md);
console.log(md);
