/** Renders tests/e2e/fixtures/bubble.html with Chrome into tests/fixtures/bubble.png (1x) and bubble@2x.png. */
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { attach, launch, sleep } from './cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'tests/e2e/fixtures/bubble.html'));
const srv = await new Promise((r) => { const s = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html)); s.listen(0, '127.0.0.1', () => r(s)); });
const browser = await launch();
try {
  const { targetId } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${srv.address().port}/` });
  const p = await attach(browser, targetId);
  await p.send('Page.enable');
  await sleep(800);
  for (const [scale, name] of [[1, 'bubble.png'], [2, 'bubble@2x.png']]) {
    const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 760, height: 560, scale } });
    await writeFile(resolve(root, 'tests/fixtures', name), Buffer.from(shot.data, 'base64'));
  }
} finally {
  await browser.close();
  srv.close();
}
console.log('fixtures written');
