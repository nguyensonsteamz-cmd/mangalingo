/**
 * End-to-end test of the LOCAL translation model in the real extension (Chrome, ONNX Runtime Web WASM in the offscreen document):
 *   not downloaded → cached=false · explicit download (progress) → cached=true · en→vi and vi→en translations · latency ·
 *   the same text translated twice is identical · unsupported model id → error · service-worker restart keeps the cached model.
 * Needs network once (model download from Hugging Face, ~107 MB per direction); the Chrome profile is temporary, so the model is
 * downloaded in every run. Run:  npm run build && node scripts/mt-local-e2e.mjs
 */
import { resolve } from 'node:path';
import { launch, sleep, waitFor } from './cdp.mjs';

const dist = resolve(import.meta.dirname, '..', 'dist');
const browser = await launch({ headless: true });
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, detail });
    console.log(`✓ ${name} (${Date.now() - t} ms)${detail ? ' – ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

try {
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: dist });
  const { targetId } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/options/index.html` });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (m, p) => browser.send(m, p, sessionId);
  await cdp('Runtime.enable');
  await sleep(1500);
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const msg = (m) => ev(`chrome.runtime.sendMessage(${JSON.stringify(m)}).then(r => { if (!r || !r.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const EN = 'local-opus-mt-en-vi';
  const VI = 'local-opus-mt-vi-en';

  await step('model is NOT on the device before the user agrees', async () => {
    assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'cached should be false in a fresh profile');
  });
  await step('unknown model id is rejected', async () => {
    let err = '';
    try { await msg({ type: 'mtlocal:status', modelId: 'nope' }); } catch (e) { err = e.message; }
    assert(/không tồn tại|Mô hình/.test(err), 'expected an error, got: ' + err);
  });

  const download = async (id) => {
    let st = await msg({ type: 'mtlocal:start', modelId: id });
    const seen = [];
    await waitFor(async () => {
      st = await msg({ type: 'mtlocal:status', modelId: id });
      if (st.state === 'downloading') seen.push(Math.round((st.loaded / Math.max(1, st.total)) * 100));
      if (st.state === 'error') throw new Error('download error: ' + st.error);
      return st.state === 'ready';
    }, { timeout: 600000, interval: 1000, label: 'model download' });
    return seen;
  };
  await step('en→vi: explicit download with progress, then cached', async () => {
    const seen = await download(EN);
    assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === true, 'cached should be true after download');
    return `progress samples ${seen.length}, max ${Math.max(0, ...seen)}%`;
  });
  await step('en→vi translation (sentence)', async () => {
    const t = Date.now();
    const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'I do not understand what you mean.' });
    assert(out && /tôi|Tôi/.test(out), 'unexpected: ' + out);
    return `"${out}" in ${Date.now() - t} ms`;
  });
  await step('en→vi is deterministic (same text twice)', async () => {
    const a = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Restart the server after changing the configuration file.' });
    const b = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Restart the server after changing the configuration file.' });
    assert(a === b && a.length > 10, `${a} | ${b}`);
    return a;
  });
  await step('vi→en: download + translation', async () => {
    await download(VI);
    const out = await msg({ type: 'mtlocal:translate', modelId: VI, text: 'Xin lỗi, bạn có thể nói chậm hơn một chút được không?' });
    assert(/slow|sorry|Sorry/i.test(out), 'unexpected: ' + out);
    return out;
  });
  await step('page stays responsive while the model translates (UI thread is not blocked)', async () => {
    // a 60 ms interval ticks while a 9-sentence text is translated in the worker: the longest gap must stay small
    const r = await ev(`(async () => {
      let last = performance.now(), maxGap = 0, n = 0;
      const t = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; n++; }, 60);
      const text = ${JSON.stringify(Array(9).fill('The quick brown fox jumps over the lazy dog near the river bank.').join(' '))};
      const out = await chrome.runtime.sendMessage({ type: 'mtlocal:translate', modelId: ${JSON.stringify(EN)}, text });
      clearInterval(t);
      return { maxGap: Math.round(maxGap), ticks: n, ok: out.ok };
    })()`);
    assert(r.ok && r.maxGap < 400, JSON.stringify(r));
    return `max event-loop gap ${r.maxGap} ms over ${r.ticks} ticks`;
  });
  await step('SHA-256 + size verification of the downloaded files passes', async () => {
    assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'ok', 'verify not ok');
  });
  await step('a damaged file is detected, the model is deleted, the user is asked to download again, and a re-download repairs it', async () => {
    // overwrite the encoder in the shared Cache storage with garbage of the SAME size (what a bit-rot / partial write would look like)
    const size = await ev(`(async () => { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes('encoder_model_quantized')) { const n = (await (await c.match(r)).blob()).size; await c.put(r, new Response(new Uint8Array(n).fill(7))); return n; } return 0; })()`);
    assert(size > 1e6, 'encoder entry not found');
    assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'corrupt', 'corruption not detected');
    await msg({ type: 'mtlocal:release' }); // fresh worker: the next translation has to load the damaged file
    let err = '';
    try { await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Hello there.' }); } catch (e) { err = e.message; }
    assert(/hỏng|tải lại/.test(err), 'expected a "damaged, download again" error, got: ' + err);
    assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'damaged model must have been removed');
    await download(EN);
    assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'ok', 'repair failed');
    const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'I do not understand what you mean.' });
    assert(out.length > 5, 'no translation after repair');
  });
  await step('cancel: a download stopped halfway leaves nothing behind and can be started again', async () => {
    await msg({ type: 'mtlocal:remove', modelId: VI });
    await msg({ type: 'mtlocal:start', modelId: VI });
    await sleep(300);
    const st = await msg({ type: 'mtlocal:cancel', modelId: VI });
    assert(st.state === 'idle', JSON.stringify(st));
    assert((await msg({ type: 'mtlocal:cached', modelId: VI })) === false, 'partial model must not count as downloaded');
    await download(VI);
    assert((await msg({ type: 'mtlocal:verify', modelId: VI })) === 'ok', 'verify after restart');
  });
  await step('release frees the worker; the model stays cached on disk', async () => {
    await msg({ type: 'mtlocal:release' });
    assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === true, 'cache should survive release');
    const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Good morning.' });
    assert(out.length > 2, 'translate after release failed');
  });
} finally {
  await browser.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} steps passed`);
process.exit(bad.length ? 1 : 0);
