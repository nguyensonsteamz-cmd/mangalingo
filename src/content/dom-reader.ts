/**
 * DOM text reading: word under the cursor (caret APIs + hit-testing so neighbouring words are
 * never picked), current selection, surrounding sentence, and editable-context detection.
 */
import { extractWordAt, sentenceAround } from '@/language/word-at';
import type { Rect } from '@/popup/position';

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"], [role="searchbox"], .monaco-editor, .CodeMirror, .cm-editor, .ace_editor, .ProseMirror';
const INTERACTIVE_SELECTOR = 'a[href], button, label, summary, select, option, [role="button"], [role="link"], [role="tab"], [role="menuitem"], video, audio';
const BLOCK_DISPLAYS = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-cell', 'flow-root']);

export function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  const doc = el.ownerDocument;
  if (doc?.designMode === 'on') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return !!el.closest?.(EDITABLE_SELECTOR);
}

/** True when the user is typing somewhere (focused editable element). */
export function isTypingContext(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (isEditable(el)) return true;
  const active = document.activeElement;
  return !!active && active !== document.body && isEditable(active);
}

export function isInteractive(el: Element | null): boolean {
  return !!el?.closest?.(INTERACTIVE_SELECTOR);
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

function blockAncestor(node: Node): Element {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && el !== document.body) {
    const d = getComputedStyle(el).display;
    if (BLOCK_DISPLAYS.has(d)) return el;
    el = el.parentElement;
  }
  return el ?? document.body;
}

/** Text nodes of the block containing `node` (skipping script/style), in document order. */
function blockTextNodes(block: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n && out.length < 4000; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function locate(nodes: Text[], index: number): { node: Text; offset: number } | null {
  let acc = 0;
  for (const n of nodes) {
    const len = n.data.length;
    if (index <= acc + len) return { node: n, offset: index - acc };
    acc += len;
  }
  return null;
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

export interface WordHit {
  word: string;
  context: string;
  rect: Rect;
  range: Range;
}

/**
 * Word at viewport point (x, y), or null when the point is not over a word. The word may span
 * several inline text nodes (e.g. "<b>He</b>llo"); punctuation is excluded.
 */
export function wordAtPoint(x: number, y: number): WordHit | null {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const textNode = caret.node as Text;
  const block = blockAncestor(textNode);
  let nodes = blockTextNodes(block);
  let idx = nodes.indexOf(textNode);
  if (idx < 0) {
    nodes = [textNode]; // very large block: fall back to the single text node
    idx = 0;
  }
  let base = 0;
  for (let i = 0; i < idx; i++) base += nodes[i].data.length;
  const full = nodes.map((n) => n.data).join('');
  const span = extractWordAt(full, base + caret.offset);
  if (!span) return null;
  const a = locate(nodes, span.start);
  const b = locate(nodes, span.end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  // Hit test: the pointer must actually be over the word's glyph boxes (prevents picking the
  // nearest word when clicking whitespace, margins or the end of a line).
  const rects = [...range.getClientRects()];
  const tol = 2;
  const inside = rects.some((r) => x >= r.left - tol && x <= r.right + tol && y >= r.top - tol && y <= r.bottom + tol);
  if (!inside) return null;
  const bounding = range.getBoundingClientRect();
  return { word: span.word, context: sentenceAround(full, span.start, span.end), rect: toRect(bounding), range };
}

export interface SelectionHit {
  text: string;
  context?: string;
  rect: Rect;
  range: Range;
}

/** The current page selection (outside editable fields), or null. */
export function currentSelection(maxLen = 6000): SelectionHit | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  if (isEditable(el)) return null;
  const text = sel.toString().replace(/ /g, ' ').trim();
  if (!text || text.length > maxLen) return null;
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const bounding = range.getBoundingClientRect();
  const rect = rects.length ? bounding : bounding;
  let context: string | undefined;
  if (!/\s/.test(text) || text.split(/\s+/).length <= 3) {
    // short selection → include its sentence as context
    const block = blockAncestor(range.startContainer);
    const before = document.createRange();
    before.setStart(block, 0);
    try {
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const full = block.textContent ?? '';
      context = sentenceAround(full, start, start + text.length);
    } catch {
      context = undefined;
    }
  }
  return { text, context, rect: toRect(rect), range: range.cloneRange() };
}
