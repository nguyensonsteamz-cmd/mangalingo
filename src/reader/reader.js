/*
 * LingoLens Web Reader: script injected into the page shown in the in-app browser (WKUserScript, its own
 * WKContentWorld "mlreader", so the website's own JavaScript can neither see nor break it).
 *
 *  - click-to-lookup and select-to-lookup for English text (word / sentence / paragraph + the context)
 *  - a floating translation popup drawn in a closed shadow root (one element added to the page, nothing else touched)
 *  - an OCR "pick an image" mode with tappable boxes over the manga image
 *
 * It never reads or sends the page: only the text the user clicked or selected leaves the page, through
 * webkit.messageHandlers.mlr. It does not touch forms / inputs, links, or the site's event handlers
 * (listeners are passive and never stop propagation, except while the user is explicitly picking an image).
 * Swift -> JS: window.__mlr.{configure, show, hide, saved, ocrMode, ocrResult, translateSelection, toast}.
 */
(function () {
  'use strict';
  if (window.__mlr) return;

  var TEST = !!window.__MLR_TEST__;
  var post = function (m) {
    try {
      window.webkit.messageHandlers.mlr.postMessage(m);
    } catch (e) {
      if (TEST && window.__MLR_TEST__.post) window.__MLR_TEST__.post(m);
    }
    if (TEST && window.__MLR_TEST__.log) window.__MLR_TEST__.log.push(m);
  };

  var S = {
    clickToLookup: true,
    selectToLookup: true,
    autoPopup: true,
    popupPosition: 'auto', // auto | above | below
    popupSize: 'medium', // small | medium | large
    fontSize: 15,
    ocrEnabled: true,
    blockAds: true,
  };

  var SIZES = { small: 264, medium: 328, large: 392 };
  var seq = 0;
  var cur = null; // the request whose popup is open { id, text, context, mode, rect }
  var ocrOn = false;
  var ocrSeq = 0;
  var ocrImages = {}; // id -> element
  var ocrOverlays = []; // one per scanned image / region (a region scan ADDS bubbles, it does not replace the others)
  var ocrBlockSeq = 0; // numbering of bubbles across overlays
  var regionOn = false;
  var host = null;
  var root = null;
  var card = null;
  var shownAt = 0;
  var scrollStart = 0;

  // ------------------------------------------------------------------ text helpers
  var BLOCK = { block: 1, flex: 1, grid: 1, 'list-item': 1, table: 1, 'table-cell': 1, 'flow-root': 1 };
  var WORD_RE = /[A-Za-zÀ-ɏ]+(?:['’\-][A-Za-zÀ-ɏ]+)*/g;
  var norm = function (s) {
    return String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  };

  function isEditable(el) {
    return !!(el && el.closest && el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'));
  }
  function isInteractive(el) {
    return !!(el && el.closest && el.closest('a[href],button,summary,label,option,video,audio,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="slider"]'));
  }
  function inOurUi(e) {
    var path = e.composedPath ? e.composedPath() : [];
    return !!host && path.indexOf(host) >= 0;
  }
  function blockOf(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      var d = getComputedStyle(el).display;
      if (BLOCK[d]) return el;
      el = el.parentElement;
    }
    return document.body || document.documentElement;
  }
  function offsetIn(block, node, offset) {
    try {
      var r = document.createRange();
      r.setStart(block, 0);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch (e) {
      return 0;
    }
  }

  /** The sentence of `full` that contains [start, end). */
  function sentenceAround(full, start, end) {
    var a = start;
    while (a > 0) {
      var c = full[a - 1];
      if ((c === '.' || c === '!' || c === '?' || c === '…') && /\s/.test(full[a] || ' ')) break;
      a--;
    }
    var b = end;
    while (b < full.length) {
      var d = full[b];
      b++;
      if (d === '.' || d === '!' || d === '?' || d === '…') {
        while (b < full.length && /["'”’)\]]/.test(full[b])) b++;
        break;
      }
    }
    return norm(full.slice(a, b));
  }
  function countSentences(text) {
    var m = text.match(/[.!?…]+(\s|$)/g);
    return m ? m.length : 1;
  }
  function modeOf(text) {
    var words = text.match(WORD_RE) || [];
    if (words.length <= 1) return 'word';
    if (text.length > 600 || countSentences(text) > 1 || /\n/.test(text)) return 'paragraph';
    return 'sentence';
  }
  // Vietnamese-only letters (ă â đ ê ô ơ ư and the stacked tone marks): a few of them mean "not English"
  var VI_SPECIAL = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/g;
  function looksVietnamese(text) {
    var m = text.match(VI_SPECIAL);
    return !!m && m.length >= 2;
  }
  function hasEnglish(text) {
    return (/[A-Za-z]{2,}/.test(text) || /^[A-Za-z]$/.test(text.trim())) && !looksVietnamese(text);
  }

  // ------------------------------------------------------------------ what is under the finger
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    return null;
  }

  /** The English word at viewport point (x, y), with its sentence / paragraph context, or null. */
  function wordAtPoint(x, y) {
    var c = caretAt(x, y);
    if (!c || c.node.nodeType !== 3) return null;
    var text = c.node.data;
    var m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) {
      var s = m.index;
      var e = s + m[0].length;
      if (c.offset < s || c.offset > e) continue;
      var range = document.createRange();
      range.setStart(c.node, s);
      range.setEnd(c.node, e);
      var tol = 6; // a finger is not a pixel
      var hit = false;
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var q = rects[i];
        if (x >= q.left - tol && x <= q.right + tol && y >= q.top - tol && y <= q.bottom + tol) hit = true;
      }
      if (!hit) return null;
      var block = blockOf(c.node);
      var full = (block.textContent || '').replace(/ /g, ' ');
      var off = offsetIn(block, c.node, s);
      var rr = range.getBoundingClientRect();
      var word = m[0].replace(/^['’\-]+|['’\-]+$/g, '');
      if (looksVietnamese(norm(full).slice(Math.max(0, off - 80), off + 120))) return null; // a Vietnamese sentence
      return {
        word: word,
        sentence: sentenceAround(full, off, off + m[0].length),
        paragraph: norm(full).slice(0, 3000),
        rect: { x: rr.left, y: rr.top, w: rr.width, h: rr.height },
      };
    }
    return null;
  }

  function currentSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var anchor = range.commonAncestorContainer;
    var el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    if (isEditable(el)) return null;
    var text = norm(sel.toString());
    if (!text || text.length > 4000 || !hasEnglish(text)) return null;
    var rr = range.getBoundingClientRect();
    var block = blockOf(range.startContainer);
    var full = (block.textContent || '').replace(/ /g, ' ');
    var start = offsetIn(block, range.startContainer, range.startOffset);
    var context = text.split(' ').length <= 3 ? sentenceAround(full, start, start + text.length) : text;
    return { text: text, context: context, paragraph: norm(full).slice(0, 3000), rect: { x: rr.left, y: rr.top, w: rr.width, h: rr.height } };
  }

  // ------------------------------------------------------------------ popup (closed shadow root)
  var CSS =
    ':host{all:initial}' +
    '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    '.card{position:fixed;z-index:2147483647;max-height:58vh;overflow:auto;-webkit-overflow-scrolling:touch;color:#eef1f7;background:rgba(22,25,34,.97);' +
    'border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);' +
    'padding:12px 14px 12px;font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-text-size-adjust:100%;' +
    'animation:in .16s ease-out}' +
    '@keyframes in{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}' +
    '@keyframes up{from{transform:translateY(100%)}to{transform:none}}' +
    '.card.sheet{left:0;right:0;bottom:0;top:auto;width:auto;max-height:64vh;border-radius:22px 22px 0 0;border-bottom:0;padding:10px 16px calc(env(safe-area-inset-bottom,0px) + 16px);animation:up .24s cubic-bezier(.16,1,.3,1)}' +
    '.grab{width:38px;height:4px;border-radius:2px;background:rgba(255,255,255,.28);margin:0 auto 8px}' +
    '.row{display:flex;align-items:flex-start;gap:8px}' +
    '.title{flex:1;min-width:0;font-weight:700;font-size:1.18em;word-break:break-word}' +
    '.ipa{color:#9aa4b8;font-weight:400;font-size:.85em;margin-left:6px}' +
    '.x{flex:none;border:0;background:rgba(255,255,255,.09);color:#cfd6e4;width:28px;height:28px;border-radius:14px;font-size:15px;line-height:28px;text-align:center;padding:0}' +
    '.chips{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0 2px}' +
    '.chip{background:rgba(124,156,255,.16);color:#b9c8ff;border-radius:99px;padding:2px 9px;font-size:.78em;font-weight:600}' +
    '.orig{color:#aeb7c9;font-size:.9em;margin:6px 0 4px;word-break:break-word}' +
    '.mt{margin:8px 0 2px;padding:9px 11px;border-radius:12px;background:rgba(124,156,255,.14);border:1px solid rgba(124,156,255,.28);font-weight:600}' +
    '.mt small{display:block;color:#9fb2ff;font-weight:700;font-size:.7em;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px}' +
    '.grp{margin-top:7px}.grp b{display:block;color:#9aa4b8;font-size:.76em;font-weight:600;margin-bottom:1px}' +
    '.mean{font-size:1.02em}' +
    '.en{color:#aab3c5;font-size:.88em;margin-top:5px}' +
    '.note{margin-top:8px;padding:8px 10px;border-radius:11px;font-size:.88em}' +
    '.warn{background:rgba(255,184,76,.13);border:1px solid rgba(255,184,76,.35)}' +
    '.err{background:rgba(255,99,99,.12);border:1px solid rgba(255,99,99,.35)}' +
    '.btns{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}' +
    'button.b{border:0;border-radius:11px;padding:7px 12px;font:inherit;font-size:.9em;font-weight:600;color:#eef1f7;background:rgba(255,255,255,.1)}' +
    'button.b.p{background:#3451d1;color:#fff}' +
    'button.b[disabled]{opacity:.55}' +
    '.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#9fb2ff;border-radius:50%;animation:r .7s linear infinite;vertical-align:-2px;margin-right:6px}' +
    '@keyframes r{to{transform:rotate(360deg)}}' +
    '.chipbtn{position:fixed;z-index:2147483647;border:0;border-radius:99px;padding:7px 14px;font:600 14px -apple-system,system-ui,sans-serif;color:#fff;background:#3451d1;box-shadow:0 8px 22px rgba(0,0,0,.45)}' +
    '.hint{position:fixed;z-index:2147483647;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 8px);display:flex;gap:10px;align-items:center;' +
    'background:rgba(22,25,34,.96);color:#eef1f7;border:1px solid rgba(124,156,255,.5);border-radius:14px;padding:9px 12px;font:600 14px -apple-system,system-ui,sans-serif}' +
    '.bar{position:fixed;z-index:2147483646;right:10px;top:calc(env(safe-area-inset-top,0px) + 60px);display:flex;gap:6px}' +
    '.bar button.b{background:rgba(22,25,34,.96);border:1px solid rgba(255,255,255,.18);box-shadow:0 4px 14px rgba(0,0,0,.4)}' +
    '.hint span{flex:1}.toast{position:fixed;z-index:2147483647;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 90px);transform:translateX(-50%);background:rgba(22,25,34,.97);color:#eef1f7;' +
    'border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 14px;font:600 13.5px -apple-system,system-ui,sans-serif;max-width:86vw;text-align:center}';

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('mangalingo-reader');
    host.setAttribute('style', 'all:initial;position:static;');
    root = host.attachShadow({ mode: TEST ? 'open' : 'closed' });
    var st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    (document.documentElement || document.body).appendChild(host);
    if (TEST) window.__mlrTest = { root: root, state: function () { return { cur: cur, S: S, ocrOn: ocrOn }; } };
  }
  function clearUi(sel) {
    if (!root) return;
    var els = root.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].remove();
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(label, cls, fn) {
    var b = el('button', 'b' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      fn(b);
    });
    return b;
  }

  function place(rect) {
    if (!card) return;
    if (card.classList.contains('sheet')) {
      card.style.fontSize = S.fontSize + 'px';
      return;
    }
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var w = Math.min(SIZES[S.popupSize] || SIZES.medium, vw - 16);
    card.style.width = w + 'px';
    card.style.fontSize = S.fontSize + 'px';
    var h = card.offsetHeight;
    var left = Math.max(8, Math.min(vw - w - 8, rect.x + rect.w / 2 - w / 2));
    var below = rect.y + rect.h + 10;
    var above = rect.y - h - 10;
    var useBelow;
    if (S.popupPosition === 'below') useBelow = true;
    else if (S.popupPosition === 'above') useBelow = false;
    else useBelow = vh - (rect.y + rect.h) >= h + 14 || vh - (rect.y + rect.h) > rect.y;
    var top = useBelow ? below : above;
    top = Math.max(8, Math.min(vh - h - 8, top));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function closePopup() {
    cur = null;
    if (root) {
      clearUi('.card');
      clearUi('.chipbtn');
    }
    card = null;
  }

  function startLookup(req) {
    ensureHost();
    closePopup();
    clearUi('.toast');
    cur = { id: ++seq, text: req.text, context: req.context || req.text, paragraph: req.paragraph || req.context || req.text, mode: req.mode || modeOf(req.text), rect: req.rect, src: req.src || 'click', bubble: req.bubble || null };
    card = el('div', 'card' + (cur.src === 'ocr' || cur.src === 'quick' ? ' sheet' : ''));
    if (card.classList.contains('sheet')) card.appendChild(el('div', 'grab'));
    var head = el('div', 'row');
    var t = el('div', 'title', cur.text.length > 80 ? cur.text.slice(0, 80) + '…' : cur.text);
    var x = el('button', 'x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', function (e) {
      e.stopPropagation();
      closePopup();
    });
    head.appendChild(t);
    head.appendChild(x);
    card.appendChild(head);
    var l = el('div', 'orig');
    var sp = el('span', 'spin');
    l.appendChild(sp);
    l.appendChild(document.createTextNode('Đang dịch…'));
    card.appendChild(l);
    root.appendChild(card);
    place(cur.rect);
    shownAt = Date.now();
    scrollStart = window.scrollY;
    post({ t: 'lookup', id: cur.id, text: cur.text, context: cur.context, mode: cur.mode, src: cur.src, rect: cur.rect });
  }

  function chipFor(req) {
    ensureHost();
    closePopup();
    var vw = window.innerWidth;
    var b = el('button', 'chipbtn', 'Dịch');
    b.type = 'button';
    b.style.left = Math.max(8, Math.min(vw - 80, req.rect.x + req.rect.w / 2 - 30)) + 'px';
    b.style.top = Math.max(8, req.rect.y - 46) + 'px';
    if (req.rect.y < 60) b.style.top = req.rect.y + req.rect.h + 10 + 'px';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      b.remove();
      startLookup(req);
    });
    root.appendChild(b);
  }

  /** Quick look-up of typed text (the bottom bar): a word or a sentence, the answer rises from the bottom edge. */
  function lookupText(text) {
    var t = String(text || '').trim().slice(0, 1500);
    if (!t) return;
    ocrMode(false);
    startLookup({ text: t, context: t, paragraph: t, mode: modeOf(t), rect: { x: 0, y: window.innerHeight, w: window.innerWidth, h: 0 }, src: 'quick' });
  }

  function trigger(req, forced) {
    if (S.autoPopup || forced) startLookup(req);
    else chipFor(req);
  }

  // payload from the app: the lookup result for the popup
  function show(p) {
    if (!cur || p.id !== cur.id) return; // a newer lookup replaced this one
    ensureHost();
    card.textContent = '';
    if (card.classList.contains('sheet')) card.appendChild(el('div', 'grab'));
    var head = el('div', 'row');
    var t = el('div', 'title');
    t.appendChild(document.createTextNode(p.title || cur.text));
    if (p.ipa) t.appendChild(el('span', 'ipa', p.ipa));
    head.appendChild(t);
    if (p.canSpeak !== false) {
      var sp = el('button', 'x', '🔊');
      sp.type = 'button';
      sp.setAttribute('aria-label', 'Phát âm');
      sp.addEventListener('click', function (e) {
        e.stopPropagation();
        post({ t: 'speak', text: cur.mode === 'word' ? cur.text : p.title || cur.text });
      });
      head.appendChild(sp);
    }
    var x = el('button', 'x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', function (e) {
      e.stopPropagation();
      closePopup();
    });
    head.appendChild(x);
    card.appendChild(head);

    if (p.pos && p.pos.length) {
      var chips = el('div', 'chips');
      p.pos.forEach(function (c) {
        chips.appendChild(el('span', 'chip', c));
      });
      card.appendChild(chips);
    }
    if (cur.mode !== 'word') card.appendChild(el('div', 'orig', cur.text.length > 260 ? cur.text.slice(0, 260) + '…' : cur.text));

    if (p.blocked) {
      var bl = el('div', 'note err');
      bl.setAttribute('data-mlr', 'blocked');
      bl.appendChild(el('b', '', p.blocked.message));
      if (p.blocked.needsConsent) bl.appendChild(el('div', '', 'Ước tính thêm ' + p.blocked.additionalChars + ' ký tự tính phí, khoảng $' + Number(p.blocked.estimatedCostUsd).toFixed(4) + ' (ước tính cục bộ). Mở Cài đặt → Hạn mức dịch để quyết định.'));
      card.appendChild(bl);
    }
    if (p.mt) {
      var mt = el('div', 'mt');
      mt.setAttribute('data-mlr', 'mt');
      mt.appendChild(el('small', '', p.mtLabel || 'Bản dịch'));
      mt.appendChild(document.createTextNode(p.mt));
      card.appendChild(mt);
    }
    (p.meanings || []).forEach(function (g) {
      var d = el('div', 'grp');
      if (g.pos) d.appendChild(el('b', '', g.pos));
      d.appendChild(el('div', 'mean', g.vi));
      card.appendChild(d);
    });
    if (p.english && p.english.length) card.appendChild(el('div', 'en', p.english.join(' · ')));
    if (p.note) card.appendChild(el('div', 'note warn', p.note));
    if (p.error) {
      var er = el('div', 'note err', p.error);
      er.setAttribute('data-mlr', 'error');
      card.appendChild(er);
    }

    var row = el('div', 'btns');
    if (p.saveable) {
      var sv = btn(p.saved ? 'Đã lưu ✓' : 'Lưu từ', 'p', function (b) {
        if (b.disabled) return;
        b.disabled = true;
        post({ t: 'save', id: cur.id, word: cur.text, context: cur.context });
      });
      sv.setAttribute('data-mlr', 'save');
      if (p.saved) sv.disabled = true;
      row.appendChild(sv);
    }
    row.appendChild(
      btn('Chi tiết', '', function () {
        post({ t: 'details', text: cur.mode === 'word' ? cur.text : cur.text, context: cur.context });
      }),
    );
    if (cur.mode === 'word' && cur.context && cur.context !== cur.text) {
      row.appendChild(
        btn('Dịch câu', '', function () {
          startLookup({ text: cur.context, context: cur.context, paragraph: cur.paragraph, mode: 'sentence', rect: cur.rect, src: cur.src, bubble: cur.bubble });
        }),
      );
    }
    if (cur.mode !== 'paragraph' && cur.paragraph && cur.paragraph.length > cur.text.length + 20) {
      row.appendChild(
        btn('Dịch đoạn', '', function () {
          startLookup({ text: cur.paragraph.slice(0, 1500), context: cur.paragraph.slice(0, 1500), paragraph: cur.paragraph, mode: 'paragraph', rect: cur.rect, src: cur.src, bubble: cur.bubble });
        }),
      );
    }
    if (cur.bubble) {
      var bub = cur.bubble;
      row.appendChild(
        btn('Chỉnh vùng', '', function () {
          closePopup();
          regionMode(true, function (rr) {
            requestRegionOcr(rr, true, bub);
          });
        }),
      );
      row.appendChild(
        btn('Xoá bong bóng này', '', function () {
          closePopup();
          bub.remove();
          updateBubbleBar();
        }),
      );
      row.appendChild(
        btn('Xoá tất cả', '', function () {
          closePopup();
          clearOcrBoxes();
          post({ t: 'regionDone' });
        }),
      );
    }
    card.appendChild(row);
    place(cur.rect);
  }

  function saved(id, ok, msg) {
    if (!cur || id !== cur.id || !root) return;
    var b = root.querySelector('[data-mlr="save"]');
    if (b) {
      b.textContent = ok ? 'Đã lưu ✓' : 'Chưa lưu được';
      b.disabled = !!ok;
    }
    if (!ok && msg) toast(msg);
  }

  function toast(msg) {
    ensureHost();
    clearUi('.toast');
    var t = el('div', 'toast', msg);
    root.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 2600);
  }

  // ------------------------------------------------------------------ gestures
  var lastSel = '';
  var selTimer = 0;

  function onClick(e) {
    if (!S.clickToLookup || ocrOn) return;
    if (inOurUi(e)) return;
    var t = e.target;
    if (isEditable(t) || isInteractive(t)) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // selecting text: the selection handler takes over
    if (cur && Date.now() - shownAt > 200) {
      // a tap outside an open popup first closes it
      var hit0 = wordAtPoint(e.clientX, e.clientY);
      if (!hit0) {
        closePopup();
        return;
      }
    }
    var hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) {
      if (cur) closePopup();
      return;
    }
    trigger({ text: hit.word, context: hit.sentence, paragraph: hit.paragraph, mode: 'word', rect: hit.rect, src: 'click' }, false);
  }

  function onSelectionChange() {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var s = currentSelection();
      post({ t: 'selection', has: !!s });
      if (!S.selectToLookup || !s || ocrOn) return;
      if (s.text === lastSel) return;
      lastSel = s.text;
      var mode = modeOf(s.text);
      trigger({ text: s.text, context: s.context, paragraph: s.paragraph, mode: mode, rect: s.rect, src: 'select' }, false);
    }, 420);
  }
  function resetSel() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) lastSel = '';
  }

  function translateSelection() {
    var s = currentSelection();
    if (!s) {
      toast('Hãy chọn từ, câu hoặc đoạn tiếng Anh trước.');
      return false;
    }
    lastSel = s.text;
    startLookup({ text: s.text, context: s.context, paragraph: s.paragraph, mode: modeOf(s.text), rect: s.rect, src: 'select' });
    return true;
  }

  // ------------------------------------------------------------------ OCR (pick a manga image)
  function imageAt(x, y) {
    var list = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n || n === host) continue;
      if (n.tagName === 'IMG' && n.naturalWidth >= 80 && n.naturalHeight >= 80) return n;
      if (n.tagName === 'CANVAS' && n.width >= 80 && n.height >= 80) return n;
    }
    return null;
  }

  function imageDataUrl(img) {
    try {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var k = Math.min(1, 1800 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.9); // throws for cross-origin images without CORS (tainted canvas)
    } catch (e) {
      return null;
    }
  }

  /** Asks the app to read one image (pixels when the page lets us, else its address). */
  function requestImageOcr(img, silent) {
    var id = ++ocrSeq;
    ocrImages[id] = { el: img };
    var r = img.getBoundingClientRect();
    post({
      t: 'ocrImage',
      id: id,
      src: img.currentSrc || img.src || '',
      dataUrl: img.tagName === 'IMG' ? imageDataUrl(img) : img.toDataURL ? img.toDataURL('image/jpeg', 0.9) : null,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    });
    if (!silent) toast('Đang nhận dạng chữ trong ảnh…');
    return id;
  }

  function onOcrClick(e) {
    if (!ocrOn || inOurUi(e)) return;
    var img = imageAt(e.clientX, e.clientY);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation(); // only while the user is explicitly picking an image
    clearOcrBoxes();
    requestImageOcr(img, false);
  }

  /** Reads every sizeable image of the page, one after another (the app answers each; boxes accumulate). */
  function scanAllImages() {
    var list = [];
    var imgs = document.images || [];
    for (var i = 0; i < imgs.length && list.length < 12; i++) {
      var im = imgs[i];
      if (im.naturalWidth >= 150 && im.naturalHeight >= 150 && im.getBoundingClientRect().width >= 120) list.push(im);
    }
    if (!list.length) {
      toast('Không thấy ảnh đủ lớn để quét trên trang này.');
      return 0;
    }
    clearOcrBoxes();
    toast('Đang quét ' + list.length + ' ảnh trên trang…');
    list.forEach(function (im, k) {
      setTimeout(function () {
        requestImageOcr(im, true);
      }, k * 350);
    });
    return list.length;
  }

  /** Reads the visible screen (or a rectangle of it) through a snapshot taken by the app. rect: viewport CSS px. */
  /** client (layout viewport) coordinates -> the web view's own points: what the snapshot is taken in, correct while pinch-zoomed */
  function viewRect(r) {
    var vv = window.visualViewport;
    if (!vv || !vv.scale || (vv.scale === 1 && !vv.offsetLeft && !vv.offsetTop)) return r;
    return { x: (r.x - vv.offsetLeft) * vv.scale, y: (r.y - vv.offsetTop) * vv.scale, w: r.w * vv.scale, h: r.h * vv.scale };
  }
  function requestRegionOcr(rect, append, replace) {
    var id = ++ocrSeq;
    ocrImages[id] = { rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.w, h: rect.h }, append: !!append, replace: replace || null };
    post({ t: 'ocrRegion', id: id, rect: viewRect(rect) });
    toast('Đang nhận dạng chữ…');
    return id;
  }
  function scanScreen() {
    ocrMode(false);
    clearOcrBoxes();
    var vv = window.visualViewport;
    // what is on screen: the whole window, or the zoomed part of the page
    requestRegionOcr(vv && vv.scale > 1.01 ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, false);
  }

  /** Region mode: drag a rectangle over text the scan missed (or over any text); only that area is read and its bubbles are ADDED. */
  var regionLayer = null;
  function regionMode(on, pick) {
    regionOn = !!on;
    ensureHost();
    clearUi('.hint');
    if (regionLayer) {
      regionLayer.remove();
      regionLayer = null;
    }
    if (!regionOn) return;
    ocrMode(false);
    closePopup();
    var layer = document.createElement('mangalingo-reader-region');
    layer.setAttribute('style', 'all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;background:rgba(0,0,0,.28);touch-action:none;cursor:crosshair;');
    var box = document.createElement('div');
    box.setAttribute('style', 'position:fixed;border:2px solid #7c9cff;background:rgba(124,156,255,.18);border-radius:4px;display:none;pointer-events:none;');
    layer.appendChild(box);
    var start = null;
    function pt(e) {
      var t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }
    function draw(a, b2) {
      box.style.display = 'block';
      box.style.left = Math.min(a.x, b2.x) + 'px';
      box.style.top = Math.min(a.y, b2.y) + 'px';
      box.style.width = Math.abs(b2.x - a.x) + 'px';
      box.style.height = Math.abs(b2.y - a.y) + 'px';
    }
    layer.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      start = pt(e);
      try { layer.setPointerCapture(e.pointerId); } catch (x) {}
      draw(start, start);
    });
    layer.addEventListener('pointermove', function (e) {
      if (start) draw(start, pt(e));
    });
    layer.addEventListener('pointerup', function (e) {
      if (!start) return;
      var end = pt(e);
      var rr = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
      start = null;
      if (rr.w < 14 || rr.h < 14) {
        box.style.display = 'none';
        return;
      }
      regionMode(false);
      post({ t: 'regionDone' });
      // the layer is removed first, so the snapshot shows the page, not the dimmer
      setTimeout(function () {
        if (pick) pick(rr);
        else requestRegionOcr(rr, true);
      }, 80);
    });
    var h = el('div', 'hint');
    h.appendChild(el('span', '', pick ? 'Kéo quanh chữ của bong bóng này để đọc lại' : 'Kéo quanh chữ cần quét hoặc thêm bong bóng'));
    h.appendChild(
      btn('Huỷ', '', function () {
        regionMode(false);
        post({ t: 'regionDone' });
      }),
    );
    root.appendChild(h);
    (document.documentElement || document.body).appendChild(layer);
    regionLayer = layer;
  }

  function clearOcrBoxes() {
    ocrOverlays.forEach(function (o) {
      o.remove();
    });
    ocrOverlays = [];
    ocrBlockSeq = 0;
    updateBubbleBar();
  }

  /** "＋ Thêm bong bóng" / "✕ Tắt bong bóng": shown while bubbles are on the page. */
  function updateBubbleBar() {
    ocrOverlays = ocrOverlays.filter(function (o) {
      return o.isConnected && o.querySelector('[data-mlr-ocr]');
    });
    if (!root) return;
    clearUi('.bar');
    if (!ocrOverlays.length) return;
    var bar = el('div', 'bar');
    bar.appendChild(
      btn('＋ Thêm bong bóng', '', function () {
        regionMode(true);
      }),
    );
    bar.appendChild(
      btn('✕ Tắt bong bóng', '', function () {
        clearOcrBoxes();
        post({ t: 'regionDone' });
      }),
    );
    root.appendChild(bar);
  }

  function ocrMode(on) {
    ocrOn = !!on;
    ensureHost();
    clearUi('.hint');
    if (ocrOn) {
      closePopup();
      var h = el('div', 'hint');
      h.appendChild(el('span', '', 'Chạm vào ảnh truyện để quét chữ'));
      var c = btn('Xong', '', function () {
        ocrMode(false);
        post({ t: 'ocrCancel' });
      });
      h.appendChild(c);
      root.appendChild(h);
    }
  }

  /** blocks: [{ id, text, box: {x,y,w,h} normalised to the image / region }] */
  function ocrResult(res) {
    var src = ocrImages[res.id];
    clearUi('.toast');
    if (!src) return;
    if (res.error) {
      toast(res.error);
      return;
    }
    if (!res.blocks || !res.blocks.length) {
      toast(src.rect ? 'Không thấy chữ trong vùng này.' : 'Không tìm thấy chữ trong ảnh này.');
      return;
    }
    var left;
    var top;
    var width;
    var height;
    if (src.rect) {
      left = src.rect.x;
      top = src.rect.y;
      width = src.rect.w;
      height = src.rect.h;
    } else {
      var img = src.el;
      if (!img || !img.isConnected) return;
      var r = img.getBoundingClientRect();
      left = r.left + window.scrollX;
      top = r.top + window.scrollY;
      width = r.width;
      height = r.height;
    }
    if (src.replace && src.replace.isConnected) src.replace.remove(); // a re-read bubble replaces the old one
    var overlay = document.createElement('mangalingo-reader-ocr');
    overlay.setAttribute('style', 'all:initial;position:absolute;z-index:2147483646;pointer-events:none;left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;');
    var texts = [];
    res.blocks.forEach(function (b) {
      var n = ++ocrBlockSeq;
      texts.push({ id: 'b' + n, text: b.text });
      var d = document.createElement('div');
      d.setAttribute('data-mlr-ocr', String(n));
      d.setAttribute(
        'style',
        'position:absolute;pointer-events:auto;box-sizing:border-box;border:2px solid #f97316;border-radius:6px;background:rgba(249,115,22,.12);' +
          'left:' + b.box.x * 100 + '%;top:' + b.box.y * 100 + '%;width:' + b.box.w * 100 + '%;height:' + b.box.h * 100 + '%;',
      );
      var num = document.createElement('span');
      num.textContent = String(n);
      num.setAttribute('style', 'position:absolute;left:-2px;top:-12px;min-width:18px;height:18px;border-radius:9px;background:#f97316;color:#fff;font:700 11px/18px -apple-system,system-ui,sans-serif;text-align:center;');
      d.appendChild(num);
      d.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rr = d.getBoundingClientRect();
        startLookup({ text: b.text, context: b.text, paragraph: b.text, mode: modeOf(b.text) === 'word' ? 'word' : 'sentence', rect: { x: rr.left, y: rr.top, w: rr.width, h: rr.height }, src: 'ocr', bubble: d });
      });
      overlay.appendChild(d);
    });
    (document.documentElement || document.body).appendChild(overlay);
    ocrOverlays.push(overlay);
    updateBubbleBar();
    // the app shows the list of bubbles in its sidebar
    post({ t: 'ocrBubbles', id: res.id, fresh: ocrOverlays.length === 1, blocks: res.blocks.map(function (b, i) { return { text: b.text, box: b.box, n: ocrBlockSeq - res.blocks.length + i + 1 }; }) });
  }

  // ------------------------------------------------------------------ hidden ads
  // Some pages put an invisible full-screen element over the content: a tap on it opens an ad (a pop-up or a redirect) and the
  // reader is left on a page it cannot get out of. Such an element is recognised by what it IS (large, high, transparent, no text,
  // no media) – never by what it does – and is switched off for this tap: the tap then reaches the page underneath.
  function isGhostOverlay(el) {
    if (!el || el === host || el === document.documentElement || el === document.body) return false;
    var tag = el.tagName;
    if (tag !== 'DIV' && tag !== 'A' && tag !== 'SPAN' && tag !== 'INS' && tag !== 'IFRAME') return false;
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (r.width * r.height < 0.45 * vw * vh) return false;
    var z = parseInt(cs.zIndex, 10);
    if (!(z >= 1000)) return false;
    var invisible = parseFloat(cs.opacity) <= 0.05;
    if (!invisible) {
      var bg = cs.backgroundColor;
      var transparentBg = bg === 'transparent' || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0(\.0+)?\s*\)/.test(bg);
      var noContent = !norm(el.textContent || '') && !el.querySelector('img,video,canvas,svg,picture,input,button,iframe') && cs.backgroundImage === 'none';
      invisible = transparentBg && noContent;
    }
    return invisible;
  }
  var ghostSeen = 0;
  function killGhost(e) {
    if (!S.blockAds || inOurUi(e)) return;
    var t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    var x = t.clientX;
    var y = t.clientY;
    if (typeof x !== 'number') return;
    var top = document.elementFromPoint(x, y);
    if (!isGhostOverlay(top)) return;
    top.style.setProperty('pointer-events', 'none', 'important');
    top.setAttribute('data-mlr-ghost', '1');
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    if (Date.now() - ghostSeen > 4000) {
      toast('Đã chặn quảng cáo');
      post({ t: 'adBlocked', tag: top.tagName });
    }
    ghostSeen = Date.now();
  }
  ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(function (type) {
    document.addEventListener(type, killGhost, true);
  });

  // ------------------------------------------------------------------ wiring
  function onScroll() {
    if (cur && Date.now() - shownAt > 400 && Math.abs(window.scrollY - scrollStart) > 40) closePopup(); // do not leave a popup floating over other text
  }

  document.addEventListener('click', onClick, { passive: true });
  document.addEventListener('click', onOcrClick, true);
  document.addEventListener('selectionchange', onSelectionChange, { passive: true });
  document.addEventListener('pointerdown', resetSel, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  window.__mlr = {
    version: 1,
    configure: function (s) {
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && k in S) S[k] = s[k];
      if (!S.ocrEnabled && ocrOn) ocrMode(false);
      if (!S.ocrEnabled && regionOn) regionMode(false);
      if (cur) place(cur.rect);
    },
    show: show,
    hide: closePopup,
    saved: saved,
    ocrMode: ocrMode,
    ocrResult: ocrResult,
    regionMode: regionMode,
    lookupText: lookupText,
    scanScreen: scanScreen,
    scanAllImages: scanAllImages,
    translateSelection: translateSelection,
    toast: toast,
  };
  post({ t: 'ready', url: location.href });
})();
