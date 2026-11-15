/**
 * Content script bootstrap: Shadow DOM host, settings sync, reading gestures (click / selection),
 * OCR hover detection, keyboard handling and background events.
 */
import { createRoot } from 'react-dom/client';
import css from '@/ui/styles.css?inline';
import type { TabEvent } from '@/shared/messages';
import { isInactive } from '@/shared/settings';
import { chromeLocal } from '@/storage/kv';
import { SettingsStore } from '@/storage/settings-store';
import { currentSelection, isInteractive, isTypingContext, wordAtPoint } from './dom-reader';
import { store, toast } from './store';
import { App } from './App';
import * as A from './actions';
import { getTranslator, mtAvailability } from '@/translation/chrome-mt';

const HOST_TAG = 'mangalingo-root';

function mount(): { host: HTMLElement; shadow: ShadowRoot } {
  document.querySelectorAll(HOST_TAG).forEach((n) => n.remove()); // stale host after extension reload
  const host = document.createElement(HOST_TAG);
  host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; contain: layout style;');
  // Closed root: page scripts cannot read lookups or OCR text rendered by the extension.
  const shadow = host.attachShadow({ mode: 'closed' });
  // Reference for our own isolated world only (page scripts cannot see isolated-world globals).
  Object.defineProperty(globalThis, '__mangalingo', { value: { shadow }, configurable: true });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}\n${css}`;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);
  // Attached to the page only while MangaLingo is on for this site (see syncAttached in main()).
  // Keep the page from reacting to interactions inside our UI (e.g. readers that turn pages on click).
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu']) {
    host.addEventListener(type, (e) => e.stopPropagation(), type === 'wheel' ? { passive: true } : undefined);
  }
  createRoot(container).render(<App shadow={shadow} />);
  return { host, shadow };
}

function fromUs(e: Event, host: Element) {
  return e.composedPath().includes(host);
}

async function main() {
  if (window.top !== window && window.innerWidth < 200) return; // ignore tiny frames
  // Injected again by the background (tab opened before install/reload)? Run only once per world.
  const g = globalThis as { __mangalingoStarted?: boolean };
  if (g.__mangalingoStarted) return;
  g.__mangalingoStarted = true;
  const settingsStore = new SettingsStore(chromeLocal());
  let settings = await settingsStore.load();
  store.set({ settings });
  const ignored = () => isInactive(settings, location.hostname);
  settingsStore.subscribe((s) => {
    settings = s;
    store.set({ settings: s });
    if (ignored()) {
      // Switched off (toolbar) or site ignored: remove every trace of the UI from the page.
      A.closePopup();
      A.clearOcr();
      store.set({ hoverImage: null, regionSelect: false });
    }
  });

  const { host } = mount();
  // Pages where MangaLingo is off get no element, no UI and no reaction to clicks.
  const syncAttached = () => {
    if (!ignored()) {
      if (!host.isConnected) (document.documentElement || document.body).appendChild(host);
    } else if (host.isConnected) host.remove();
  };
  syncAttached();
  settingsStore.subscribe(() => syncAttached());

  // ---------------- reading gestures ----------------
  let down: { x: number; y: number; t: number } | null = null;
  let lastMove = { x: 0, y: 0 };

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (fromUs(e, host)) return;
      down = { x: e.clientX, y: e.clientY, t: Date.now() };
      const st = store.get();
      if (st.popup || st.trigger) A.closePopup(); // click outside closes
      if (e.isTrusted && e.button === 0) A.dismissOcrResults(); // …and the bubble boxes disappear too
    },
    true,
  );

  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0 || fromUs(e, host) || ignored()) return;
      if (store.get().regionSelect) return;
      const start = down;
      down = null;
      if (isTypingContext(e.target)) return;
      const x = e.clientX;
      const y = e.clientY;
      // Let the browser finalise the selection first.
      setTimeout(() => {
        const sel = settings.reading.selectLookup ? currentSelection() : null;
        if (sel) {
          if (settings.reading.autoPopup) A.lookup(sel.text, sel.rect, sel.context);
          else store.set({ trigger: { rect: sel.rect, text: sel.text, context: sel.context } });
          return;
        }
        if (!settings.reading.clickLookup || e.detail > 1) return;
        const moved = start ? Math.hypot(start.x - x, start.y - y) : 0;
        if (moved > 5) return;
        const mod = settings.reading.clickModifier;
        if (mod === 'alt' && !e.altKey) return;
        if (mod === 'ctrl' && !(e.ctrlKey || e.metaKey)) return;
        if (mod === 'shift' && !e.shiftKey) return;
        const target = e.target instanceof Element ? e.target : null;
        if (isInteractive(target)) return;
        const hit = wordAtPoint(x, y);
        if (hit) A.lookup(hit.word, hit.rect, hit.context);
      }, 10);
    },
    true,
  );

  // Close popup / trigger on Escape (or the configured key); never while typing.
  window.addEventListener(
    'keydown',
    (e) => {
      const key = settings.shortcuts.closePopup;
      const st = store.get();
      if (!st.popup && !st.trigger) {
        if (e.key === 'Escape' && st.targets.length && !st.regionSelect && !isTypingContext(e.target)) A.clearOcr();
        return;
      }
      if (e.key === 'Escape' || (key !== 'Escape' && e.key.toLowerCase() === key && !isTypingContext(e.target) && !fromUs(e, host))) {
        A.closePopup();
      }
    },
    true,
  );

  // Auto-close behaviours + keep the popup attached to its anchor while scrolling.
  let enteredPopup = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  store.subscribe(() => {
    const st = store.get();
    clearTimeout(timer);
    if (!st.popup) {
      enteredPopup = false;
      return;
    }
    if (settings.popup.autoClose === 'timer') timer = setTimeout(() => !enteredPopup && A.closePopup(), settings.popup.autoCloseSeconds * 1000);
  });
  let lastScroll = { x: window.scrollX, y: window.scrollY };
  window.addEventListener(
    'scroll',
    () => {
      const st = store.get();
      const dx = window.scrollX - lastScroll.x;
      const dy = window.scrollY - lastScroll.y;
      lastScroll = { x: window.scrollX, y: window.scrollY };
      if (st.trigger) store.set({ trigger: null });
      if (!st.popup) return;
      if (settings.popup.autoClose === 'scroll') return A.closePopup();
      const a = st.popup.anchor;
      const anchor = { ...a, left: a.left - dx, top: a.top - dy };
      if (anchor.top + anchor.height < 0 || anchor.top > window.innerHeight) return A.closePopup();
      store.set({ popup: { ...st.popup, anchor } });
    },
    { passive: true },
  );
  host.addEventListener('pointerover', () => (enteredPopup = true));
  host.addEventListener('pointerout', (e) => {
    if (settings.popup.autoClose !== 'leave' || !enteredPopup) return;
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (!to || !host.contains(to)) setTimeout(() => !host.matches(':hover') && A.closePopup(), 250);
  });

  // ---------------- machine translation: preload the model ----------------
  // Chrome only downloads the EN→VI model inside a user gesture. On the first real click on any page
  // (machine mode on), start that one-time download in the background so the first bubble translates
  // without waiting. Never runs in "dictionary only" mode; afterwards availability is "available".
  let mtPreloadChecked = false;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (mtPreloadChecked || !e.isTrusted || settings.reading.translationMode !== 'machine' || ignored()) return;
      mtPreloadChecked = true;
      void mtAvailability().then((a) => {
        if (a !== 'downloadable') return;
        toast('MangaLingo: đang tải mô hình dịch Anh → Việt (một lần, chạy trên máy)…', 'info');
        getTranslator().then(
          () => toast('MangaLingo: mô hình dịch đã sẵn sàng.', 'ok'),
          () => (mtPreloadChecked = false), // e.g. gesture expired – retry on the next click
        );
      });
    },
    { capture: true, passive: true },
  );

  // ---------------- OCR hover detection ----------------
  let moveRaf = 0;
  window.addEventListener(
    'mousemove',
    (e) => {
      lastMove = { x: e.clientX, y: e.clientY };
      if (!settings.ocr.enabled || settings.ocr.trigger !== 'hover' || ignored()) return;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        if (fromUs(e, host)) return;
        const el = A.imageAt(lastMove.x, lastMove.y, host);
        const cur = store.get().hoverImage;
        if (el !== (cur?.el ?? null)) {
          const r = el?.getBoundingClientRect();
          store.set({ hoverImage: el && r ? { el, rect: { left: r.left, top: r.top, width: r.width, height: r.height } } : null });
        }
      });
    },
    { passive: true, capture: true },
  );

  // ---------------- background events ----------------
  chrome.runtime.onMessage.addListener((msg: TabEvent, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'ocr:progress': {
        const t = store.get().targets.find((x) => x.jobId === msg.progress.jobId);
        if (t && t.status === 'running') {
          const p = msg.progress;
          // Tesseract reports per stage; map stages into one monotonic bar.
          const stageBase = p.status === 'recognizing text' ? 0.3 : p.status.includes('traineddata') ? 0.15 : 0.05;
          const value = p.status === 'recognizing text' ? stageBase + p.progress * 0.7 : stageBase + p.progress * 0.1;
          store.set((s) => ({ targets: s.targets.map((x) => (x.id === t.id ? { ...x, progress: Math.max(x.progress, value), statusText: p.status } : x)) }));
        }
        return false;
      }
      case 'ml:ping':
        sendResponse(true);
        return false;
      case 'ocr:capture':
        if (msg.phase === 'begin') {
          store.set({ capturing: true });
          requestAnimationFrame(() => requestAnimationFrame(() => sendResponse(true)));
          return true;
        }
        store.set({ capturing: false });
        return false;
      case 'cmd:lookup-selection':
      case 'ctx:lookup': {
        if (ignored()) return false;
        const sel = currentSelection();
        const text = msg.type === 'ctx:lookup' ? msg.text : sel?.text;
        if (!text) {
          toast('Hãy bôi đen văn bản cần tra.', 'info');
          return false;
        }
        const rect = sel?.rect ?? { left: lastMove.x, top: lastMove.y, width: 1, height: 1 };
        A.lookup(text, rect, sel?.context, true);
        return false;
      }
      case 'cmd:scan-image':
      case 'ctx:scan-image': {
        if (ignored()) return false;
        let el: Element | null = null;
        if (msg.type === 'ctx:scan-image' && msg.srcUrl) {
          el = [...document.images].find((i) => i.currentSrc === msg.srcUrl || i.src === msg.srcUrl) ?? null;
        }
        el ??= A.imageAt(lastMove.x, lastMove.y, host) ?? A.mainImage(host);
        if (el) A.scanImage(el);
        else toast('Không tìm thấy ảnh đủ lớn để quét. Dùng "Chọn vùng để quét OCR" trong menu chuột phải.', 'info');
        return false;
      }
      case 'ctx:scan-region':
        if (ignored()) return false;
        store.set({ regionSelect: true });
        return false;
    }
    return false;
  });
}

void main().catch((e) => console.warn('[MangaLingo] content script failed to start', e));
