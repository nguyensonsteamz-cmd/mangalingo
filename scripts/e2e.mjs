/**
 * End-to-end test: loads dist/ into a real Chrome via CDP (Extensions.loadUnpacked), drives the
 * fixture pages with real mouse/keyboard input and checks the in-page UI, OCR, storage, side
 * panel and settings. Writes test-results/e2e.json and prints a PASS/FAIL table.
 *   node scripts/e2e.mjs [--headed]
 */
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { attach, launch, sleep, waitFor } from './cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const fixtures = join(root, 'tests/e2e/fixtures');
const outDir = join(root, 'test-results');
const headed = process.argv.includes('--headed');
if (!existsSync(join(dist, 'manifest.json'))) throw new Error('Build first: npm run build');
await mkdir(outDir, { recursive: true });

// ---------------------------------------------------------------- fixture servers
let bubblePng = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' };
function serve(port, role) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.endsWith('bubble.png')) {
      if (url.pathname.startsWith('/protected/') && !req.headers.referer) {
        res.writeHead(403).end('hotlink protection');
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(bubblePng);
      return;
    }
    const file = join(fixtures, url.pathname === '/' ? 'reader.html' : url.pathname.slice(1));
    if (role !== 'pages' || !file.startsWith(fixtures) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
const PORT = 47810 + Math.floor(Math.random() * 500) * 2;
const servers = [await serve(PORT, 'pages'), await serve(PORT + 1, 'images')];
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- harness
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - t0, note: typeof note === 'string' ? note : undefined });
    console.log(`  PASS  ${name}${typeof note === 'string' ? ` – ${note}` : ''}`);
  } catch (e) {
    results.push({ name, status: 'FAIL', ms: Date.now() - t0, error: e.message });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
/** ML_SHOTS=1 → screenshots of the real UI (popups, sidebar, settings) in test-results/ui-*.png. */
const snap = async (p, name) => {
  if (!process.env.ML_SHOTS) return;
  await sleep(350); // let the entrance animation finish
  const shot = await p.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(outDir, `ui-${name}.png`), Buffer.from(shot.data, 'base64'));
};
/** Screenshot the open popup again with another popup material (applied live, then restored). */
const snapMaterial = async (sw, p, name, material) => {
  if (!process.env.ML_SHOTS) return;
  const set = (m) => sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.popup = { ...(s.popup ?? {}), material: '${m}' }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
  await set(material);
  await sleep(500);
  await snap(p, name);
  await set('glass');
  await sleep(300);
};

const browser = await launch({ headless: !headed });
const external = new Set();
const consoleErrors = [];

