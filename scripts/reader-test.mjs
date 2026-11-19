/**
 * Tests of src/reader/reader.js (the script injected into pages of the iPhone Web Reader) in a real Chrome:
 * click / select lookup, punctuation, forms and links left alone, the site's own handlers untouched,
 * popup rendering and placement, settings, OCR pick mode. Run: node scripts/reader-test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { attach, launch, sleep } from './cdp.mjs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FIX = join(ROOT, 'tests/fixtures');
const READER = await readFile(join(ROOT, 'src/reader/reader.js'), 'utf8');
const MIME = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript' };

const serve = (port, dir) =>
  new Promise((res) => {
    const s = http.createServer(async (q, r) => {
      try {
        const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
        const body = await readFile(join(dir, p));
        r.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }).end(body);
      } catch {
        r.writeHead(404).end();
      }
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
const s1 = await serve(48101, join(FIX, 'reader'));
const s2 = await serve(48102, FIX); // other origin: serves the picture WITHOUT CORS headers (tainted canvas)

const results = [];
let failed = 0;
const step = async (name, fn) => {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail ?? '']);
  } catch (e) {
    failed++;
    results.push(['FAIL', name, String(e.message ?? e)]);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const browser = await launch({ headless: true });
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const p = await attach(browser, targetId);
  await p.send('Runtime.enable');
  await p.send('Page.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__MLR_TEST__ = { log: [] };\n${READER}` });

  const open = async (page) => {
    await p.send('Page.navigate', { url: `http://127.0.0.1:48101/${page}` });
    await sleep(900);
    await p.evaluateMain(`window.__MLR_TEST__.log.length = 0`);
  };
  const log = () => p.evaluateMain(`window.__MLR_TEST__.log.slice()`);
  const clear = () => p.evaluateMain(`window.__MLR_TEST__.log.length = 0`);
  const cfg = (o) => p.evaluateMain(`window.__mlr.configure(${JSON.stringify(o)})`);
  const posOf = (id, word, which = 'center') =>
    p.evaluateMain(`(() => { const el = document.getElementById(${JSON.stringify(id)}); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(${JSON.stringify(word)}); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, b: { x: b.left, y: b.top, w: b.width, h: b.height } }; } } return null; })()`);
  const click = async (x, y) => {
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
  };
  const select = async (id, from, to) => {
    await p.evaluateMain(`(() => { const el = document.getElementById(${JSON.stringify(id)}); const t = el.firstChild; const a = t.data.indexOf(${JSON.stringify(from)}); const b = t.data.indexOf(${JSON.stringify(to)}, a) + ${JSON.stringify(to)}.length; const r = document.createRange(); r.setStart(t, a); r.setEnd(t, b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await sleep(700); // the reader waits for the selection to settle
  };
  const lookups = async () => (await log()).filter((m) => m.t === 'lookup');
  const popupText = () => p.evaluateMain(`(() => { const c = window.__mlrTest?.root.querySelector('.card'); return c ? c.innerText : null; })()`);
  const reset = async () => {
    await p.evaluateMain(`window.__mlr.hide(); getSelection().removeAllRanges(); window.scrollTo(0, 0)`);
    await cfg({ clickToLookup: true, selectToLookup: true, autoPopup: true, popupPosition: 'auto', popupSize: 'medium', fontSize: 15, ocrEnabled: true });
    await clear();
  };

  await open('article.html');

  await step('injection: ready message, one element added to the page', async () => {
    await open('article.html');
    const l = await p.evaluateMain(`window.__MLR_TEST__.log.length`);
    // the ready message was posted before we cleared: reload and read it
    await p.send('Page.navigate', { url: 'http://127.0.0.1:48101/article.html' });
    await sleep(900);
    const first = (await log())[0];
    assert(first && first.t === 'ready', 'ready message missing');
    const extra = await p.evaluateMain(`document.querySelectorAll('mangalingo-reader').length`);
    assert(extra === 0, 'nothing is added until the first popup');
    await clear();
    return `ready @ ${first.url}`;
  });

  await step('click-to-lookup: word, sentence context, paragraph, rect', async () => {
    await reset();
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    const l = await lookups();
    assert(l.length === 1, `expected 1 lookup, got ${l.length}`);
    assert(l[0].text === 'village' && l[0].mode === 'word', `got ${JSON.stringify(l[0])}`);
    assert(l[0].context === 'The village was destroyed by the demon.', `sentence context: "${l[0].context}"`);
    assert(l[0].rect.w > 20 && l[0].rect.h > 10, 'selection coordinates missing');
    const t = await popupText();
    assert(t && /village/.test(t) && /Đang dịch/.test(t), `loading popup missing: ${t}`);
    return `"${l[0].text}" in "${l[0].context}"`;
  });

  await step('hidden ads: an invisible full-screen overlay is switched off for the tap, the ad handler never runs, the tap reaches the page underneath', async () => {
    await open('ghost-ad.html');
    await sleep(500);
    await clear();
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    await sleep(300);
    const r = await p.evaluateMain(`({ ad: window.adClicks, real: window.realClicks, ghost: document.getElementById('ghost').getAttribute('data-mlr-ghost') })`);
    assert(r.ad === 0, 'the ad click handler must not run, ran ' + r.ad + ' times');
    assert(r.ghost === '1', 'overlay marked');
    assert((await log()).some((m) => m.t === 'adBlocked'), 'adBlocked message to the app');
    // second tap: the overlay is gone, the page gets the click (lookup works)
    await click(w.x, w.y);
    const r2 = await p.evaluateMain(`({ ad: window.adClicks, real: window.realClicks })`);
    assert(r2.ad === 0 && r2.real >= 1, 'second tap reaches the page: ' + JSON.stringify(r2));
    await cfg({ blockAds: false });
    return `ad handler runs: ${r2.ad}, page handler runs: ${r2.real}`;
  });

  await step('hidden-ad blocking can be switched off (a legitimate transparent cover then works as the site wrote it)', async () => {
    await open('ghost-ad.html');
    await sleep(400);
    await cfg({ blockAds: false });
    await p.evaluateMain(`window.open = () => null`); // never open a real pop-up tab in the test browser
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    const r = await p.evaluateMain(`window.adClicks`);
    assert(r >= 1, 'with blocking off the site handler runs');
    await open('article.html'); // the following steps use the article page
    await sleep(900);
    await reset();
  });

  await step('region scan: drag a rectangle → only that area is requested (viewport rect) → boxes are ADDED, numbering continues, tapping a box starts a lookup', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.regionMode(true)`);
    assert(await p.evaluateMain(`!!document.querySelector('mangalingo-reader-region')`), 'region layer shown');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 120 });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 120, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 220 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 220, button: 'left', clickCount: 1 });
    await sleep(400);
    const reg = (await log()).find((m) => m.t === 'ocrRegion');
    assert(reg && Math.abs(reg.rect.x - 60) < 2 && Math.abs(reg.rect.w - 140) < 3 && Math.abs(reg.rect.h - 100) < 3, 'region request: ' + JSON.stringify(reg));
    assert(await p.evaluateMain(`!document.querySelector('mangalingo-reader-region')`), 'layer removed before the snapshot');
    // the app answers with two bubbles (normalised to the region), then a second region adds one more
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${reg.id}, blocks: [{ id: 'a', text: 'HELLO THERE', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }, { id: 'b', text: 'GOOD BYE', box: { x: 0.5, y: 0.5, w: 0.4, h: 0.3 } }] })`);
    const second = await p.evaluateMain(`(() => { window.__mlr.scanScreen(); return 1; })()`);
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    assert(scr.rect.x === 0 && scr.rect.w > 300, 'whole-screen request');
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'c', text: 'THIRD', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 } }] })`);
    const n = await p.evaluateMain(`document.querySelectorAll('mangalingo-reader-ocr [data-mlr-ocr]').length`);
    assert(n === 1, 'screen scan REPLACES earlier boxes (fresh scan), got ' + n);
    // add mode again: region results accumulate
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${reg.id}, blocks: [{ id: 'a', text: 'ADDED ONE', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }] })`);
    const nums = await p.evaluateMain(`[...document.querySelectorAll('mangalingo-reader-ocr [data-mlr-ocr]')].map(e => e.getAttribute('data-mlr-ocr'))`);
    assert(nums.join(',') === '1,2', 'numbering continues: ' + nums.join(','));
    const bubbles = (await log()).filter((m) => m.t === 'ocrBubbles');
    assert(bubbles.length >= 3 && bubbles[0].blocks.length === 2, 'the app is told about the bubbles for its sidebar');
    await open('article.html'); // clean page for the next steps
    await sleep(900);
    await reset();
    return 'rect ' + JSON.stringify(reg.rect);
  });

  await step('bubble tools: bubbles carry no icons; tapping one opens a bottom sheet whose buttons edit / delete THAT bubble or clear all; the bar adds a bubble or turns all off', async () => {
    await reset();
    const count = () => p.evaluateMain(`document.querySelectorAll('mangalingo-reader-ocr [data-mlr-ocr]').length`);
    const bar = () => p.evaluateMain(`!!window.__mlrTest.root.querySelector('.bar')`);
    const sheetBtn = (label) => p.evaluateMain(`(() => { const b = [...window.__mlrTest.root.querySelectorAll('.card.sheet button')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
    await p.evaluateMain(`window.__mlr.scanScreen()`);
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'a', text: 'ONE', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }, { id: 'b', text: 'TWO', box: { x: 0.1, y: 0.4, w: 0.3, h: 0.1 } }, { id: 'c', text: 'THREE', box: { x: 0.1, y: 0.7, w: 0.3, h: 0.1 } }] })`);
    assert((await count()) === 3 && (await bar()), 'three bubbles and the bar');
    assert(await p.evaluateMain(`document.querySelectorAll('mangalingo-reader-ocr [data-mlr-ocr] span[role=button]').length === 0`), 'no icons on the bubbles');
    // tap bubble 1: a sheet (bottom) opens; the app answers
    await p.evaluateMain(`document.querySelector('mangalingo-reader-ocr [data-mlr-ocr="1"]').click()`);
    const lk = (await log()).filter((m) => m.t === 'lookup').pop();
    assert(lk && lk.src === 'ocr', 'lookup from the bubble');
    await p.evaluateMain(`window.__mlr.show({ id: ${lk.id}, title: 'ONE', meanings: [{ pos: 'n.', vi: 'một' }] })`);
    assert(await p.evaluateMain(`!!window.__mlrTest.root.querySelector('.card.sheet')`), 'the popup is a bottom sheet');
    assert(await sheetBtn('Xoá bong bóng này'), 'delete button in the sheet');
    assert((await count()) === 2, 'only that bubble is gone');
    // tap bubble 2 (now first in the DOM): edit its area
    await p.evaluateMain(`document.querySelector('mangalingo-reader-ocr [data-mlr-ocr="2"]').click()`);
    const lk2 = (await log()).filter((m) => m.t === 'lookup').pop();
    await p.evaluateMain(`window.__mlr.show({ id: ${lk2.id}, title: 'TWO', meanings: [] })`);
    assert(await sheetBtn('Chỉnh vùng'), 'edit button in the sheet');
    assert(await p.evaluateMain(`!!document.querySelector('mangalingo-reader-region')`), 'region layer for the edit');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 40, y: 100 });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 40, y: 100, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 180, y: 160 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 180, y: 160, button: 'left', clickCount: 1 });
    await sleep(400);
    const reg2 = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    assert(reg2.id !== scr.id, 'a new region request was sent');
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${reg2.id}, blocks: [{ id: 'z', text: 'TWO FIXED', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 } }] })`);
    assert((await count()) === 2, 'the edited bubble replaced the old one, got ' + (await count()));
    // the bar: add mode, then all off
    await p.evaluateMain(`[...window.__mlrTest.root.querySelectorAll('.bar button')].find(b => b.textContent.includes('Thêm')).click()`);
    assert(await p.evaluateMain(`!!document.querySelector('mangalingo-reader-region')`), 'add mode from the bar');
    await p.evaluateMain(`window.__mlr.regionMode(false)`);
    await p.evaluateMain(`[...window.__mlrTest.root.querySelectorAll('.bar button')].find(b => b.textContent.includes('Tắt')).click()`);
    assert((await count()) === 0 && !(await bar()), 'all bubbles and the bar are gone');
    await reset();
  });

  await step('quick look-up: typed text opens the answer as a bottom sheet (word and sentence)', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.lookupText('village')`);
    let lk = (await log()).filter((m) => m.t === 'lookup').pop();
    assert(lk.src === 'quick' && lk.mode === 'word' && lk.text === 'village', 'word look-up: ' + JSON.stringify(lk));
    assert(await p.evaluateMain(`!!window.__mlrTest.root.querySelector('.card.sheet')`), 'sheet');
    await p.evaluateMain(`window.__mlr.lookupText('The old village was quiet at night.')`);
    lk = (await log()).filter((m) => m.t === 'lookup').pop();
    assert(lk.mode === 'sentence', 'sentence look-up: ' + lk.mode);
    await reset();
  });

  await step('the bottom sheet can be dragged: up makes it taller, down makes it shorter, a long pull down closes it; the speaker is a thin SVG icon', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.lookupText('village')`);
    const lk = (await log()).filter((m) => m.t === 'lookup').pop();
    await p.evaluateMain(`window.__mlr.show({ id: ${lk.id}, title: 'village', meanings: [{ pos: 'n.', vi: 'làng' }], english: ['a community smaller than a town'], saveable: true })`);
    await sleep(500); // the sheet slides up first
    const h = () => p.evaluateMain(`window.__mlrTest.root.querySelector('.card.sheet').getBoundingClientRect().height`);
    const grab = () => p.evaluateMain(`(() => { const r = window.__mlrTest.root.querySelector('[data-mlr=grab]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert(await p.evaluateMain(`!!window.__mlrTest.root.querySelector('.x svg') && !/🔊/.test(window.__mlrTest.root.innerHTML)`), 'speaker is an SVG, not an emoji');
    const h0 = await h();
    let g = await grab();
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y - i * 16, buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: g.y - 80, button: 'left', clickCount: 1 });
    await sleep(200);
    const h1 = await h();
    assert(h1 > h0 + 40, 'dragged up: taller (' + h0 + ' -> ' + h1 + ')');
    g = await grab();
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 4; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y + i * 20, buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: g.y + 80, button: 'left', clickCount: 1 });
    await sleep(200);
    const h2 = await h();
    assert(h2 < h1 - 40, 'dragged down: shorter (' + h1 + ' -> ' + h2 + ')');
    g = await grab();
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y + i * 25, buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: g.y + 200, button: 'left', clickCount: 1 });
    await sleep(200);
    assert(await p.evaluateMain(`!window.__mlrTest.root.querySelector('.card')`), 'a long pull down closes the sheet');
    await sleep(700); // the click right after a drag is ignored for a moment (it is not a tap on the page)
    await reset();
  });

  await step('after a scan nothing is written over the page (the app shows the translation itself); the pick mode ends by itself, no "Xong" to press', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.ocrMode(true)`);
    assert(await p.evaluateMain(`window.__mlrTest.state().ocrOn === true`), 'pick mode on');
    await p.evaluateMain(`window.__mlr.scanScreen()`);
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrMode(true)`);
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'a', text: 'HELLO THERE', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } }] })`);
    assert(await p.evaluateMain(`window.__mlrTest.state().ocrOn === false`), 'pick mode ended by itself');
    assert((await log()).some((m) => m.t === 'ocrCancel'), 'the app is told');
    assert(await p.evaluateMain(`!document.querySelector('mangalingo-reader-ocr [data-mlr-trlabel]')`), 'no translation is drawn over the bubbles');
    assert(!(await log()).some((m) => m.t === 'lookup' && m.src === 'bubble'), 'no per-bubble look-ups from the page');
    assert((await log()).some((m) => m.t === 'ocrBubbles' && m.blocks.length === 1), 'the bubbles are handed to the app (its sidebar translates them)');
    await open('article.html');
    await sleep(900);
    await reset();
  });

  await step('notice bars sit at the bottom (they never cover the top of the page) and let touches through', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.regionMode(true)`);
    const hint = await p.evaluateMain(`(() => { const h = window.__mlrTest.root.querySelector('.hint'); const r = h.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, pe: getComputedStyle(h).pointerEvents, btn: getComputedStyle(h.querySelector('button')).pointerEvents }; })()`);
    assert(hint.top > hint.vh * 0.6, 'hint is in the lower part: ' + JSON.stringify(hint));
    assert(hint.pe === 'none' && hint.btn === 'auto', 'only its button takes touches');
    await p.evaluateMain(`window.__mlr.regionMode(false)`);
    await p.evaluateMain(`window.__mlr.scanScreen()`);
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'a', text: 'ONE', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }] })`);
    const bar = await p.evaluateMain(`(() => { const b = window.__mlrTest.root.querySelector('.bar'); const r = b.getBoundingClientRect(); return { top: r.top, vh: innerHeight, pe: getComputedStyle(b).pointerEvents }; })()`);
    assert(bar.top > bar.vh * 0.6 && bar.pe === 'none', 'bubble bar at the bottom: ' + JSON.stringify(bar));
    await open('article.html');
    await sleep(900);
    await reset();
  });

  await step('while a scan runs the notices and bubble boxes are hidden (the snapshot must not show them); they return with the answer; the bar buttons are small', async () => {
    await reset();
    const vis = () => p.evaluateMain(`(() => { const h = document.querySelector('mangalingo-reader'); return h ? getComputedStyle(h).visibility : 'none'; })()`);
    await p.evaluateMain(`window.__mlr.scanScreen()`);
    assert((await vis()) === 'hidden', 'hidden while the scan is out');
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'a', text: 'ONE', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }] })`);
    assert((await vis()) === 'visible', 'visible again with the answer');
    const fs = await p.evaluateMain(`parseFloat(getComputedStyle(window.__mlrTest.root.querySelector('.bar button')).fontSize)`);
    assert(fs <= 12.5, 'small bar buttons: ' + fs);
    await open('article.html');
    await sleep(900);
    await reset();
  });

  await step('region scan: the hint hides while the user draws and returns after a tap; the answer is the POPUP first (sidebar untouched); only a screen scan is flagged for the sidebar', async () => {
    await reset();
    const hintShown = () => p.evaluateMain(`(() => { const h = window.__mlrTest.root.querySelector('.hint'); return !!h && h.style.display !== 'none'; })()`);
    await p.evaluateMain(`window.__mlr.regionMode(true)`);
    assert(await hintShown(), 'hint visible before drawing');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 120 });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 120, button: 'left', clickCount: 1 });
    assert(!(await hintShown()), 'hint hidden while the finger is down');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 62, y: 122, button: 'left', clickCount: 1 }); // a tap, too small
    assert(await hintShown(), 'hint is back after a tap');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 120 });
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 120, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 220 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 220, button: 'left', clickCount: 1 });
    await sleep(400);
    const reg = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${reg.id}, blocks: [{ id: 'a', text: 'HELLO THERE', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }] })`);
    const lk = (await log()).filter((m) => m.t === 'lookup').pop();
    assert(lk && lk.src === 'ocr' && /HELLO/.test(lk.text), 'the popup lookup starts right after a region scan: ' + JSON.stringify(lk));
    assert(await p.evaluateMain(`!!window.__mlrTest.root.querySelector('.card.sheet')`), 'the popup (sheet) is open');
    const bub = (await log()).filter((m) => m.t === 'ocrBubbles').pop();
    assert(bub && bub.screen === false, 'a region scan is not flagged as a screen scan');
    await p.evaluateMain(`window.__mlr.hide()`);
    await p.evaluateMain(`window.__mlr.scanScreen()`);
    const scr = (await log()).filter((m) => m.t === 'ocrRegion').pop();
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${scr.id}, blocks: [{ id: 'a', text: 'ONE', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }] })`);
    const bub2 = (await log()).filter((m) => m.t === 'ocrBubbles').pop();
    assert(bub2 && bub2.screen === true, 'a screen scan is flagged (the app opens the sidebar for it)');
    assert(await p.evaluateMain(`!window.__mlrTest.root.querySelector('.card')`), 'a screen scan opens no popup by itself');
    await open('article.html');
    await sleep(900);
    await reset();
  });

  await step('theme and feature switches: the light theme restyles the popup; the speaker button can be switched off', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.configure({ theme: 'light', speaker: false })`);
    await p.evaluateMain(`window.__mlr.lookupText('village')`);
    const lk = (await log()).filter((m) => m.t === 'lookup').pop();
    await p.evaluateMain(`window.__mlr.show({ id: ${lk.id}, title: 'village', meanings: [{ pos: 'n.', vi: 'làng' }] })`);
    const st = await p.evaluateMain(`(() => { const c = window.__mlrTest.root.querySelector('.card'); return { light: document.querySelector('mangalingo-reader').classList.contains('light'), bg: getComputedStyle(c).backgroundColor, speaker: !!window.__mlrTest.root.querySelector('.row .x svg') }; })()`);
    assert(st.light && /255, 255, 255/.test(st.bg), 'light popup: ' + JSON.stringify(st));
    assert(st.speaker === false, 'no speaker button when it is switched off');
    await p.evaluateMain(`window.__mlr.configure({ theme: 'dark', speaker: true })`);
    assert(await p.evaluateMain(`!document.querySelector('mangalingo-reader').classList.contains('light')`), 'dark again');
    await reset();
  });

  await step('the site’s own click handlers still run (nothing is stopped or prevented)', async () => {
    await reset();
    await p.evaluateMain(`window.siteClicks = 0`);
    const w = await posOf('p1', 'demon');
    await click(w.x, w.y);
    const n = await p.evaluateMain(`window.siteClicks`);
    assert(n === 1, `site click handler ran ${n} times`);
  });

  await step('punctuation: no trailing dot / quote, apostrophes and hyphens kept', async () => {
    const cases = [
      ['p1', 'demon', 'demon'],
      ['p2', 'Run', 'Run'],
      ['p2', "It's", "It's"],
      ['p2', 'well-known', 'well-known'],
      ['p2', "doesn't", "doesn't"],
    ];
    const got = [];
    for (const [id, needle, expect] of cases) {
      await reset();
      const w = await posOf(id, needle);
      await click(w.x, w.y);
      const l = await lookups();
      assert(l.length === 1 && l[0].text === expect, `"${needle}" → ${JSON.stringify(l.map((x) => x.text))}`);
      got.push(l[0].text);
    }
    return got.join(' | ');
  });

  await step('links, buttons, inputs, textareas and contenteditable are left alone', async () => {
    await reset();
    for (const [id, word] of [['link', 'next'], ['btn', 'Continue'], ['field', 'x'], ['area', 'x'], ['p5', 'words']]) {
      const el = await p.evaluateMain(`(() => { const e = document.getElementById(${JSON.stringify(id)}); const r = e.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; })()`);
      await click(el.x, el.y);
    }
    const l = await lookups();
    assert(l.length === 0, `unexpected lookups: ${JSON.stringify(l.map((x) => x.text))}`);
    const hash = await p.evaluateMain(`location.hash`);
    await p.evaluateMain(`location.hash = ''`);
    return `no lookup (link click navigated: ${hash === '#next'})`;
  });

  await step('non-English text does not trigger a lookup', async () => {
    await reset();
    const w = await posOf('p4', 'văn');
    await click(w.x, w.y);
    assert((await lookups()).length === 0, 'Vietnamese word triggered a lookup');
  });

  await step('select-to-lookup: word / sentence / paragraph by what is selected', async () => {
    await reset();
    await select('p1', 'The village', 'demon.');
    let l = await lookups();
    assert(l.length === 1 && l[0].mode === 'sentence' && l[0].text === 'The village was destroyed by the demon.', `sentence: ${JSON.stringify(l)}`);
    await reset();
    await select('p1', 'The village', 'came back.');
    l = await lookups();
    assert(l.length === 1 && l[0].mode === 'paragraph', `paragraph: ${JSON.stringify(l)}`);
    await reset();
    await select('p1', 'hero', 'hero');
    l = await lookups();
    assert(l.length === 1 && l[0].mode === 'word' && l[0].text === 'hero', `word: ${JSON.stringify(l)}`);
    assert(l[0].context.startsWith('Nobody survived'), `word context: ${l[0].context}`);
    return 'sentence, paragraph and word modes';
  });

  await step('selection in a Vietnamese paragraph or in a form field is ignored', async () => {
    await reset();
    await select('p4', 'Xin chào', 'tiếng Việt.');
    assert((await lookups()).length === 0, 'Vietnamese selection looked up');
    await p.evaluateMain(`(() => { const i = document.getElementById('field'); i.focus(); i.select(); })()`);
    await sleep(700);
    assert((await lookups()).length === 0, 'input selection looked up');
  });

  await step('popup: renders the result, saves, closes; stale answers are ignored', async () => {
    await reset();
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    const id = (await lookups())[0].id;
    await p.evaluateMain(`window.__mlr.show({ id: ${id + 99}, title: 'STALE' })`);
    assert(!/STALE/.test(await popupText()), 'a stale answer replaced the popup');
    await p.evaluateMain(`window.__mlr.show({ id: ${id}, title: 'village', ipa: '/ˈvɪlɪdʒ/', pos: ['n. · danh từ'], meanings: [{ pos: 'n.', vi: 'làng; xã' }], mt: 'ngôi làng', mtLabel: 'Dịch máy', english: ['a community smaller than a town'], saveable: true, saved: false })`);
    const t = await popupText();
    for (const s of ['village', '/ˈvɪlɪdʒ/', 'n. · danh từ', 'làng; xã', 'ngôi làng', 'Lưu từ', 'Chi tiết', 'Dịch câu', 'Dịch đoạn']) assert(t.includes(s), `popup lacks "${s}": ${t}`);
    await clear();
    await p.evaluateMain(`window.__mlrTest.root.querySelector('[data-mlr="save"]').click()`);
    const save = (await log()).find((m) => m.t === 'save');
    assert(save && save.id === id && save.word === 'village', `save message: ${JSON.stringify(save)}`);
    await p.evaluateMain(`window.__mlr.saved(${id}, true)`);
    assert(/Đã lưu/.test(await popupText()), 'saved state not shown');
    await p.evaluateMain(`[...window.__mlrTest.root.querySelectorAll('button.b')].find((b) => b.textContent === 'Chi tiết').click()`);
    const d = (await log()).find((m) => m.t === 'details');
    assert(d && d.text === 'village', 'details message');
    await p.evaluateMain(`window.__mlrTest.root.querySelector('.x:last-of-type').click()`);
    assert((await popupText()) === null, 'popup did not close');
  });

  await step('"Dịch câu" / "Dịch đoạn" start a new lookup of the sentence / paragraph', async () => {
    await reset();
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    let id = (await lookups())[0].id;
    await p.evaluateMain(`window.__mlr.show({ id: ${id}, title: 'village', saveable: true })`);
    await clear();
    await p.evaluateMain(`[...window.__mlrTest.root.querySelectorAll('button.b')].find((b) => b.textContent === 'Dịch câu').click()`);
    let l = await lookups();
    assert(l.length === 1 && l[0].mode === 'sentence' && l[0].text.startsWith('The village was destroyed'), `sentence lookup: ${JSON.stringify(l)}`);
    id = l[0].id;
    await p.evaluateMain(`window.__mlr.show({ id: ${id}, title: 'sentence', mt: 'Ngôi làng bị quỷ phá hủy.' })`);
    await clear();
    await p.evaluateMain(`[...window.__mlrTest.root.querySelectorAll('button.b')].find((b) => b.textContent === 'Dịch đoạn').click()`);
    l = await lookups();
    assert(l.length === 1 && l[0].mode === 'paragraph' && /hero never came back/.test(l[0].text), `paragraph lookup: ${JSON.stringify(l)}`);
  });

  await step('blocked / error answers are shown (quota guard)', async () => {
    await reset();
    const w = await posOf('p1', 'night');
    await click(w.x, w.y);
    const id = (await lookups())[0].id;
    await p.evaluateMain(`window.__mlr.show({ id: ${id}, title: 'night', blocked: { message: 'Bạn đã đạt hạn mức dịch miễn phí đã cấu hình.', needsConsent: true, additionalChars: 5, estimatedCostUsd: 0.0001 } })`);
    const t = await popupText();
    assert(/hạn mức dịch miễn phí/.test(t) && /Hạn mức dịch/.test(t), `blocked card: ${t}`);
    await p.evaluateMain(`window.__mlr.show({ id: ${id}, title: 'night', error: 'Không dịch được: mạng lỗi' })`);
    assert(/mạng lỗi/.test(await popupText()), 'error not shown');
  });

  await step('popup is placed inside the viewport (above / below / sizes, even near the edges)', async () => {
    const sizes = { small: 264, medium: 328, large: 392 };
    const out = [];
    for (const [id, word] of [['title', 'Last'], ['p1', 'Nobody'], ['p2', 'shouted']]) {
      for (const position of ['auto', 'above', 'below']) {
        await reset();
        await cfg({ popupPosition: position, popupSize: 'large' });
        const w = await posOf(id, word);
        await click(w.x, w.y);
        const sid = (await lookups())[0].id;
        await p.evaluateMain(`window.__mlr.show({ id: ${sid}, title: 'x', meanings: [{ vi: 'a very long meaning '.repeat(12) }], mt: 'bản dịch', saveable: true })`);
        const r = await p.evaluateMain(`(() => { const c = window.__mlrTest.root.querySelector('.card').getBoundingClientRect(); return { l: c.left, t: c.top, r: c.right, b: c.bottom, w: c.width, vw: innerWidth, vh: innerHeight }; })()`);
        assert(r.l >= 0 && r.t >= 0 && r.r <= r.vw + 0.5 && r.b <= r.vh + 0.5, `${id}/${position}: card ${JSON.stringify(r)} leaves the ${r.vw}x${r.vh} viewport`);
        out.push(`${position}:${Math.round(r.w)}x${Math.round(r.b - r.t)}`);
      }
    }
    for (const [size, px] of Object.entries(sizes)) {
      await reset();
      await cfg({ popupSize: size });
      const w = await posOf('p1', 'village');
      await click(w.x, w.y);
      await sleep(300); // the popup grows in over 160 ms: measure after the entry animation
      const width = await p.evaluateMain(`window.__mlrTest.root.querySelector('.card').getBoundingClientRect().width`);
      const vw = await p.evaluateMain('innerWidth'); // can be a little under 390 when the page shows a scrollbar
      assert(Math.abs(width - Math.min(px, vw - 16)) < 1, `${size} width ${width} (viewport ${vw})`);
    }
    return out.slice(0, 3).join(' ');
  });

  await step('settings: click-to-lookup off, select-to-lookup off, auto popup off (shows a "Dịch" chip first)', async () => {
    await reset();
    await cfg({ clickToLookup: false });
    let w = await posOf('p1', 'village');
    await click(w.x, w.y);
    assert((await lookups()).length === 0, 'click lookup while disabled');
    await reset();
    await cfg({ selectToLookup: false });
    await select('p1', 'The village', 'demon.');
    assert((await lookups()).length === 0, 'select lookup while disabled');
    await reset();
    await cfg({ autoPopup: false });
    w = await posOf('p1', 'village');
    await click(w.x, w.y);
    assert((await lookups()).length === 0, 'popup opened although auto popup is off');
    const chip = await p.evaluateMain(`!!window.__mlrTest.root.querySelector('.chipbtn')`);
    assert(chip, 'no chip');
    await p.evaluateMain(`window.__mlrTest.root.querySelector('.chipbtn').click()`);
    assert((await lookups()).length === 1, 'chip did not start the lookup');
  });

  await step('toolbar "Dịch": translates the current selection, or says what to do', async () => {
    await reset();
    await cfg({ selectToLookup: false });
    assert((await p.evaluateMain(`window.__mlr.translateSelection()`)) === false, 'no selection → false');
    assert(/chọn từ, câu/.test(await p.evaluateMain(`window.__mlrTest.root.querySelector('.toast').textContent`)), 'hint toast');
    await select('p1', 'Nobody', 'night,');
    const ok = await p.evaluateMain(`window.__mlr.translateSelection()`);
    assert(ok && (await lookups()).length === 1, 'selection not translated');
  });

  await step('scrolling closes the popup; the page DOM is untouched except one host element', async () => {
    await reset();
    const before = await p.evaluateMain(`document.body.innerHTML`);
    const w = await posOf('p1', 'village');
    await click(w.x, w.y);
    await sleep(500);
    assert((await popupText()) !== null, 'popup should be open');
    await p.evaluateMain(`window.scrollTo(0, 300)`);
    await sleep(200);
    assert((await popupText()) === null, 'popup stayed after scrolling');
    const after = await p.evaluateMain(`document.body.innerHTML`);
    assert(before === after, 'document.body was modified');
    const hosts = await p.evaluateMain(`document.documentElement.querySelectorAll(':scope > mangalingo-reader').length`);
    assert(hosts === 1, `host elements: ${hosts}`);
  });

  await open('manga.html');
  await step('OCR: pick mode, same-origin image gives pixels, boxes over the image, tap → lookup', async () => {
    await reset();
    const w = await p.evaluateMain(`(() => { const r = document.getElementById('same').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40, r: { x: r.left, y: r.top, w: r.width, h: r.height } }; })()`);
    await click(w.x, w.y);
    assert((await log()).filter((m) => m.t === 'ocrImage').length === 0, 'image click outside OCR mode must do nothing');
    await p.evaluateMain(`window.__mlr.ocrMode(true)`);
    assert(/Chạm vào ảnh/.test(await p.evaluateMain(`window.__mlrTest.root.querySelector('.hint').textContent`)), 'hint banner');
    await click(w.x, w.y);
    const m = (await log()).find((x) => x.t === 'ocrImage');
    assert(m && m.dataUrl && m.dataUrl.startsWith('data:image/jpeg'), 'no pixels for the same-origin image');
    assert(Math.abs(m.rect.w - w.r.w) < 1, 'image rect');
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${m.id}, blocks: [{ id: 'b1', text: "I'M GONNA BECOME THE STRONGEST NINJA!", box: { x: 0.08, y: 0.15, w: 0.8, h: 0.1 } }, { id: 'b2', text: 'WHAT THE HELL IS GOING ON HERE?!', box: { x: 0.08, y: 0.6, w: 0.7, h: 0.1 } }] })`);
    const boxes = await p.evaluateMain(`[...document.querySelectorAll('mangalingo-reader-ocr [data-mlr-ocr]')].map((d) => { const r = d.getBoundingClientRect(); return { n: d.dataset.mlrOcr, x: r.left, y: r.top, w: r.width, h: r.height }; })`);
    assert(boxes.length === 2, `boxes: ${boxes.length}`);
    const img = await p.evaluateMain(`(() => { const r = document.getElementById('same').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    assert(Math.abs(boxes[0].x - (img.x + 0.08 * img.w)) < 2 && Math.abs(boxes[0].y - (img.y + 0.15 * img.h)) < 2, `box 1 misplaced: ${JSON.stringify(boxes[0])} vs image ${JSON.stringify(img)}`);
    assert(Math.abs(boxes[1].w - 0.7 * img.w) < 2, 'box 2 size');
    await clear();
    await p.evaluateMain(`document.querySelector('mangalingo-reader-ocr [data-mlr-ocr="2"]').click()`);
    const l = await lookups();
    assert(l.length === 1 && l[0].src === 'ocr' && l[0].mode === 'sentence' && /HELL/.test(l[0].text), `ocr lookup: ${JSON.stringify(l)}`);
    return `2 boxes, bubble 2 → "${l[0].text}"`;
  });

  await step('OCR: a cross-origin image without CORS has no pixels in JS (the app downloads it instead)', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.ocrMode(true)`);
    const w = await p.evaluateMain(`(() => { const i = document.getElementById('cross'); i.scrollIntoView(); const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, loaded: i.complete && i.naturalWidth > 0 }; })()`);
    assert(w.loaded, 'cross-origin test image did not load');
    await clear();
    await click(w.x, w.y);
    const m = (await log()).find((x) => x.t === 'ocrImage');
    assert(m && m.dataUrl === null && /48102\/bubble@2x\.png/.test(m.src), `expected null pixels + url, got ${JSON.stringify(m && { d: m.dataUrl && m.dataUrl.slice(0, 20), s: m.src })}`);
    await p.evaluateMain(`window.__mlr.ocrResult({ id: ${m.id}, error: 'Không nhận dạng được chữ trong ảnh này.' })`);
    assert(/Không nhận dạng/.test(await p.evaluateMain(`window.__mlrTest.root.querySelector('.toast').textContent`)), 'error toast');
    // the pick mode ended by itself when the answer came (no "Xong" to press)
    assert((await log()).some((x) => x.t === 'ocrCancel'), 'the app is told the pick mode ended');
    assert(await p.evaluateMain(`!window.__mlrTest.root.querySelector('.hint')`), 'the hint banner is gone');
  });

  await step('OCR disabled in settings: pick mode turns itself off', async () => {
    await reset();
    await p.evaluateMain(`window.__mlr.ocrMode(true)`);
    await cfg({ ocrEnabled: false });
    assert(!(await p.evaluateMain(`window.__mlrTest.state().ocrOn`)), 'OCR mode still on');
  });
} finally {
  await browser.close();
  s1.close();
  s2.close();
}

for (const [st, name, detail] of results) console.log(`${st === 'PASS' ? '  PASS' : '  FAIL'}  ${name}${detail ? ` – ${detail}` : ''}`);
console.log(`\nREADER: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
