// Generates the markdown tables used by docs/TRANSLATION_BENCHMARK_LAB.md from results/summary.json + selection.json (no hand-copied numbers).
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'results/summary.json'), 'utf8')).filter((r) => r.status === 'ok');
const sel = JSON.parse(fs.readFileSync(path.join(HERE, 'results/selection.json'), 'utf8'));
const n = (x, d = 1) => (x == null ? 'n/a' : Number(x).toFixed(d));
const label = (m) => ({ 'chrome-translator': 'Chrome Translator (existing provider)', envit5: 'EnViT5 (reference only)', 'm2m100-418m': 'M2M-100 418M', 'opus-mt': 'OPUS-MT' })[m] ?? m;
const out = [];

out.push('### T1 – Quality (reference-based; higher is better)\n');
out.push('| Model | Dir | chrF++ human refs (IWSLT+ALT, n=160) | BLEU human refs | chrF++ categories (author refs, unverified) | LaBSE adequacy proxy (ceiling = human ref) |');
out.push('|---|---|---|---|---|---|');
for (const r of S) out.push(`| ${label(r.model)} | ${r.direction} | ${n(r.quality.verified_refs.chrfpp, 2)} | ${n(r.quality.verified_refs.bleu, 2)} | ${n(r.quality.categories.chrfpp, 2)} | ${n(r.adequacy_labse?.mean, 4)} (${n(r.adequacy_labse?.reference_ceiling, 4)}) |`);

out.push('\n### T2 – Quality by sentence category (chrF++, author-written references – unverified)\n');
const cats = ['short', 'conversation', 'idiom', 'technical', 'academic', 'context', 'format'];
out.push(`| Model | Dir | ${cats.join(' | ')} |`);
out.push(`|---|---|${cats.map(() => '---').join('|')}|`);
for (const r of S) out.push(`| ${label(r.model)} | ${r.direction} | ${cats.map((c) => n(r.quality.by_category[c]?.chrfpp, 1)).join(' | ')} |`);

out.push('\n### T3 – Long text (1,486-character story, 4 paragraphs)\n');
out.push('| Model | Dir | chunked chrF++ | glossary recall % | chunked time s | chars/s | whole text in ONE call: output / reference length |');
out.push('|---|---|---|---|---|---|---|');
for (const r of S) out.push(`| ${label(r.model)} | ${r.direction} | ${n(r.quality.long.chunked.chrfpp, 1)} | ${n(r.quality.long.chunked.term_recall_pct, 0)} | ${n(r.quality.long.chunked.seconds, 1)} | ${n(r.quality.long.chunked.chars_per_s, 0)} | ${n(r.quality.long.whole.ratio, 2)} |`);

out.push('\n### T4 – Performance (dev machine, CPU only; see environment)\n');
out.push('| Model | Dir | download MB | disk MB | cold start s | p50 s | p95 s | avg s | chars/s | peak RSS MB | RSS after load MB | CPU % (all cores) |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of S) {
  const p = r.perf;
  out.push(`| ${label(r.model)} | ${r.direction} | ${p.download_s != null ? n(p.disk_mb, 0) : 'built in'} | ${n(p.disk_mb, 0)} | ${n(p.cold_start_s, 2)} | ${n(p.latency_s.p50, 3)} | ${n(p.latency_s.p95, 3)} | ${n(p.latency_s.avg, 3)} | ${n(p.throughput_chars_per_s, 0)} | ${n(p.peak_rss_mb, 0)} | ${n(p.rss_after_load_mb, 0)} | ${n(p.cpu_util_pct, 0)} |`);
}
out.push('\n### T5 – Weighted selection (only candidates with a verified commercial licence, measured in both directions)\n');
out.push('| Model | weighted score | quality | latency | RAM | size | compat | long text | meets minimums |');
out.push('|---|---|---|---|---|---|---|---|---|');
for (const c of sel.scored) out.push(`| ${label(c.model)} | **${c.score}** | ${n(c.parts.quality * 100, 0)} | ${n(c.parts.latency * 100, 0)} | ${n(c.parts.ram * 100, 0)} | ${n(c.parts.size * 100, 0)} | ${n(c.parts.compat * 100, 0)} | ${n(c.parts.long * 100, 0)} | ${c.fitsMin ? 'yes' : 'NO'} |`);
fs.writeFileSync(path.join(HERE, 'results/report-tables.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
