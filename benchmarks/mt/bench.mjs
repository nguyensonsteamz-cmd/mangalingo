// LingoLens Translation Benchmark Lab runner (Node + ONNX Runtime CPU through transformers.js).
// One process = one (model, dtype, direction). Writes results/<model>__<dtype>__<direction>.json.
// usage: node bench.mjs <model> <dtype> <direction> [download]
// Everything is MEASURED on this development machine (labelled in `env`); nothing is estimated.
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [key, dtype, direction, mode] = process.argv.slice(2);
const MODELS = JSON.parse(fs.readFileSync(path.join(HERE, 'models.json'), 'utf8'));
const cfg = MODELS[key];
const repo = cfg.repos[direction] ?? cfg.repos.both;
const cache = path.join('D:/extension/.tmp/hf-js', `${key}-${dtype}-${cfg.repos[direction] ? direction : 'both'}`);
env.cacheDir = cache;
const [S, T] = direction.split('-');
const L = { en: 'en', vi: 'vi' };

const jl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const dirSize = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } return n; };

function sets() {
  const out = {};
  out['categories'] = jl(path.join(HERE, 'data/categories.jsonl')).filter((r) => r.dir === direction).map((r) => ({ src: r.src, ref: r.ref, cat: r.cat }));
  for (const n of ['iwslt', 'alt']) {
    const rows = jl(path.join(HERE, `data/${n}.jsonl`));
    out[n] = rows.map((r) => ({ src: r[S], ref: r[T], cat: n }));
  }
  return out;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * p) - 1))];
const res = {
  model: key, label: cfg.label, dtype, direction, repo, upstream: cfg.upstream[direction] ?? cfg.upstream.both,
  runtime: 'onnxruntime-node (CPU) via @huggingface/transformers 3.7.6',
  env: { platform: 'dev-machine-windows-cpu (NOT a phone)', cpu: os.cpus()[0].model, logicalCores: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version },
  status: 'started',
};
const rpath = path.join(HERE, 'results', `${key}__${dtype}__${direction}.json`);

try {
  const t0 = performance.now();
  const tr = await pipeline('translation', repo, { dtype });
  if (mode === 'download') {
    const r = { download_s: +((performance.now() - t0) / 1000).toFixed(1), bytes: dirSize(cache) };
    fs.writeFileSync(path.join(HERE, 'results', `${key}__${dtype}__${direction}.download.json`), JSON.stringify(r));
    console.log('downloaded', JSON.stringify(r)); process.exit(0);
  }
  const call = async (text) => {
    const o = cfg.family === 'm2m100' ? { src_lang: L[S], tgt_lang: L[T] } : {};
    const pre = cfg.prefix?.[direction] ?? '';
    const r = await tr(pre + text, { ...o, num_beams: 4, max_new_tokens: 512 });
    const out = r[0].translation_text;
    return cfg.stripLangPrefix ? out.replace(/^(vi|en):s*/, '') : out;
  };
  await call(S === 'en' ? 'Hello.' : 'Xin chào.');
  res.cold_start_s = +((performance.now() - t0) / 1000).toFixed(2); // load from local disk + first inference
  res.disk_bytes = dirSize(cache);
  res.rss_after_load_mb = Math.round(process.memoryUsage().rss / 2 ** 20);
  await call(S === 'en' ? 'Good morning, how are you today?' : 'Chào buổi sáng, hôm nay bạn thế nào?'); // warm-up

  const cpu0 = process.cpuUsage(); const w0 = performance.now();
  const lat = []; res.sets = {};
  for (const [name, items] of Object.entries(sets())) {
    const rows = [];
    for (const it of items) {
      const t = performance.now(); const hyp = await call(it.src); const dt = (performance.now() - t) / 1000;
      lat.push(dt); rows.push({ ...it, hyp, lat_s: +dt.toFixed(4) });
    }
    res.sets[name] = rows;
  }
  // long text: (a) whole text in one call (what happens at the model's token limit) (b) paragraph chunks (what the app's chunker does)
  const [ls, lr] = S === 'en' ? ['long_en.txt', 'long_vi.txt'] : ['long_vi.txt', 'long_en.txt'];
  const src = fs.readFileSync(path.join(HERE, 'data', ls), 'utf8').trim();
  const ref = fs.readFileSync(path.join(HERE, 'data', lr), 'utf8').trim();
  let t = performance.now(); const whole = await call(src); const wholeS = (performance.now() - t) / 1000;
  t = performance.now(); const paras = src.split(/\n\s*\n/).filter((p) => p.trim()); const outs = [];
  for (const p of paras) outs.push(await call(p));
  const chunkedS = (performance.now() - t) / 1000;
  res.long = { src, ref, src_chars: src.length, whole, whole_s: +wholeS.toFixed(2), chunked: outs.join('\n\n'), chunked_s: +chunkedS.toFixed(2), chars_per_s_chunked: +(src.length / chunkedS).toFixed(1) };

  const wall = (performance.now() - w0) / 1000; const cpu = process.cpuUsage(cpu0);
  res.cpu_util_pct_of_all_cores = +(((cpu.user + cpu.system) / 1e6 / wall / os.cpus().length) * 100).toFixed(1);
  res.peak_rss_mb = Math.round(process.resourceUsage().maxRSS / 1024);
  const sorted = [...lat].sort((a, b) => a - b);
  res.latency_s = { n: lat.length, avg: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(4), p50: +pct(sorted, 0.5).toFixed(4), p95: +pct(sorted, 0.95).toFixed(4) };
  const chars = Object.values(res.sets).flat().reduce((n, r) => n + r.src.length, 0);
  res.throughput_chars_per_s = +(chars / lat.reduce((a, b) => a + b, 0)).toFixed(1);
  const dl = path.join(HERE, 'results', `${key}__${dtype}__${direction}.download.json`);
  if (fs.existsSync(dl)) res.download = JSON.parse(fs.readFileSync(dl, 'utf8'));
  res.status = 'ok';
} catch (e) {
  res.status = 'failed'; res.error = String(e?.message ?? e); res.trace = String(e?.stack ?? '').slice(0, 1500);
}
fs.writeFileSync(rpath, JSON.stringify(res, null, 1));
console.log(key, dtype, direction, res.status, res.error ?? '');
process.exit(0);
