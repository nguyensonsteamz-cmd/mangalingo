/**
 * Drives the REAL Android app (debug build) in the emulator through the WebView's DevTools socket:
 * ML Kit en→vi / vi→en (model availability, download, translation, errors) and the downloaded OPUS-MT model
 * (download, translate both directions, chunked long text, cancel, UI responsiveness, memory) in the real Android WebView.
 *   adb install the debug APK, start the app, then: node scripts/android-emulator-test.mjs
 */
import { execFileSync } from 'node:child_process';

const ADB = 'D:/androidtools/sdk/platform-tools/adb.exe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const sock = adb('shell', 'cat /proc/net/unix').split('\n').map((l) => l.match(/@(webview_devtools_remote_(\d+))/)).filter(Boolean);
const pid = adb('shell', 'pidof app.mangalingo').trim();
const want = sock.find((m) => m[2] === pid);
if (!want) throw new Error('app WebView devtools socket not found for pid ' + pid);
adb('forward', 'tcp:9333', `localabstract:${want[1]}`);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result.result.value;
};
const msg = (m) => ev(`chrome.runtime.sendMessage(${JSON.stringify(m)}).then(r => { if (!r || !r.ok) throw new Error((r && r.error) || 'no response'); return r.data; })`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** app process + the WebView renderer(s) that run its pages (where the WASM model lives), in MB PSS */
const pss = (p) => Number((adb('shell', 'dumpsys meminfo ' + p).match(/TOTAL PSS:\s+(\d+)/) ?? [0, 0])[1]) / 1024;
const mem = () => {
  const lines = adb('shell', 'ps -A').split(String.fromCharCode(10));
  const sandboxed = lines.filter((l) => l.includes('sandboxed_process')).map((l) => l.trim().split(/\s+/)[1]);
  return pss(pid) + Math.max(0, ...sandboxed.map(pss)); // the app process + the largest WebView renderer (where the WASM model runs)
};

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`✓ ${name} (${Date.now() - t} ms)${d ? ' – ' + d : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`✗ ${name}: ${String(e?.message ?? e).slice(0, 300)}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

await cdp('Runtime.enable');
console.log('page:', page.url, '| device ABI:', adb('shell', 'getprop ro.product.cpu.abi').trim(), '| Android', adb('shell', 'getprop ro.build.version.release').trim(), '| RAM MB', Math.round(Number(adb('shell', 'cat /proc/meminfo').match(/MemTotal:\s+(\d+)/)[1]) / 1024));

// ---------- ML Kit ----------
await step('platform: Android native bridge present, Translator shim installed', async () => {
  const r = await ev(`({ native: typeof window.MangaLingoNative, translator: typeof window.Translator })`);
  assert(r.translator === 'object', JSON.stringify(r));
  return JSON.stringify(r);
});
const mlkit = (pair) => `(async () => {
  const o = ${JSON.stringify(pair === 'vi>en' ? { sourceLanguage: 'vi', targetLanguage: 'en' } : { sourceLanguage: 'en', targetLanguage: 'vi' })};
  const a = await Translator.availability(o);
  const t = await Translator.create(o);
  return { a, out: await t.translate(${JSON.stringify(pair === 'vi>en' ? 'Tôi muốn đặt một bàn cho bốn người.' : 'Where is the nearest train station?')}) };
})()`;
await step('ML Kit en→vi: availability → download (if needed) → translation', async () => {
  const r = await ev(mlkit('en>vi'));
  assert(r.out && r.out.length > 5, JSON.stringify(r));
  return `${r.a} → "${r.out}"`;
});
await step('ML Kit vi→en: separate translator, translation', async () => {
  const r = await ev(mlkit('vi>en'));
  assert(/table|four|reserve|book/i.test(r.out), JSON.stringify(r));
  return `${r.a} → "${r.out}"`;
});
await step('ML Kit: both directions return different, correct-language output for the same words', async () => {
  const r = await ev(`(async () => { const a = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'vi' }); const b = await Translator.create({ sourceLanguage: 'vi', targetLanguage: 'en' }); return [await a.translate('Good morning'), await b.translate('Chào buổi sáng')]; })()`);
  assert(/chào|sáng/i.test(r[0]) && /morning/i.test(r[1]), JSON.stringify(r));
  return JSON.stringify(r);
});
await step('ML Kit: unsupported op / pair is rejected by the bridge (no crash)', async () => {
  const r = await ev(`new Promise((res) => { const old = window.__mlMt; window.__mlMt = (id, ok, text) => { window.__mlMt = old; res({ ok, text }); }; MangaLingoNative.mt(99999, 'translate:fr>de', 'x'); setTimeout(() => res({ timeout: true }), 4000); })`);
  assert(r.ok === false && /unsupported/.test(r.text), JSON.stringify(r));
});

// ---------- OPUS-MT in the real WebView ----------
const EN = 'local-opus-mt-en-vi';
const VI = 'local-opus-mt-vi-en';
await step('OPUS-MT: not on the device before the user agrees', async () => assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'cached'));
const download = async (id) => {
  await msg({ type: 'mtlocal:start', modelId: id });
  const t0 = Date.now();
  for (;;) {
    const st = await msg({ type: 'mtlocal:status', modelId: id });
    if (st.state === 'error') throw new Error(st.error);
    if (st.state === 'ready') return;
    if (Date.now() - t0 > 600000) throw new Error('download timeout');
    await sleep(1000);
  }
};
let baseMem = mem();
await step('OPUS-MT en→vi: download in the Android WebView worker + translate', async () => {
  await download(EN);
  assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === true, 'not cached after download');
  const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Where is the nearest train station?' });
  assert(out.length > 5, 'empty');
  return out;
});
await step('OPUS-MT vi→en: download + translate', async () => {
  await download(VI);
  const out = await msg({ type: 'mtlocal:translate', modelId: VI, text: 'Tôi muốn đặt một bàn cho bốn người.' });
  assert(/table|four|reserv/i.test(out), out);
  return out;
});
await step('OPUS-MT latency (warm) and app memory (PSS) with both models loaded', async () => {
  const t = Date.now();
  await msg({ type: 'mtlocal:translate', modelId: EN, text: 'The meeting has been postponed until Friday.' });
  const warm = Date.now() - t;
  const m = Math.round(mem());
  return `warm sentence ${warm} ms, app + WebView renderer PSS ${m} MB (before the models: ${Math.round(baseMem)} MB)`;
});
await step('UI thread stays responsive while the model translates (real WebView)', async () => {
  const r = await ev(`(async () => {
    let last = performance.now(), maxGap = 0;
    const t = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 60);
    const text = ${JSON.stringify(Array(6).fill('The weather is nice today and we are going to the market.').join(' '))};
    const t0 = performance.now();
    await chrome.runtime.sendMessage({ type: 'mtlocal:translate', modelId: ${JSON.stringify(EN)}, text });
    clearInterval(t);
    return { maxGap: Math.round(maxGap), ms: Math.round(performance.now() - t0) };
  })()`);
  assert(r.maxGap < 500, JSON.stringify(r));
  return `max event-loop gap ${r.maxGap} ms during ${r.ms} ms of translation`;
});
await step('OPUS-MT: SHA-256 verification of the downloaded files passes in the real WebView', async () => assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'ok', 'verify'));
await step('OPUS-MT: cancel a download halfway → nothing left behind → can be downloaded again', async () => {
  await msg({ type: 'mtlocal:remove', modelId: VI });
  await msg({ type: 'mtlocal:start', modelId: VI });
  await sleep(1500);
  const st = await msg({ type: 'mtlocal:cancel', modelId: VI });
  assert(st.state === 'idle', JSON.stringify(st));
  assert((await msg({ type: 'mtlocal:cached', modelId: VI })) === false, 'partial counted as downloaded');
  await download(VI);
  assert((await msg({ type: 'mtlocal:verify', modelId: VI })) === 'ok', 'verify after restart');
});
await step('OPUS-MT: a damaged file is detected and the model is removed (re-download required)', async () => {
  await ev(`(async () => { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes('opus-mt-en-vi') && r.url.includes('encoder_model_quantized')) { const n = (await (await c.match(r)).blob()).size; await c.put(r, new Response(new Uint8Array(n).fill(7))); } })()`);
  assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'corrupt', 'corruption not detected');
  await msg({ type: 'mtlocal:release' });
  let err = '';
  try { await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Hello there.' }); } catch (e) { err = e.message; }
  assert(/hỏng|tải lại/.test(err), err);
  assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === false, 'still cached');
  await download(EN);
  assert((await msg({ type: 'mtlocal:verify', modelId: EN })) === 'ok', 'repair');
});
await step('OPUS-MT survives the app going to the background and coming back', async () => {
  adb('shell', 'input keyevent KEYCODE_HOME');
  await sleep(3000);
  adb('shell', 'am start -n app.mangalingo/.MainActivity');
  await sleep(2500);
  const out = await msg({ type: 'mtlocal:translate', modelId: EN, text: 'Good morning.' });
  assert(out.length > 2, 'no output after resume');
  assert((await msg({ type: 'mtlocal:cached', modelId: EN })) === true, 'cache lost');
  return out;
});
await step('model files persist across an app restart (Cache storage), no re-download', async () => {
  adb('shell', 'am force-stop app.mangalingo');
  await sleep(1000);
  adb('shell', 'am start -n app.mangalingo/.MainActivity');
  await sleep(5000);
  const newPid = adb('shell', 'pidof app.mangalingo').trim();
  const s2 = adb('shell', 'cat /proc/net/unix').split('\n').map((l) => l.match(/@(webview_devtools_remote_(\d+))/)).filter(Boolean).find((m) => m[2] === newPid);
  adb('forward', 'tcp:9333', `localabstract:${s2[1]}`);
  const l2 = await (await fetch('http://127.0.0.1:9333/json')).json();
  ws.close();
  const w2 = new WebSocket(l2.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (w2.onopen = r));
  const ask = (expression) => new Promise((res) => { w2.onmessage = (e) => res(JSON.parse(e.data)); w2.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
  const r = await ask(`chrome.runtime.sendMessage({ type: 'mtlocal:cached', modelId: ${JSON.stringify(EN)} })`);
  assert(r.result.result.value?.data === true, 'model not cached after restart: ' + JSON.stringify(r.result.result.value));
  w2.close();
});

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} steps passed`);
process.exit(bad.length ? 1 : 0);
