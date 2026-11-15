/**
 * Minimal Chrome DevTools Protocol client over --remote-debugging-pipe (no dependencies).
 * Used by the end-to-end test to load dist/ with Extensions.loadUnpacked (Chrome ≥ 126).
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export async function launch({ headless = true, args = [] } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome not found (set CHROME_PATH)');
  // Chrome test profiles live inside the project (all project data stays on the project's drive).
  const tmpRoot = resolve(import.meta.dirname, '..', '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const profile = await mkdtemp(join(tmpRoot, 'ml-e2e-'));
  const proc = spawn(
    exe,
    [
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints,MediaRouter',
      '--disable-background-networking',
      '--window-size=1280,900',
      ...(headless ? ['--headless=new'] : []),
      ...args,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let buf = '';
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  inp.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else listeners.forEach((l) => l(msg));
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject, method });
      out.write(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  const close = async () => {
    try {
      await send('Browser.close');
    } catch {
      /* already closed */
    }
    await new Promise((r) => setTimeout(r, 500));
    proc.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return { send, on: (l) => listeners.add(l), off: (l) => listeners.delete(l), close, proc };
}

/** Attach to a target and return a session-bound helper. */
export async function attach(browser, targetId, { world } = {}) {
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  // Track execution contexts so we can evaluate inside the extension's isolated world
  // (where the content script lives) – the page's main world cannot see our closed shadow root.
  const contexts = new Map();
  browser.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.executionContextCreated') contexts.set(m.params.context.id, m.params.context);
    if (m.method === 'Runtime.executionContextDestroyed') contexts.delete(m.params.executionContextId);
    if (m.method === 'Runtime.executionContextsCleared') contexts.clear();
  });
  const worldContext = (name) => {
    let found;
    for (const c of contexts.values()) if (c.name === name && c.auxData?.type === 'isolated' && c.auxData?.isDefault === false) found = c;
    return found?.id;
  };
  const evaluate = async (expression, awaitPromise = true, inWorld = world) => {
    const contextId = inWorld ? worldContext(inWorld) : undefined;
    const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** Evaluate in the page's own (main) world – i.e. as a website script would. */
  const evaluateMain = (expression, awaitPromise = true) => evaluate(expression, awaitPromise, null);
  return { sessionId, send: s, evaluate, evaluateMain, worldContext };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 15000, interval = 150, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${label} (last: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 200)})`);
}
