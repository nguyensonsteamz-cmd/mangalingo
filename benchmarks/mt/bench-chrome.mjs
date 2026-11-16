// Baseline: Chrome's built-in Translator API (the provider LingoLens already uses on Chrome), measured with the SAME data and
// the same scoring as the ONNX models. Runs headless Chrome through the project's CDP helper, serves a tiny page on 127.0.0.1
// (secure context), downloads Chrome's own model inside a user gesture, then translates. Latency here includes the IPC to
// Chrome's translation service. RAM / disk are not attributable to a single process → recorded as n/a.
// usage: node bench-chrome.mjs <en-vi|vi-en>
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, sleep } from '../../scripts/cdp.mjs';

const direction = process.argv[2] || 'en-vi';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [S, T] = direction.split('-');
const jl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sets = {
  categories: jl(path.join(HERE, 'data/categories.jsonl')).filter((r) => r.dir === direction).map((r) => ({ src: r.src, ref: r.ref, cat: r.cat })),
  iwslt: jl(path.join(HERE, 'data/iwslt.jsonl')).map((r) => ({ src: r[S], ref: r[T], cat: 'iwslt' })),
  alt: jl(path.join(HERE, 'data/alt.jsonl')).map((r) => ({ src: r[S], ref: r[T], cat: 'alt' })),
};
const [ls, lr] = S === 'en' ? ['long_en.txt', 'long_vi.txt'] : ['long_vi.txt', 'long_en.txt'];
const longSrc = fs.readFileSync(path.join(HERE, 'data', ls), 'utf8').trim();
const longRef = fs.readFileSync(path.join(HERE, 'data', lr), 'utf8').trim();

const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>bench</title><body>bench'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const res = { model: 'chrome-translator', label: "Chrome built-in Translator API (existing provider)", dtype: 'n/a', direction, runtime: 'Chrome built-in (Gemini-Nano-independent translation model, managed by Chrome)',
  env: { platform: 'dev-machine-windows-cpu (NOT a phone)', cpu: os.cpus()[0].model, logicalCores: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version }, status: 'started' };
const browser = await launch({ headless: true });
try {
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (m, p) => browser.send(m, p, sessionId);
  await cdp('Runtime.enable');
  await sleep(800);
  const ev = async (expression, gesture = false) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const opts = `{sourceLanguage:'${S}',targetLanguage:'${T}'}`;
  res.availability_before = await ev(`typeof Translator==='undefined' ? 'unsupported' : Translator.availability(${opts})`);
  if (res.availability_before === 'unsupported' || res.availability_before === 'unavailable') throw new Error('Translator API ' + res.availability_before + ' for ' + direction);
  const t0 = Date.now();
  await ev(`(async()=>{ window.__tr = await Translator.create(${opts}); return true; })()`, true);
  res.create_s = +((Date.now() - t0) / 1000).toFixed(1); // includes the one-time model download when the model was missing
  await ev(`window.__tr.translate(${JSON.stringify(S === 'en' ? 'Hello.' : 'Xin chào.')})`);
  const lat = []; res.sets = {};
  for (const [name, items] of Object.entries(sets)) {
    const rows = [];
    for (const it of items) {
      const t = performance.now();
      const hyp = await ev(`window.__tr.translate(${JSON.stringify(it.src)})`);
      const dt = (performance.now() - t) / 1000; lat.push(dt); rows.push({ ...it, hyp, lat_s: +dt.toFixed(4) });
    }
    res.sets[name] = rows;
  }
  const paras = longSrc.split(/\n\s*\n/).filter((p) => p.trim());
  let t = performance.now(); let whole = ''; try { whole = await ev(`window.__tr.translate(${JSON.stringify(longSrc)})`); } catch (e) { whole = 'ERROR ' + e.message; }
  const wholeS = (performance.now() - t) / 1000;
  t = performance.now(); const outs = [];
  for (const p of paras) outs.push(await ev(`window.__tr.translate(${JSON.stringify(p)})`));
  const chunkedS = (performance.now() - t) / 1000;
  res.long = { src: longSrc, ref: longRef, src_chars: longSrc.length, whole, whole_s: +wholeS.toFixed(2), chunked: outs.join('\n\n'), chunked_s: +chunkedS.toFixed(2), chars_per_s_chunked: +(longSrc.length / chunkedS).toFixed(1) };
  const sorted = [...lat].sort((a, b) => a - b); const pct = (p) => +sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(4);
  res.latency_s = { n: lat.length, avg: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(4), p50: pct(0.5), p95: pct(0.95) };
  res.cold_start_s = res.create_s; res.disk_bytes = null; res.peak_rss_mb = null; res.cpu_util_pct_of_all_cores = null; res.rss_after_load_mb = null;
  const chars = Object.values(res.sets).flat().reduce((n, r) => n + r.src.length, 0);
  res.throughput_chars_per_s = +(chars / lat.reduce((a, b) => a + b, 0)).toFixed(1);
  res.status = 'ok';
} catch (e) {
  res.status = 'failed'; res.error = String(e?.message ?? e);
}
await browser.close(); server.close();
fs.writeFileSync(path.join(HERE, 'results', `chrome-translator__na__${direction}.json`), JSON.stringify(res, null, 1));
console.log('chrome-translator', direction, res.status, res.error ?? '', res.latency_s ?? '');
process.exit(0);
