// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { copyText, legacyCopy } from '@/mobile/ios';

/** execCommand('copy') as a browser does it: fires a cancelable `copy` event; true when it was handled (or the selection was copied). */
function fakeExecCommand(selectable: boolean) {
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = vi.fn((cmd: string) => {
    if (cmd !== 'copy') return false;
    let data = '';
    const ev = new Event('copy', { cancelable: true, bubbles: true });
    (ev as unknown as { clipboardData: { setData: (t: string, v: string) => void } }).clipboardData = { setData: (_t, v) => (data = v) };
    document.dispatchEvent(ev);
    fakeExecCommand.last = data;
    return ev.defaultPrevented || selectable;
  });
}
fakeExecCommand.last = '';

describe('copying text', () => {
  it('uses the Clipboard API when it works', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('Xin chào')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Xin chào');
  });

  it('falls back when the Clipboard API refuses, and the text really reaches the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('Document is not focused')) }, configurable: true });
    fakeExecCommand(false);
    fakeExecCommand.last = '';
    expect(await copyText('The village was destroyed.')).toBe(true);
    expect(fakeExecCommand.last).toBe('The village was destroyed.');
  });

  it('a page that cancels the copy event (or turns selection off) cannot block it: our capture listener runs first', () => {
    let pageSawIt = false;
    document.addEventListener('copy', (e) => {
      pageSawIt = true;
      e.preventDefault(); // the site's "no copying" script
    });
    fakeExecCommand(false);
    fakeExecCommand.last = '';
    expect(legacyCopy('Protected text')).toBe(true);
    expect(fakeExecCommand.last).toBe('Protected text');
    expect(pageSawIt).toBe(false); // stopImmediatePropagation: the page's handler never ran
  });

  it('leaves no temporary element behind and keeps the user text selection', () => {
    document.body.innerHTML = '<p id="p">Selected sentence on the page.</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fakeExecCommand(true);
    expect(legacyCopy('copied text')).toBe(true);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(sel.toString()).toBe('Selected sentence on the page.');
  });

  it('reports failure (false) when the browser cannot copy at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('not allowed');
    };
    expect(await copyText('x')).toBe(false);
  });
});