try {
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: dist });
  console.log(`Loaded extension ${extId}`);

  // Render the speech-bubble fixture to a PNG with Chrome itself (real font rasterisation).
  {
    const { targetId } = await browser.send('Target.createTarget', { url: `${BASE}/bubble.html` });
    const p = await attach(browser, targetId);
    await p.send('Page.enable');
    await sleep(800);
    const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 760, height: 560, scale: 1 } });
    bubblePng = Buffer.from(shot.data, 'base64');
    await writeFile(join(outDir, 'bubble.png'), bubblePng);
    await browser.send('Target.closeTarget', { targetId });
  }

  const targets = async () => (await browser.send('Target.getTargets')).targetInfos;
  let sw;
  await step('Extension installs and its MV3 service worker starts', async () => {
    const t = await waitFor(async () => (await targets()).find((x) => x.type === 'service_worker' && x.url.startsWith(`chrome-extension://${extId}/`)), { label: 'service worker' });
    sw = await attach(browser, t.targetId);
    await sw.send('Runtime.enable');
    await sw.send('Network.enable');
    browser.on((m) => {
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        if (!/^(chrome-extension:|data:|blob:|http:\/\/127\.0\.0\.1)/.test(u)) external.add(u);
      }
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    });
    return `id ${extId}`;
  });

  await step('Off by default: nothing is attached to a page until LingoLens is switched on for its site', async () => {
    const { targetId: probeId } = await browser.send('Target.createTarget', { url: `${BASE}/reader.html` });
    const probe = await attach(browser, probeId);
    await probe.send('Runtime.enable');
    await sleep(1500);
    const attached = await probe.evaluateMain(`!!document.querySelector('mangalingo-root')`);
    const sites = await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => r['settings:v1']?.general?.sites ?? 'default []')`);
    await browser.send('Target.closeTarget', { targetId: probeId });
    assert(!attached, 'LingoLens must not attach anything to a site the user has not switched it on for');
    // Switch it on for the local fixture site (what the toolbar popup does).
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.general = { enabled: true, sites: ['127.0.0.1'] }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    return `default sites: ${JSON.stringify(sites)}; nothing attached; switched on for 127.0.0.1`;
  });

  // ------------------------------------------------------------ reader page
  const { targetId: readerId } = await browser.send('Target.createTarget', { url: `${BASE}/reader.html` });
  const page = await attach(browser, readerId, { world: 'LingoLens' });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.bringToFront');
  page.send('Page.javascriptDialogOpening').catch(() => {});
  const shadowQ = (sel) => `globalThis.__mangalingo?.shadow?.querySelector(${JSON.stringify(sel)})`;
  const SHADOW = 'globalThis.__mangalingo.shadow';
  /** Real (trusted) mouse click on an element inside our shadow root. */
  const clickIn = async (sel) => {
    const r = await page.evaluate(`(() => { const b = ${shadowQ(sel)}.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await click(r.x, r.y);
  };
  const popupText = () => page.evaluate(`${shadowQ('[data-ml-popup]')}?.innerText ?? null`);
  const mouse = async (type, x, y, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y, clickCount = 1) => {
    await mouse('mouseMoved', x, y, { button: 'none' });
    await mouse('mousePressed', x, y, { clickCount });
    await mouse('mouseReleased', x, y, { clickCount });
  };
  const drag = async (a, b) => {
    await mouse('mouseMoved', a.x, a.y, { button: 'none' });
    await mouse('mousePressed', a.x, a.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, { buttons: 1 });
    await mouse('mouseReleased', b.x, b.y);
  };
  const key = (k) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
  /** Centre of the n-th occurrence of `word` inside element #id. */
  const wordPos = (id, word, which = 'center') =>
    page.evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(${JSON.stringify(word)});
        if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length});
          const b = r.getBoundingClientRect();
          return { x: ${which === 'start' ? 'b.left + 1' : which === 'end' ? 'b.right - 1' : 'b.left + b.width / 2'}, y: b.top + b.height / 2, rect: { left: b.left, top: b.top, width: b.width, height: b.height } };
        }
      }
      return null; })()`);
  const closePopup = async () => {
    await key('Escape');
    await waitFor(async () => (await popupText()) === null, { label: 'popup closed', timeout: 3000 });
  };

  await step('Content script mounts a closed Shadow DOM host that page scripts cannot read', async () => {
    await waitFor(() => page.evaluate(`!!globalThis.__mangalingo?.shadow`), { label: 'host' });
    const fromPage = await page.evaluateMain(`({ host: !!document.querySelector('mangalingo-root'), shadow: document.querySelector('mangalingo-root')?.shadowRoot ?? null, leak: typeof globalThis.__mangalingo })`);
    assert(fromPage.host && fromPage.shadow === null && fromPage.leak === 'undefined', `page world can see extension UI: ${JSON.stringify(fromPage)}`);
  });

  await step('Click a word → floating popup with dictionary data (Word mode)', async () => {
    const p = await wordPos('p1', 'destroyed');
    const before = await page.evaluate('window.scrollY');
    await click(p.x, p.y);
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'popup content' });
    assert(/destroy/i.test(text), 'popup should show lemma "destroy"');
    assert(text.includes('phá hủy'), 'popup should show Vietnamese meaning "phá hủy"');
    assert(/quá khứ|past|biến đổi/i.test(text) || text.includes('destroyed'), 'popup should mention inflection');
    const after = await page.evaluate('window.scrollY');
    assert(before === after, `scroll position changed (${before} → ${after})`);
    const pr = await page.evaluate(`(() => { const r = ${shadowQ('[data-ml-popup]')}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    const a = p.rect;
    const overlap = pr.left < a.left + a.width && a.left < pr.left + pr.width && pr.top < a.top + a.height && a.top < pr.top + pr.height;
    assert(!overlap, 'popup must not cover the clicked word');
    await snap(page, 'popup-word');
    await snapMaterial(sw, page, 'popup-word-clear', 'clear');
    return 'destroyed → destroy (phá hủy), popup below/above word, scroll unchanged';
  });

  await step('Popup UI is isolated from hostile page CSS', async () => {
    const st = await page.evaluate(`(() => { const el = ${shadowQ('[data-ml-popup]')}; const cs = getComputedStyle(el); return { fs: cs.fontSize, color: cs.color, tt: cs.textTransform, ls: cs.letterSpacing }; })()`);
    assert(st.fs === '14px', `font-size leaked: ${st.fs}`);
    assert(!/255, 105, 180/.test(st.color), `colour leaked: ${st.color}`);
    assert(st.tt === 'none', `text-transform leaked: ${st.tt}`);
    return JSON.stringify(st);
  });

  await step('Escape closes the popup', async () => {
    await closePopup();
  });

  await step('Word split across inline elements (<b>Wha</b>tever) is read as one word', async () => {
    const p = await wordPos('p2', 'tever', 'start');
    await click(p.x + 2, p.y);
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'popup' });
    assert(/whatever/i.test(text), `expected "whatever", got: ${text.slice(0, 80)}`);
    await closePopup();
  });

  await step('Clicking empty space, a link or an input does not open the popup', async () => {
    const r = await page.evaluate(`(() => { const b = document.getElementById('p1').getBoundingClientRect(); return { x: b.right + 120, y: b.top + 8 }; })()`);
    await click(r.x, r.y);
    const l = await page.evaluate(`(() => { const b = document.getElementById('link').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; })()`);
    await click(l.x, l.y);
    const f = await page.evaluate(`(() => { const b = document.getElementById('field').getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; })()`);
    await click(f.x, f.y);
    await sleep(600);
    assert((await popupText()) === null, 'popup opened unexpectedly');
    await page.evaluate(`document.activeElement.blur()`);
  });

  await step('Select a sentence → Sentence mode (no word-by-word gloss) + grammar (passive)', async () => {
    const a = await wordPos('p1', 'The', 'start');
    const b = await wordPos('p1', 'demon.', 'end');
    await drag({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && /Câu/.test(t) && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'sentence popup' });
    assert(!text.includes('bị/được phá hủy'), 'the word-by-word gloss must not be shown');
    const tabs = await page.evaluate(`[...${shadowQ('[data-ml-popup]')}.querySelectorAll('[role=tab]')].map(t => t.textContent)`);
    assert(tabs.some((t) => t.startsWith('Ngữ pháp')), 'sentence popup must have a grammar tab');
    await page.evaluate(`[...${shadowQ('[data-ml-popup]')}.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith('Ngữ pháp')).click()`);
    const g = await waitFor(async () => ((await popupText()) ?? '').includes('Bị động') && (await popupText()), { label: 'grammar tab' });
    assert(g.includes('Quá khứ đơn'), 'grammar should detect past simple');
    await snap(page, 'popup-sentence');
    await closePopup();
    return 'passive + past simple';
  });

  await step('Select a phrase → Phrase mode ("piece of cake")', async () => {
    const a = await wordPos('p3', 'piece', 'start');
    const b = await wordPos('p3', 'cake', 'end');
    await drag({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'phrase popup' });
    assert(text.includes('dễ như ăn bánh'), `phrase meaning missing: ${text.slice(0, 120)}`);
    assert(text.includes('Cụm từ'), 'should be labelled as phrase mode');
    await closePopup();
  });

  await step('Triple-click a paragraph → Paragraph mode (2 sentences)', async () => {
    const a = await wordPos('p3', 'were');
    await click(a.x, a.y, 1);
    await mouse('mousePressed', a.x, a.y, { clickCount: 2 });
    await mouse('mouseReleased', a.x, a.y, { clickCount: 2 });
    await mouse('mousePressed', a.x, a.y, { clickCount: 3 });
    await mouse('mouseReleased', a.x, a.y, { clickCount: 3 });
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && /Đoạn văn/.test(t) ? t : null;
    }, { label: 'paragraph popup' });
    assert(/2 câu/.test(text), 'should detect 2 sentences');
    await closePopup();
  });

  await step('Non-English text is detected and not translated', async () => {
    const a = await wordPos('p4', 'Xin', 'start');
    const b = await wordPos('p4', 'Anh.', 'end');
    await drag({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && /Ngôn ngữ/.test(t) ? t : null;
    }, { label: 'unsupported popup' });
    assert(text.includes('Tiếng Việt'), 'should say Vietnamese was detected');
    await closePopup();
  });

  await step('Save Word stores the entry in chrome.storage.local', async () => {
    const p = await wordPos('p1', 'dream');
    await click(p.x, p.y);
    await waitFor(async () => ((await popupText()) ?? '').includes('giấc mơ'), { label: 'dream popup' });
    await page.evaluate(`${shadowQ('[data-ml-popup] [aria-label="Lưu từ"]')}.click()`);
    const entry = await waitFor(async () => {
      const v = await sw.evaluate(`chrome.storage.local.get('vocab:v1').then(r => Object.values(r['vocab:v1'] ?? {}).find(e => e.lemma === 'dream') ?? null)`);
      return v;
    }, { label: 'vocab entry' });
    assert(entry.sentence?.includes('I gave up on my dream'), 'original sentence should be saved');
    assert(entry.sourceUrl === `${BASE}/reader.html`, `source url: ${entry.sourceUrl}`);
    assert(entry.meaning.includes('giấc mơ'), 'meaning saved');
    await closePopup();
    return `saved {word:"${entry.word}", meaning:"${entry.meaning}", status:"${entry.status}"}`;
  });

  await step('"Open Sidebar" button in the popup opens the Chrome side panel (real user gesture)', async () => {
    const p = await wordPos('p1', 'village');
    await click(p.x, p.y);
    await waitFor(async () => ((await popupText()) ?? '').includes('ngôi làng'), { label: 'popup' });
    const b = await page.evaluate(`(() => { const r = ${shadowQ('[aria-label="Mở Sidebar"]')}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(b.x, b.y);
    const panelTarget = await waitFor(async () => (await targets()).find((t) => t.url === `chrome-extension://${extId}/sidepanel/index.html`), { label: 'side panel target', timeout: 8000 });
    const sp = await attach(browser, panelTarget.targetId);
    const text = await waitFor(async () => {
      const t = await sp.evaluate('document.body.innerText');
      return t.includes('ngôi làng') ? t : null;
    }, { label: 'side panel shows the popup content', timeout: 8000 });
    await closePopup().catch(() => {});
    return `side panel opened (type ${panelTarget.type}) with the looked-up word`;
  });

  await step('Settings apply live without reload (click-to-lookup off → no popup)', async () => {
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.reading = { ...(s.reading ?? {}), clickLookup: false }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    await sleep(300);
    const p = await wordPos('p1', 'village');
    await click(p.x, p.y);
    await sleep(700);
    assert((await popupText()) === null, 'popup opened although click lookup is disabled');
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.reading.clickLookup = true; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    await sleep(300);
    await click(p.x, p.y);
    await waitFor(async () => ((await popupText()) ?? '').includes('ngôi làng'), { label: 'popup after re-enable' });
    await closePopup();
  });

  await step('Toolbar popup + per-site switch: "ON" badge only on enabled sites; switching the site off detaches everything', async () => {
    const manifest = await sw.evaluate('chrome.runtime.getManifest().action.default_popup');
    assert(manifest === 'action/index.html', `toolbar icon should open the popup, got ${manifest}`);
    const { targetId: actId } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/action/index.html` });
    const act = await attach(browser, actId);
    await act.send('Runtime.enable');
    await waitFor(() => act.evaluate(`!!document.querySelector('[role=switch][aria-label="Bật LingoLens trên trang này"]')`), { label: 'per-site switch in the toolbar popup' });
    if (process.env.ML_SHOTS) await act.send('Emulation.setDeviceMetricsOverride', { width: 324, height: 330, deviceScaleFactor: 2, mobile: false });
    await snap(act, 'toolbar-popup');
    await browser.send('Target.closeTarget', { targetId: actId });
    await browser.send('Target.activateTarget', { targetId: readerId });
    const tabId = (await sw.evaluate(`chrome.tabs.query({ url: '${BASE}/reader.html' }).then(t => t[0].id)`));
    await waitFor(() => sw.evaluate(`chrome.action.getBadgeText({ tabId: ${tabId} }).then(t => t === 'ON')`), { label: 'ON badge on the enabled site' });
    // switch the site off (what the popup switch does)
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.general.sites = []; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    await waitFor(() => sw.evaluate(`chrome.action.getBadgeText({ tabId: ${tabId} }).then(t => t === '')`), { label: 'badge cleared' });
    await waitFor(() => page.evaluateMain(`!document.querySelector('mangalingo-root')`), { label: 'UI host detached from the page' });
    const p = await wordPos('p1', 'village');
    await click(p.x, p.y);
    await sleep(700);
    assert((await popupText()) === null, 'popup opened although LingoLens is off for this site');
    // switch it on again → works immediately, no reload
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.general.sites = ['127.0.0.1']; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    await waitFor(() => sw.evaluate(`chrome.action.getBadgeText({ tabId: ${tabId} }).then(t => t === 'ON')`), { label: 'ON badge again' });
    await sleep(300);
    await click(p.x, p.y);
    await waitFor(async () => ((await popupText()) ?? '').includes('ngôi làng'), { label: 'popup after switching on' });
    await closePopup();
    return 'popup switch present; ON badge ↔ off (host detached, no popup) ↔ on again';
  });

  await step('Lookup works with the network offline', async () => {
    await sw.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const p = await wordPos('p2', 'shouted');
    await click(p.x, p.y);
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'offline popup' });
    assert(/shout/i.test(text) && text.includes('la hét'), 'offline lookup failed');
    await sw.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await closePopup();
  });

  // ------------------------------------------------------------ manga page / OCR
  await page.send('Page.navigate', { url: `${BASE}/manga.html` });
  await waitFor(() => page.evaluate(`document.getElementById('cross').complete && document.getElementById('cross').naturalWidth > 0 && !!document.querySelector('mangalingo-root')`), { label: 'manga page' });
  const imgCenter = (id) => page.evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, left: b.left, w: b.width, h: b.height }; })()`);
  const ocrBoxes = () => page.evaluate(`[...globalThis.__mangalingo.shadow.querySelectorAll('[data-ml-ocr-box]')].map(b => b.title)`);
  const chip = () => page.evaluate(`(() => { const c = ${shadowQ('[data-ml-ocr-chip]')}; return c ? { acq: c.dataset.acquisition, cache: c.dataset.cache, text: c.innerText } : null; })()`);

  await step('Security: a scripted (untrusted) click on the scan button does not start OCR', async () => {
    const c = await imgCenter('cross');
    await mouse('mouseMoved', c.x, c.y, { button: 'none' });
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-hover] button')}`), { label: 'hover scan button' });
    await page.evaluate(`${shadowQ('[data-ml-hover] button')}.click()`);
    await sleep(1200);
    const started = await page.evaluate(`!!${shadowQ('[data-ml-ocr-status]')} || !!${shadowQ('[data-ml-ocr-chip]')}`);
    assert(!started, 'OCR started from a synthetic click');
  });

  let ocrText = '';
  await step('OCR: hover a manga image → scan button → text + bounding boxes (local Tesseract)', async () => {
    const c = await imgCenter('cross');
    await mouse('mouseMoved', c.x, c.y, { button: 'none' });
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-hover] button')}`), { label: 'hover scan button' });
    await clickIn('[data-ml-hover] button');
    const sawProgress = await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-ocr-status]')} || !!${shadowQ('[data-ml-ocr-chip]')}`), { label: 'progress', timeout: 10000 });
    void sawProgress;
    const boxes = await waitFor(async () => {
      const b = await ocrBoxes();
      const err = await page.evaluate(`${shadowQ('[data-ml-ocr-status]')}?.innerText ?? ''`);
      if (/lỗi/i.test(err)) throw new Error(err);
      return b.length ? b : null;
    }, { label: 'OCR boxes', timeout: 90000, interval: 500 });
    ocrText = boxes.join(' | ').replace(/\n\(tin cậy.*?\)[^|]*/g, '');
    const words = ['GONNA', 'STRONGEST', 'NINJA', 'HELL', 'GOING', 'HERE'];
    const hits = words.filter((w) => ocrText.toUpperCase().includes(w));
    assert(hits.length >= 4, `OCR recognised too little: ${ocrText}`);
    const ch = await chip();
    assert(ch?.acq === 'image-fetch', `expected full image fetch, got ${ch?.acq}`);
    return `${boxes.length} blocks, ${hits.length}/${words.length} key words; text: ${ocrText.replace(/\s+/g, ' ').slice(0, 120)}`;
  });

  await step('OCR bubble popup: beside the bubble, light colours, per-word IPA + meaning, orange boxes', async () => {
    const boxInfo = await page.evaluate(`(() => { const b = ${shadowQ('[data-ml-ocr-box]')}; const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, border: getComputedStyle(b).borderTopColor }; })()`);
    assert(boxInfo.border.includes('249, 115, 22'), `box colour should default to orange, got ${boxInfo.border}`);
    await page.evaluate(`${shadowQ('[data-ml-ocr-box]')}.click()`);
    await waitFor(async () => ((await popupText()) ?? '').includes('Văn bản OCR'), { label: 'ocr popup' });
    const info = await waitFor(
      () =>
        page.evaluate(`(() => { const d = ${shadowQ('[data-ml-popup]')}; const rows = [...d.querySelectorAll('[data-ml-ocr-word]')]; const ipa = d.querySelectorAll('[data-ml-ipa]').length; const mt = d.querySelector('[data-ml-mt]'); if (!rows.length || !ipa || !(mt || d.querySelector('[data-ml-ocr-gloss]')) || !rows.some(x => /strongest|ninja/i.test(x.innerText) && x.innerText.includes('/'))) return null; const r = d.getBoundingClientRect(); return { theme: d.dataset.theme, placement: d.dataset.placement, l: r.left, r: r.right, bg: getComputedStyle(d).backgroundColor, ipa, rows: rows.map(x => x.innerText.split(String.fromCharCode(10)).join(' ')), noBadges: !/tin cậy \d+%/.test(d.innerText) && ![...d.querySelectorAll('span')].some(x => x.textContent === 'OCR'), cards: !!d.querySelector('[data-ml-ocr-original].ml-card') && rows.every(x => x.classList.contains('ml-card')) }; })()`),
      { label: 'word list with IPA' },
    );
    // Liquid Glass: white tint with transparency (opaque when the glass effect is off)
    assert(info.theme === 'light' && /^rgba?\(255, 255, 255/.test(info.bg), `light popup expected: ${info.theme} ${info.bg}`);
    assert(info.noBadges, 'OCR / confidence badges should be gone');
    assert(info.cards, 'original text and word rows should be cards');
    assert(['right', 'left'].includes(info.placement), `popup should sit beside the bubble, got ${info.placement}`);
    assert(info.l >= boxInfo.r || info.r <= boxInfo.l, 'popup must not cover the bubble');
    assert(info.rows.some((r) => /strongest|ninja/i.test(r) && r.includes('/')), `word rows with IPA expected: ${info.rows.join(' / ')}`);
    await snap(page, 'popup-ocr');
    await snapMaterial(sw, page, 'popup-ocr-clear', 'clear');
    await closePopup();
    return `${info.placement}, ${info.rows.slice(0, 3).join(' · ')}`;
  });

  await step('OCR result: click a box → OCR view → click a word → dictionary lookup', async () => {
    await page.evaluate(`${shadowQ('[data-ml-ocr-box]')}.click()`);
    await waitFor(async () => ((await popupText()) ?? '').includes('Văn bản OCR'), { label: 'ocr popup' });
    const clicked = await page.evaluate(`(() => { const spans = [...${shadowQ('[data-ml-popup]')}.querySelectorAll('span[role=button]')]; const s = spans.find(x => /NINJA|STRONGEST|HELL|GOING/i.test(x.textContent)); if (!s) return null; s.click(); return s.textContent; })()`);
    assert(clicked, 'no clickable OCR word found');
    const text = await waitFor(async () => {
      const t = await popupText();
      return t && !t.includes('Văn bản OCR') && !t.includes('Đang tra cứu') ? t : null;
    }, { label: 'lookup from OCR word' });
    assert(new RegExp(clicked.replace(/[^A-Za-z]/g, ''), 'i').test(text), 'lookup popup should show the clicked word');
    assert(text.includes('Quay lại') || (await page.evaluate(`!!${shadowQ('[aria-label="Quay lại"]')}`)), 'back navigation expected');
    await closePopup();
    return `clicked "${clicked}"`;
  });

  await step('OCR result can be edited by the user', async () => {
    await page.evaluate(`${shadowQ('[data-ml-ocr-box]')}.click()`);
    await waitFor(async () => ((await popupText()) ?? '').includes('Văn bản OCR'), { label: 'ocr popup' });
    await page.evaluate(`[...${shadowQ('[data-ml-popup]')}.querySelectorAll('button')].find(b => b.textContent.includes('Sửa')).click()`);
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-popup] textarea')}`), { label: 'textarea' });
    await page.evaluate(`(() => { const ta = ${shadowQ('[data-ml-popup] textarea')}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, "I'm gonna become the strongest ninja!"); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.evaluate(`[...${shadowQ('[data-ml-popup]')}.querySelectorAll('button')].find(b => b.textContent.includes('Lưu chỉnh sửa')).click()`);
    const t = await waitFor(async () => ((await popupText()) ?? '').includes('đã sửa') && (await popupText()), { label: 'edited badge' });
    assert(t.includes("I'm gonna become the strongest ninja!"), 'edited text shown');
    await closePopup();
  });

  await step('OCR cache: rescanning the same image is served from cache', async () => {
    const c = await imgCenter('cross');
    await mouse('mouseMoved', c.x + 5, c.y + 5, { button: 'none' });
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-hover] button')}`), { label: 'hover button' });
    await clickIn('[data-ml-hover] button');
    const ch = await waitFor(async () => {
      const x = await chip();
      return x?.cache === '1' ? x : null;
    }, { label: 'cached result', timeout: 15000 });
    return `cache=${ch.cache}, ${ch.acq}`;
  });

  await step('Drag a bubble border (real mouse) → only that area is read again and replaces the bubble', async () => {
    if ((await popupText()) !== null) await closePopup(); // (Esc without a popup would clear the boxes)
    const boxInfo = () =>
      page.evaluate(`(() => { const w = [...globalThis.__mangalingo.shadow.querySelectorAll('[data-ml-ocr-box-wrap]')].find(x => /GONNA|STRONGEST|NINJA/i.test(x.querySelector('[data-ml-ocr-box]').title)); if (!w) return null; const r = w.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, title: w.querySelector('[data-ml-ocr-box]').title.split(String.fromCharCode(10))[0] }; })()`);
    const b0 = await waitFor(boxInfo, { label: 'bubble box' });
    const dragHandle = async (fromX, fromY, toX, toY) => {
      await mouse('mouseMoved', b0.l + b0.w / 2, b0.t + b0.h / 2, { button: 'none' }); // hover shows the handles
      await sleep(150);
      await mouse('mouseMoved', fromX, fromY, { button: 'none' });
      await mouse('mousePressed', fromX, fromY);
      for (let i = 1; i <= 6; i++) await mouse('mouseMoved', fromX + ((toX - fromX) * i) / 6, fromY + ((toY - fromY) * i) / 6, { buttons: 1 });
      await mouse('mouseReleased', toX, toY);
    };
    // 1) drag the top edge down so only the last line stays inside → the bubble text shrinks
    await dragHandle(b0.l + b0.w / 2, b0.t, b0.l + b0.w / 2, b0.t + b0.h * 0.68);
    const small = await waitFor(async () => {
      const b = await boxInfo();
      return b && b.h < b0.h * 0.6 && !/GONNA/i.test(b.title) && /STRONGEST|NINJA/i.test(b.title) ? b : null;
    }, { label: 'rescan of the smaller area', timeout: 30000, interval: 300 });
    // 2) drag it back out so it covers the whole bubble again → the missed words come back
    if ((await popupText()) !== null) await closePopup();
    const b1 = await boxInfo();
    await dragHandle(b1.l + b1.w / 2, b1.t, b1.l + b1.w / 2, b0.t - 6);
    const big = await waitFor(async () => {
      const b = await boxInfo();
      return b && /GONNA/i.test(b.title) && /STRONGEST/i.test(b.title) ? b : null;
    }, { label: 'rescan of the enlarged area', timeout: 30000, interval: 300 });
    const popup = await waitFor(async () => ((await popupText()) ?? '').includes('GONNA') && 'popup updated', { label: 'popup shows the new text' });
    await closePopup();
    return `"${b0.title}" → shrink → "${small.title}" → enlarge → "${big.title}" (${popup})`;
  });

  await step('OCR fallback: hotlink-protected image is captured from the visible tab', async () => {
    await page.evaluate(`document.getElementById('protected').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    const before = await page.evaluate(`globalThis.__mangalingo.shadow.querySelectorAll('[data-ml-ocr-chip]').length`);
    assert(before === 1, 'previous scan result expected before rescanning another image');
    const c = await imgCenter('protected');
    await mouse('mouseMoved', c.x, c.y, { button: 'none' });
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-hover] button')}`), { label: 'hover button' });
    await clickIn('[data-ml-hover] button');
    const ch = await waitFor(async () => {
      const err = await page.evaluate(`${shadowQ('[data-ml-ocr-status]')}?.innerText ?? ''`);
      if (/lỗi/i.test(err)) throw new Error(err);
      return chip();
    }, { label: 'capture result', timeout: 90000, interval: 500 });
    assert(ch.acq === 'visible-capture', `expected visible-capture, got ${ch.acq}`);
    const results = await page.evaluate(`globalThis.__mangalingo.shadow.querySelectorAll('[data-ml-ocr-chip]').length`);
    assert(results === 1, `scanning another image must replace the old boxes (found ${results} results)`);
    const boxes = await ocrBoxes();
    const txt = boxes.join(' ').toUpperCase();
    assert(['NINJA', 'HELL', 'STRONGEST', 'GOING'].filter((w) => txt.includes(w)).length >= 3, `capture OCR text: ${txt.slice(0, 150)}`);
    return `${boxes.length} blocks via captureVisibleTab; old image's boxes removed`;
  });

  await step('Esc clears OCR boxes; OCR can be cancelled while running', async () => {
    await key('Escape');
    await waitFor(async () => (await ocrBoxes()).length === 0, { label: 'boxes cleared by Esc' });
    // Region scan of the whole viewport via the context-menu event path.
    const tabs = await sw.evaluate(`chrome.tabs.query({ url: '${BASE}/manga.html' }).then(t => t.map(x => x.id))`);
    await sw.evaluate(`chrome.tabs.sendMessage(${tabs[0]}, { type: 'ctx:scan-region' })`);
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-region]')}`), { label: 'region overlay' });
    // The side panel may be open (narrower viewport) – drag across most of the visible area.
    const vp = await page.evaluate('({ w: innerWidth, h: innerHeight })');
    await drag({ x: 20, y: 20 }, { x: vp.w - 20, y: vp.h - 20 });
    // While running there is no progress card – only the outline + a small chip with a cancel button.
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-ocr-status] button')} && !!${shadowQ('.ml-scan-outline')}`), { label: 'scanning outline + cancel chip', timeout: 5000, interval: 50 });
    const chipW = await page.evaluate(`${shadowQ('[data-ml-ocr-status]')}.getBoundingClientRect().width`);
    assert(chipW < 140, `the running indicator should be a small chip, got ${chipW}px wide`);
    await page.evaluate(`${shadowQ('[data-ml-ocr-status] button')}.click()`);
    const t = await waitFor(async () => {
      const gone = await page.evaluate(`!${shadowQ('[data-ml-ocr-status]')} && !${shadowQ('.ml-scan-outline')}`);
      const toastText = await page.evaluate(`[...globalThis.__mangalingo.shadow.querySelectorAll('[role=status]')].map(x => x.innerText).join(' ')`);
      return gone && /hủy/i.test(toastText) ? toastText : null;
    }, { label: 'cancelled (outline gone + toast)', timeout: 10000 });
    return `${t.replace(/\s+/g, ' ')} · chip ${Math.round(chipW)}px`;
  });

  await step('OCR region selection: recognises the bubble, opens its meaning popup automatically, no result bar', async () => {
    await page.evaluate(`[...globalThis.__mangalingo.shadow.querySelectorAll('[data-ml-ocr-status] button[aria-label]')].forEach(b => b.click())`);
    const c = await imgCenter('protected');
    const tabs = await sw.evaluate(`chrome.tabs.query({ url: '${BASE}/manga.html' }).then(t => t.map(x => x.id))`);
    await sw.evaluate(`chrome.tabs.sendMessage(${tabs[0]}, { type: 'ctx:scan-region' })`);
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-region]')}`), { label: 'region overlay' });
    // bubble 1 occupies x 40..370, y 40..230 inside the image
    await drag({ x: c.left + 30, y: c.top + 30 }, { x: c.left + 380, y: c.top + 240 });
    const boxes = await waitFor(async () => {
      const err = await page.evaluate(`${shadowQ('[data-ml-ocr-status]')}?.innerText ?? ''`);
      if (/lỗi/i.test(err)) throw new Error(err);
      const b = await ocrBoxes();
      return b.some((x) => /NINJA|STRONGEST|GONNA/i.test(x)) ? b : null;
    }, { label: 'region OCR', timeout: 60000, interval: 500 });
    // the meaning popup opens by itself next to the bubble, and the result bar does not cover the text box
    const pop = await waitFor(() => page.evaluate(`(() => { const d = ${shadowQ('[data-ml-popup]')}; return d && d.querySelector('[data-ml-ocr-word]') ? { placement: d.dataset.placement } : null; })()`), { label: 'auto-opened OCR popup' });
    const bar = await page.evaluate(`(() => { const c = ${shadowQ('[data-ml-ocr-chip]')}; return !c.hidden || /vùng chữ ·|Sidebar/.test(globalThis.__mangalingo.shadow.textContent); })()`);
    assert(!bar, 'no visible result bar should be shown over the page');
    // a real click somewhere else on the page closes the popup AND removes the bubble boxes
    await click(8, 8);
    await waitFor(async () => (await ocrBoxes()).length === 0 && (await popupText()) === null, { label: 'boxes removed by outside click' });
    return `${boxes.join(' | ').replace(/\n\(tin cậy[^|]*/g, '').slice(0, 80)} · popup tự mở (${pop.placement}) · click ra ngoài → khung biến mất`;
  });

  await step('Full-page scan → bubbles listed in the sidebar; the side panel is enabled only for that tab', async () => {
    // The hover-button scans above opened the panel for the manga tab and pushed the bubble list.
    const payload = await sw.evaluate(`chrome.storage.session.get('sidebar:current').then(r => r['sidebar:current'])`);
    assert(payload?.type === 'ocr' && payload.result?.blocks?.length >= 1, `sidebar should hold the OCR bubbles, got ${JSON.stringify(payload)?.slice(0, 120)}`);
    const tabs = await sw.evaluate(`chrome.tabs.query({ url: '${BASE}/manga.html' }).then(t => t.map(x => x.id))`);
    const here = await sw.evaluate(`chrome.sidePanel.getOptions({ tabId: ${tabs[0]} })`);
    const global = await sw.evaluate(`chrome.sidePanel.getOptions({})`);
    assert(here.enabled === true, `panel should be enabled for the manga tab: ${JSON.stringify(here)}`);
    assert(global.enabled === false, `panel must be disabled by default for other tabs: ${JSON.stringify(global)}`);
    return `${payload.result.blocks.length} bubbles in sidebar; manga tab enabled, others disabled`;
  });

  // ------------------------------------------------------------ side panel & settings pages
  const { targetId: panelId } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel/index.html` });
  const panel = await attach(browser, panelId);
  await panel.send('Runtime.enable');
  await step('Sidebar page renders and receives pushed content from the background', async () => {
    await waitFor(() => panel.evaluate(`document.body.innerText.includes('LingoLens')`), { label: 'panel render' });
    // Deliver the same payload the in-page "Open Sidebar" button sends (sidebar:push → background → panel).
    await panel.evaluate(`chrome.runtime.sendMessage({ type: 'sidebar:push', payload: { type: 'lookup', text: 'I gave up on my dream.' } })`);
    const t = await waitFor(async () => {
      const x = await panel.evaluate('document.body.innerText');
      return x.includes('I gave up on my dream.') ? x : null;
    }, { label: 'panel content', timeout: 10000 });
    assert(/văn bản gốc/i.test(t), 'original text section');
    const stored = await sw.evaluate(`chrome.storage.session.get('sidebar:current').then(r => r['sidebar:current']?.text)`);
    assert(stored === 'I gave up on my dream.', 'payload persisted in storage.session');
  });

  await step('Sidebar tabs: Grammar, Context and Saved Words', async () => {
    const clickTab = (label) => panel.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith(${JSON.stringify(label)})).click()`);
    await clickTab('Ngữ pháp');
    await waitFor(async () => (await panel.evaluate('document.body.innerText')).includes('Quá khứ đơn'), { label: 'grammar tab' });
    await clickTab('Ngữ cảnh');
    await waitFor(async () => (await panel.evaluate('document.body.innerText')).includes('give up'), { label: 'context tab' });
    await clickTab('Đã lưu');
    await waitFor(async () => (await panel.evaluate('document.body.innerText')).includes('dream'), { label: 'saved tab lists saved word' });
    await panel.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Đã thuộc').click()`);
    await waitFor(() => sw.evaluate(`chrome.storage.local.get('vocab:v1').then(r => Object.values(r['vocab:v1']).find(e => e.lemma === 'dream')?.status === 'known')`), { label: 'mark known' });
    await clickTab('Dịch');
  });

  await step('Sidebar input: type a sentence and analyse it', async () => {
    await panel.evaluate(`document.querySelector('textarea').focus()`);
    await panel.send('Input.insertText', { text: "Don't look down on me!" });
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(async () => (await panel.evaluate('document.body.innerText')).includes('coi thường'), { label: 'panel lookup' });
    if (process.env.ML_SHOTS) await panel.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: false });
    await snap(panel, 'sidebar');
  });

  const { targetId: optId } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/options/index.html#appearance` });
  const opt = await attach(browser, optId);
  await opt.send('Page.enable');
  await opt.send('Runtime.enable');
  browser.on((m) => {
    if (m.method === 'Page.javascriptDialogOpening' && m.sessionId === opt.sessionId) void opt.send('Page.handleJavaScriptDialog', { accept: true });
  });
  await step('Settings Center: change theme → persisted → applied to other pages; Reset to Default', async () => {
    await waitFor(() => opt.evaluate(`document.body.innerText.includes('Giao diện')`), { label: 'options render' });
    await opt.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Sáng').click()`);
    await waitFor(() => sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => r['settings:v1']?.appearance?.theme === 'light')`), { label: 'theme saved' });
    await waitFor(() => panel.evaluate(`document.documentElement.dataset.theme === 'light'`), { label: 'side panel switched to light live' });
    await opt.send('Page.reload');
    await waitFor(() => opt.evaluate(`document.documentElement.dataset.theme === 'light'`), { label: 'theme after reload' });
    await opt.evaluate(`location.hash = 'data'`);
    await waitFor(() => opt.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Reset to Default')`), { label: 'data section' });
    await opt.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Reset to Default').click()`);
    await waitFor(() => sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => r['settings:v1']?.appearance?.theme === 'dark')`), { label: 'reset' });
    const stats = await waitFor(() => opt.evaluate(`document.body.innerText.includes('WordNet') && document.body.innerText`), { label: 'dict stats' });
    // Reset to Default also clears the list of enabled sites (LingoLens is off by default) – switch the
    // fixture site back on for the remaining steps.
    const sitesAfterReset = await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => r['settings:v1'].general.sites)`);
    assert(Array.isArray(sitesAfterReset) && sitesAfterReset.length === 0, 'reset should switch LingoLens off everywhere');
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.general.sites = ['127.0.0.1']; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    return 'theme light → persisted → reset to dark (sites cleared)';
  });

  await step('Settings live preview: changing the OCR box colour / popup width updates the preview block at once', async () => {
    await opt.evaluate(`location.hash = 'ocr'; dispatchEvent(new HashChangeEvent('hashchange'))`);
    await waitFor(() => opt.evaluate(`!!document.querySelector('[data-ml-preview-box]') && !!document.querySelector('button[aria-label="#22c55e"]')`), { label: 'OCR settings + preview' });
    await opt.evaluate(`document.querySelector('button[aria-label="#22c55e"]').click()`);
    const box = await waitFor(() => opt.evaluate(`(() => { const c = getComputedStyle(document.querySelector('[data-ml-preview-box]')).borderTopColor; return c.includes('34, 197, 94') ? c : null; })()`), { label: 'preview box colour' });
    await opt.evaluate(`location.hash = 'popup'; dispatchEvent(new HashChangeEvent('hashchange'))`);
    const w0 = await waitFor(() => opt.evaluate(`document.querySelector('[data-ml-preview-popup]')?.style.width || null`), { label: 'popup preview' });
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.popup = { ...(s.popup ?? {}), width: 520 }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    const w1 = await waitFor(() => opt.evaluate(`(() => { const w = document.querySelector('[data-ml-preview-popup]').style.width; return w === '520px' ? w : null; })()`), { label: 'preview width follows setting' });
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.popup.width = 380; s.ocr.boxColor = '#f97316'; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    return `box ${box}; popup ${w0} → ${w1}`;
  });

  await step('Sidebar appearance: own background colour applies to the side panel at once and shows in the preview', async () => {
    await opt.evaluate(`location.hash = 'sidebar'; dispatchEvent(new HashChangeEvent('hashchange'))`);
    await waitFor(() => opt.evaluate(`!!document.querySelector('[data-ml-preview-sidebar]')`), { label: 'sidebar preview' });
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.sidebar = { ...s.sidebar, background: '#fffbeb' }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    const live = await waitFor(() => panel.evaluate(`(() => { const r = document.documentElement; return r.style.getPropertyValue('--ml-bg').trim() === '255 251 235' ? { theme: r.dataset.theme, bg: getComputedStyle(document.body).backgroundColor } : null; })()`), { label: 'side panel recoloured' });
    assert(live.theme === 'light', `a cream background needs dark text (light theme tokens), got ${live.theme}`);
    const pv = await waitFor(() => opt.evaluate(`(() => { const p = document.querySelector('[data-ml-preview-sidebar]'); return p.style.getPropertyValue('--ml-bg').trim() === '255 251 235' ? p.dataset.theme : null; })()`), { label: 'preview recoloured' });
    await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1']; s.sidebar.background = ''; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    return `side panel ${live.bg} (${live.theme}); preview ${pv}`;
  });

  await step('Dictionary import (CSV) adds Vietnamese data that lookups use', async () => {
    const csv = 'word,pos,vi,en\\nshuriken,noun,phi tiêu ninja,a star-shaped throwing weapon\\n';
    const r = await opt.evaluate(`chrome.runtime.sendMessage({ type: 'dict:import', name: 'e2e', format: 'csv', text: '${csv}' })`);
    assert(r.ok && r.data.imported === 1, `import failed: ${JSON.stringify(r)}`);
    const l = await opt.evaluate(`chrome.runtime.sendMessage({ type: 'lookup', req: { text: 'shuriken' } })`);
    assert(l.ok && l.data.found && l.data.senses.some((s) => s.vi?.includes('phi tiêu ninja')), `lookup after import: ${JSON.stringify(l).slice(0, 200)}`);
    await opt.evaluate(`chrome.runtime.sendMessage({ type: 'dict:clear-user' })`);
  });

  await step('No request left the machine (only extension / local fixture URLs)', async () => {
    assert(external.size === 0, `external requests: ${[...external].join(', ')}`);
  });

  // Runs last: it needs Chrome to download the EN→VI model from Google once (opt-in feature).
  await step('Machine translation (default mode): OCR bubble → model download (from the click gesture or the button) → natural Vietnamese (Chrome Translator API)', async () => {
    const avail = await page.evaluate(`typeof Translator === 'undefined' ? 'unsupported' : Translator.availability({ sourceLanguage: 'en', targetLanguage: 'vi' })`);
    assert(avail !== 'unsupported' && avail !== 'unavailable', `Translator API en→vi not available in this Chrome: ${avail}`);
    const mode = await sw.evaluate(`chrome.storage.local.get('settings:v1').then(r => r['settings:v1']?.reading?.translationMode ?? 'default')`);
    assert(mode === 'machine' || mode === 'default', `machine translation should be the default mode, got ${mode}`);
    await sleep(300);
    // Bring the manga tab back to the foreground (the settings/side-panel tabs opened later cover it).
    await browser.send('Target.activateTarget', { targetId: readerId });
    await page.send('Page.bringToFront');
    await sleep(300);
    await page.evaluate(`document.getElementById('protected').scrollIntoView({ block: 'center' })`);
    const c = await imgCenter('protected');
    const tabs = await sw.evaluate(`chrome.tabs.query({ url: '${BASE}/manga.html' }).then(t => t.map(x => x.id))`);
    await sw.evaluate(`chrome.tabs.sendMessage(${tabs[0]}, { type: 'ctx:scan-region' })`);
    await waitFor(() => page.evaluate(`!!${shadowQ('[data-ml-region]')}`), { label: 'region overlay' });
    await drag({ x: c.left + 30, y: c.top + 30 }, { x: c.left + 380, y: c.top + 240 });
    const state = await waitFor(() => page.evaluate(`(() => { const m = ${shadowQ('[data-ml-popup] [data-ml-mt]')}; return m && !['checking', 'translating'].includes(m.dataset.state) ? m.dataset.state : null; })()`), { label: 'machine translation block', timeout: 60000 });
    if (state === 'need-download') await clickIn('[data-ml-mt] button');
    assert(state !== 'off', 'machine translation should be on by default');
    const vi = await waitFor(() => page.evaluate(`${shadowQ('[data-ml-mt-text]')}?.innerText ?? null`), { label: 'translated text', timeout: 180000, interval: 500 }).catch(async (e) => {
      const m = await page.evaluate(`(() => { const m = ${shadowQ('[data-ml-mt]')}; return m ? m.dataset.state + ': ' + m.innerText : 'no block'; })()`);
      throw new Error(`${e.message} – initial state ${state}; block now: ${m}`);
    });
    assert(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(vi), `expected Vietnamese, got: ${vi}`);
    const ui = await page.evaluate(`(() => { const d = ${shadowQ('[data-ml-popup]')}; const vi = d.querySelector('[data-ml-ocr-word-vi]'); return { gloss: !!d.querySelector('[data-ml-ocr-gloss]'), label: d.querySelector('[data-ml-mt]').innerText.split(String.fromCharCode(10))[0], bold: vi ? getComputedStyle(vi).fontWeight : null }; })()`);
    assert(!ui.gloss, 'dictionary gloss is only a fallback when the translation works');
    assert(/^bản dịch$/i.test(ui.label.trim()), `translation label should be just "Bản dịch", got ${ui.label}`);
    assert(Number(ui.bold) >= 700, `word meanings should be bold, got ${ui.bold}`);
    await closePopup();
    return `${state === 'need-download' ? 'model downloaded, ' : ''}"${vi}"`;
  });

  await step('Machine translation everywhere: a single word missing from the EN–VI data ("weather") gets a translated meaning + translated definitions', async () => {
    await page.evaluateMain(`(() => { const p = document.createElement('p'); p.id = 'mtword'; p.style.cssText = 'position:fixed;left:40px;top:40px;font:20px sans-serif;background:#fff;color:#000;padding:6px;z-index:5'; p.textContent = 'Get more relevant search, weather, and map results'; document.body.appendChild(p); })()`);
    await sleep(200);
    const w = await wordPos('mtword', 'weather');
    await click(w.x, w.y);
    const got = await waitFor(
      () => page.evaluate(`(() => { const d = ${shadowQ('[data-ml-popup]')}; const m = d && d.querySelector('[data-ml-word-mt]'); const defs = d ? [...d.querySelectorAll('[data-ml-def-mt]')].map(x => x.innerText) : []; return m && defs.length ? { meaning: m.innerText.split(String.fromCharCode(10)).pop(), defs } : null; })()`),
      { label: 'machine-translated word meaning', timeout: 30000 },
    );
    assert(/thời tiết/i.test(got.meaning), `expected "thời tiết", got ${got.meaning}`);
    await closePopup();
    await page.evaluateMain(`document.getElementById('mtword').remove()`);
    return `weather → ${got.meaning}; def: ${got.defs[0]}`;
  });

  await step('No F5 needed: a tab opened BEFORE the extension was installed starts working as soon as its site is switched on', async () => {
    // A separate Chrome: open the page first, install the extension afterwards (the tab has no content script).
    const b2 = await launch({ headless: !headed });
    try {
      const { targetId: oldTabId } = await b2.send('Target.createTarget', { url: `${BASE}/reader.html` });
      await sleep(1000);
      const { id: id2 } = await b2.send('Extensions.loadUnpacked', { path: dist });
      const swT = await waitFor(async () => (await b2.send('Target.getTargets')).targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(`chrome-extension://${id2}/`)), { label: 'worker' });
      const sw2 = await attach(b2, swT.targetId);
      await sw2.send('Runtime.enable');
      await sleep(500);
      const tab = await attach(b2, oldTabId, { world: 'LingoLens' });
      await tab.send('Runtime.enable');
      const before = await tab.evaluateMain(`!!document.querySelector('mangalingo-root')`);
      // switch the site on (what the toolbar popup does) – the tab itself is NOT reloaded
      await sw2.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.general = { enabled: true, sites: ['127.0.0.1'] }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
      await b2.send('Target.activateTarget', { targetId: oldTabId });
      await waitFor(() => tab.evaluateMain(`!!document.querySelector('mangalingo-root')`), { label: 'content script injected into the already-open tab', timeout: 10000 });
      await sleep(500);
      const pos = await tab.evaluate(`(() => { const el = document.getElementById('p1'); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf('village'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 2); r.setEnd(n, i + 3); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } return null; })()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await tab.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
      const txt = await waitFor(() => tab.evaluate(`(() => { const d = globalThis.__mangalingo?.shadow.querySelector('[data-ml-popup]'); return d && /ngôi làng/.test(d.innerText) ? 'ok' : null; })()`), { label: 'lookup works without F5', timeout: 15000 });
      return `before: script ${before ? 'present' : 'absent'}; switched on → injected, popup ${txt}, tab not reloaded`;
    } finally {
      await b2.close();
    }
  });
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}

const pass = results.filter((r) => r.status === 'PASS').length;
await writeFile(join(outDir, 'e2e.json'), JSON.stringify({ chrome: 'see scripts/cdp.mjs', ranAt: new Date().toISOString(), pass, fail: results.length - pass, results }, null, 2));
console.log(`\nE2E: ${pass}/${results.length} passed`);
if (consoleErrors.length) console.log(`Uncaught exceptions observed:\n  ${consoleErrors.slice(0, 10).join('\n  ')}`);
process.exit(pass === results.length ? 0 : 1);
