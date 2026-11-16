/**
 * The local translation model inside the PHONE bundle (iOS web build, same code as Android's), served over http and driven in
 * headless Chrome: the in-page router hosts the model in a Web Worker. This does NOT test a real iPhone / Android WebView
 * (custom-scheme workers on iOS are unverified, see docs/MT_ENGINE_TEST_REPORT.md); it proves the shared JS path works.
 *   npm run build:ios-web && node scripts/mt-local-mobile-test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { attach, launch, sleep, waitFor } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'ios/MangaLingo/web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const srv = http.createServer(async (q, r) => {
  try {
    const path = new URL(q.url, 'http://x').pathname;
    const f = join(ROOT, decodeURIComponent(path === '/' ? '/index.html' : path));
    const body = await readFile(f);
    r.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(body);
  } catch {
    r.writeHead(404).end();
  }
});
await new Promise((res) => srv.listen(48093, '127.0.0.1', res));

const FAKE = `window.MangaLingoPlatform = 'ios'; window.webkit = { messageHandlers: { ml: { postMessage: async (m) => m.cmd === 'pendingScan' ? { stamp: 0 } : m.cmd === 'mtStatus' ? { status: 'installed' } : true } } };`;
const browser = await launch({ headless: true });
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const d = await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name} (${Date.now() - t} ms)${d ? ' – ' + d : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const p = await attach(browser, targetId);
  await p.send('Runtime.enable');
  await p.send('Page.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
  await p.send('Page.navigate', { url: 'http://127.0.0.1:48093/index.html#home' });
  await sleep(2500);
  const msg = (m) => p.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(m)}).then(r => { if (!r || !r.ok) throw new Error((r && r.error) || 'no response'); return r.data; })`);
  const EN = 'local-opus-mt-en-vi';
  const VI = 'local-opus-mt-vi-en';

  await step('not downloaded before the user agrees', async () => assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'cached'));
  await step('Settings tab renders (the model card lives in Hạn mức dịch; checked in the extension e2e)', async () => {
    await p.evaluate(`location.hash = 'settings'`);
    await sleep(600);
    const txt = await p.evaluate(`document.body.innerText`);
    assert(/Mô hình dịch|Hạn mức/.test(txt), 'settings not rendered');
  });
  const download = async (id) => {
    await msg({ type: 'mtlocal:start', modelId: id });
    await waitFor(async () => {
      const st = await msg({ type: 'mtlocal:status', modelId: id });
      if (st.state === 'error') throw new Error(st.error);
      return st.state === 'ready';
    }, { timeout: 300000, interval: 800, label: 'download' });
  };
  await step('en→vi: download in the app page worker, then translate', async () => {
    await download(EN);
    const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Where is the nearest train station?' });
    assert(out && out.length > 5, 'empty');
    return out;
  });
  await step('vi→en: download + translate', async () => {
    await download(VI);
    const out = await msg({ type: 'mtlocal:translate', modelId: VI, text: 'Tôi muốn đặt một bàn cho bốn người.' });
    assert(/table|four/i.test(out), 'unexpected: ' + out);
    return out;
  });
  await step('UI thread stays responsive while the worker translates', async () => {
    const r = await p.evaluate(`(async () => {
      let last = performance.now(), maxGap = 0;
      const t = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 60);
      const text = ${JSON.stringify(Array(8).fill('The weather is nice today and we are going to the market.').join(' '))};
      await chrome.runtime.sendMessage({ type: 'mtlocal:translate', modelId: ${JSON.stringify(EN)}, text });
      clearInterval(t);
      return Math.round(maxGap);
    })()`);
    assert(r < 400, 'max gap ' + r);
    return `max event-loop gap ${r} ms`;
  });
  await step('remove deletes the files; availability goes back to "download"', async () => {
    await msg({ type: 'mtlocal:remove', modelId: EN });
    assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'still cached');
  });
} finally {
  await browser.close();
  srv.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} steps passed`);
process.exit(bad.length ? 1 : 0);
