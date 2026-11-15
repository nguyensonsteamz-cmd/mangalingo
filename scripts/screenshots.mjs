/** Captures UI screenshots of the built extension into test-results/screens/ for visual review. */
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { attach, launch, sleep, waitFor } from './cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtures = join(root, 'tests/e2e/fixtures');
const out = join(root, 'test-results/screens');
await mkdir(out, { recursive: true });
const png = await readFile(join(root, 'tests/fixtures/bubble.png'));
const handler = async (req, res) => {
  if (req.url.includes('bubble.png')) return res.writeHead(200, { 'content-type': 'image/png' }).end(png);
  const f = join(fixtures, req.url === '/' ? 'reader.html' : req.url.slice(1).split('?')[0]);
  const body = await readFile(f).catch(() => null);
  if (!body) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': extname(f) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }).end(body);
};
const PORT = 48800 + Math.floor(Math.random() * 400) * 2;
// manga.html loads its images from port + 1 (cross-origin), like the e2e test
const servers = await Promise.all([PORT, PORT + 1].map((p) => new Promise((r) => { const s = http.createServer(handler); s.listen(p, '127.0.0.1', () => r(s)); })));
const srv = { close: () => servers.forEach((s) => s.close()) };
const BASE = `http://127.0.0.1:${PORT}`;
const browser = await launch();
try {
  const { id } = await browser.send('Extensions.loadUnpacked', { path: join(root, 'dist') });
  // MangaLingo is off by default: switch it on for the local fixture site first.
  {
    const { targetId: optId } = await browser.send('Target.createTarget', { url: `chrome-extension://${id}/options/index.html` });
    const opt = await attach(browser, optId);
    await new Promise((r) => setTimeout(r, 800));
    await opt.evaluate(`chrome.storage.local.get('settings:v1').then(r => { const s = r['settings:v1'] ?? {}; s.general = { enabled: true, sites: ['127.0.0.1'] }; return chrome.storage.local.set({ 'settings:v1': s }); })`);
    await browser.send('Target.closeTarget', { targetId: optId });
  }
  const open = async (url, w = 1100, h = 760) => {
    const { targetId } = await browser.send('Target.createTarget', { url });
    const p = await attach(browser, targetId, { world: 'MangaLingo' });
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    return p;
  };
  const shot = async (p, name) => {
    const s = await p.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(out, `${name}.png`), Buffer.from(s.data, 'base64'));
  };
  const q = (sel) => `globalThis.__mangalingo?.shadow?.querySelector(${JSON.stringify(sel)})`;
  const click = async (p, x, y, clickCount = 1) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  };
  const wordAt = (p, idSel, word) =>
    p.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => { const el = document.getElementById('${idSel}'); const w = document.createTreeWalker(el, 4); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf('${word}'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, r: b.right }; } } })()`,
    }).then((r) => r.result.value);
  const ready = (p, expr) => waitFor(() => p.evaluate(expr), { timeout: 90000 });

  const page = await open(`${BASE}/reader.html`);
  await ready(page, `!!globalThis.__mangalingo?.shadow`);
  let w = await wordAt(page, 'p1', 'destroyed');
  await click(page, w.x, w.y);
  await ready(page, `${q('[data-ml-popup]')}?.innerText.includes('phá hủy')`);
  await sleep(300);
  await shot(page, '1-popup-word');
  await page.evaluate(`[...${q('[data-ml-popup]')}.querySelectorAll('[role=tab]')][1].click()`);
  await sleep(300);
  await shot(page, '2-popup-word-context');
  const a = await wordAt(page, 'p3', 'If');
  const b = await wordAt(page, 'p3', 'now.');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.l + 1, y: a.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.r - 1, y: b.y, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.r - 1, y: b.y, button: 'left', clickCount: 1 });
  await ready(page, `${q('[data-ml-popup]')}?.innerText.toLowerCase().includes('ghép nghĩa')`);
  await sleep(300);
  await shot(page, '3-popup-sentence');
  await page.evaluate(`[...${q('[data-ml-popup]')}.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith('Ngữ pháp')).click()`);
  await sleep(300);
  await shot(page, '4-popup-grammar');

  await page.send('Page.navigate', { url: `${BASE}/manga.html` });
  await ready(page, `document.getElementById('cross')?.complete && !!globalThis.__mangalingo?.shadow`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 550, y: 300 });
  await ready(page, `!!${q('[data-ml-hover] button')}`);
  await shot(page, '5-ocr-hover');
  {
    const r = await page.evaluate(`(() => { const b = ${q('[data-ml-hover] button')}.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await click(page, r.x, r.y);
  }
  await ready(page, `!!${q('[data-ml-ocr-box]')}`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 700 });
  await sleep(300);
  await shot(page, '6-ocr-boxes');
  await page.evaluate(`${q('[data-ml-ocr-box]')}.click()`);
  await sleep(400);
  await shot(page, '7-ocr-popup');

  const panel = await open(`chrome-extension://${id}/sidepanel/index.html`, 400, 760);
  await ready(panel, `document.body.innerText.includes('MangaLingo')`);
  await panel.evaluate(`chrome.runtime.sendMessage({ type: 'sidebar:push', payload: { type: 'lookup', text: "Are you out of your mind?! I gave up on my dream." } })`);
  await ready(panel, `document.body.innerText.includes('bỏ cuộc')`);
  await sleep(300);
  await shot(panel, '8-sidebar');
  await panel.evaluate(`[...document.querySelectorAll('[role=tab]')][3].click()`);
  await sleep(300);
  await shot(panel, '9-sidebar-context');

  const opt = await open(`chrome-extension://${id}/options/index.html#popup`, 1100, 800);
  await ready(opt, `document.body.innerText.includes('Floating Popup')`);
  await sleep(300);
  await shot(opt, '10-settings');
  await opt.evaluate(`location.hash = 'data'`);
  await ready(opt, `document.body.innerText.includes('WordNet 3.1')`);
  await sleep(300);
  await shot(opt, '11-settings-data');
  console.log(`screens → ${out}`);
} finally {
  await browser.close();
  srv.close();
}
