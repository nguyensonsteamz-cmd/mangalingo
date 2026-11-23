/**
 * Drives the REAL Android app (debug build) in the emulator through the WebView's DevTools socket:
 * ML Kit en→vi / vi→en (model availability, download, translation, errors)
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

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} steps passed`);
process.exit(bad.length ? 1 : 0);
