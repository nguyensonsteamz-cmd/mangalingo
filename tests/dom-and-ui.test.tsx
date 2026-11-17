// @vitest-environment jsdom
/**
 * DOM reader helpers in a DOM environment + render smoke tests of every result view
 * (word / phrase / sentence / paragraph / unsupported) with real engine output.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { currentSelection, isEditable, isInteractive, isTypingContext } from '@/content/dom-reader';
import { realDictionary } from './helpers/dict';
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/settings';
import { ChunksView, GlossBlock, GrammarView, NotesView, WordContextView, WordExamples, WordGrammar, WordMeaning, primaryMeaning } from '@/ui/views';
import { accentForeground, hexToRgb, popupSurface, resolveTheme, themeVars } from '@/ui/theme';
import type { SentenceAnalysis, WordLookup } from '@/shared/types';
import { ocrWords, MAX_OCR_WORDS } from '@/ocr/words';
import { sanitizeSettings } from '@/shared/settings';

// jsdom has no layout engine: provide empty geometry for Range
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);

describe('editable & interactive detection', () => {
  document.body.innerHTML = `
    <p id="p">Plain text</p><input id="i"><textarea id="t"></textarea>
    <div contenteditable="true"><span id="ce">edit me</span></div>
    <div class="cm-editor"><span id="cm">code</span></div>
    <a href="#" id="a"><span id="as">link</span></a><button id="b">btn</button>`;
  const $ = (id: string) => document.getElementById(id);
  it('detects inputs, textareas, contenteditable and code editors', () => {
    expect(isEditable($('i'))).toBe(true);
    expect(isEditable($('t'))).toBe(true);
    expect(isEditable($('ce'))).toBe(true);
    expect(isEditable($('cm'))).toBe(true);
    expect(isEditable($('p'))).toBe(false);
  });
  it('detects typing context from the focused element', () => {
    ($('i') as HTMLInputElement).focus();
    expect(isTypingContext($('p'))).toBe(true);
    ($('i') as HTMLInputElement).blur();
    expect(isTypingContext($('p'))).toBe(false);
  });
  it('detects links and buttons', () => {
    expect(isInteractive($('as'))).toBe(true);
    expect(isInteractive($('b'))).toBe(true);
    expect(isInteractive($('p'))).toBe(false);
  });
  it('reads the current selection and ignores selections inside inputs', () => {
    document.body.innerHTML = '<p id="s">The bank of the river. Another one.</p><input id="x" value="typed text">';
    const text = document.getElementById('s')!.firstChild!;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 8);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    const sel = currentSelection()!;
    expect(sel.text).toBe('bank');
    expect(sel.context).toBe('The bank of the river.');
    const input = document.getElementById('x') as HTMLInputElement;
    const r2 = document.createRange();
    r2.selectNodeContents(input);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r2);
    expect(currentSelection()).toBeNull();
    getSelection()!.removeAllRanges();
    expect(currentSelection()).toBeNull();
  });
});

describe('theme', () => {
  it('derives tokens from settings', () => {
    expect(hexToRgb('#7c9cff')).toEqual([124, 156, 255]);
    expect(accentForeground([255, 255, 255])).toBe('10 12 20');
    expect(accentForeground([20, 20, 60])).toBe('255 255 255');
    expect(resolveTheme('system', false)).toBe('light');
    const v = themeVars(mergeSettings(DEFAULT_SETTINGS, { popup: { fontSize: 18 }, typography: { fontSize: 13 } }), 'popup');
    expect(v['--ml-size']).toBe('18px');
    expect(themeVars(DEFAULT_SETTINGS, 'sidebar')['--ml-size']).toBe('14px');
  });
});

describe('result views render with real engine output', () => {
  const { service } = realDictionary();
  const s = DEFAULT_SETTINGS;
  it('word views', async () => {
    const r = (await service.lookup({ text: 'destroyed', context: 'The village was destroyed by the demon.' })) as WordLookup;
    const html = renderToStaticMarkup(
      <>
        <WordMeaning r={r} s={s} />
        <WordContextView r={r} />
        <WordExamples r={r} s={s} />
        <WordGrammar r={r} />
      </>,
    );
    expect(html).toContain('phá hủy');
    expect(html).toContain('Nghĩa trong ngữ cảnh');
    expect(html).toContain('destroyed');
    expect(primaryMeaning(r)).toContain('phá hủy');
  });
  it('hides sections disabled in settings', async () => {
    const r = (await service.lookup({ text: 'happy' })) as WordLookup;
    const off = mergeSettings(DEFAULT_SETTINGS, { dictionary: { showSynonyms: false, showEnglishDefinition: false } });
    const html = renderToStaticMarkup(<><WordMeaning r={r} s={off} /><WordExamples r={r} s={off} /></>);
    expect(html).not.toContain('Đồng nghĩa');
    expect(html).not.toContain('WordNet');
  });
  it('target language English shows English definitions first', async () => {
    const r = (await service.lookup({ text: 'destroy' })) as WordLookup;
    const en = mergeSettings(DEFAULT_SETTINGS, { reading: { targetLanguage: 'en' } });
    const html = renderToStaticMarkup(<WordMeaning r={r} s={en} />);
    expect(html.indexOf('WordNet')).toBeLessThan(html.indexOf('Tiếng Việt'));
  });
  it('dictionary-only mode: explicit notice when no Vietnamese data exists', async () => {
    const r = (await service.lookup({ text: 'photosynthesis' })) as WordLookup;
    const dictOnly = mergeSettings(s, { reading: { translationMode: 'dictionary' } });
    expect(renderToStaticMarkup(<WordMeaning r={r} s={dictOnly} />)).toContain('Chưa có nghĩa tiếng Việt');
  });
  it('machine mode (default): dictionary meanings come first; machine translation fills gaps and cross-checks', async () => {
    const r = (await service.lookup({ text: 'photosynthesis' })) as WordLookup;
    const html = renderToStaticMarkup(<WordMeaning r={r} s={s} />);
    expect(html).toContain('Đang dịch'); // no Vietnamese data: machine translation on top, pending until the translator answers
    expect(html).not.toContain('Chưa có nghĩa tiếng Việt');
    // "people" has curated meanings (mọi người): they are shown, the lone-word machine translation is only a cross-check
    const people = (await service.lookup({ text: 'people' })) as WordLookup;
    const html2 = renderToStaticMarkup(<WordMeaning r={people} s={s} />);
    expect(html2).toContain('mọi người');
    expect(html2).not.toContain('Đang dịch');
  });
  it('sentence views', async () => {
    const r = (await service.lookup({ text: "If I were you, I'd run away!" })) as SentenceAnalysis;
    const html = renderToStaticMarkup(
      <>
        <GlossBlock gloss={r.gloss} coverage={r.coverage} />
        <ChunksView chunks={r.chunks} />
        <GrammarView g={r.grammar} />
        <NotesView notes={r.notes} />
      </>,
    );
    expect(html).toContain('không phải bản dịch tự nhiên');
    expect(html).toContain('Điều kiện');
    expect(html).toContain('run away');
  });
});

describe('OCR bubble word list', () => {
  it('keeps content words in reading order, lower-cased, de-duplicated, without function words', () => {
    expect(ocrWords("THE PERPETRATOR MADE HIS ESCAPE BY MOVING FROM WINDOW TO WINDOW...")).toEqual(['perpetrator', 'made', 'escape', 'moving', 'window']);
  });
  it('joins words hyphenated across lines and handles contractions / curly apostrophes', () => {
    expect(ocrWords("T-THAT'S IMPOSSI- BLE!!")).toEqual(['t-that', 'impossible']);
    expect(ocrWords('IT WOULDN’T OCCUR TO YOU')).toEqual(['occur']);
    expect(ocrWords("THERE'S FIVE METERS")).toEqual(['five', 'meters']);
  });
  it('ignores numbers / punctuation and caps the list', () => {
    expect(ocrWords('!!! 123 ... ?')).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => 'word' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))).join(' ');
    expect(ocrWords(many)).toHaveLength(MAX_OCR_WORDS);
  });
});

describe('popup theme setting', () => {
  it('defaults to a light popup and validates the value', () => {
    expect(DEFAULT_SETTINGS.popup.theme).toBe('light');
    expect(sanitizeSettings({ popup: { theme: 'neon' } }).popup.theme).toBe('light');
    expect(sanitizeSettings({ popup: { theme: 'follow' } }).popup.theme).toBe('follow');
  });
});

describe('colour settings', () => {
  it('OCR bubble boxes default to orange and expose the colour as a CSS variable', () => {
    expect(DEFAULT_SETTINGS.ocr.boxColor).toBe('#f97316');
    expect(themeVars(DEFAULT_SETTINGS, 'popup')['--ml-box']).toBe('249 115 22');
    expect(sanitizeSettings({ ocr: { boxColor: 'orange' } }).ocr.boxColor).toBe('#f97316');
    expect(sanitizeSettings({ ocr: { boxColor: '#00FF00' } }).ocr.boxColor).toBe('#00ff00');
  });
  it('popup background: empty = theme default, invalid rejected', () => {
    expect(DEFAULT_SETTINGS.popup.background).toBe('');
    expect(sanitizeSettings({ popup: { background: '' } }).popup.background).toBe('');
    expect(sanitizeSettings({ popup: { background: 'red' } }).popup.background).toBe('');
    expect(sanitizeSettings({ popup: { background: '#FFFBEB' } }).popup.background).toBe('#fffbeb');
  });
  it('custom popup background picks readable text tokens from its luminance', () => {
    const light = popupSurface(mergeSettings(DEFAULT_SETTINGS, { popup: { background: '#fffbeb' } }), 'dark');
    expect(light.theme).toBe('light');
    expect(light.vars['--ml-surface']).toBe('255 251 235');
    const dark = popupSurface(mergeSettings(DEFAULT_SETTINGS, { popup: { background: '#3b0764' } }), 'light');
    expect(dark.theme).toBe('dark');
    const d = popupSurface(DEFAULT_SETTINGS, 'dark');
    expect(d.theme).toBe('light');
    expect(Object.keys(d.vars)).toEqual(expect.arrayContaining(['--ml-accent', '--ml-accent-fg', '--ml-text', '--ml-muted', '--ml-subtle'])); // accent + text tokens kept legible on the surface
    expect(popupSurface(mergeSettings(DEFAULT_SETTINGS, { popup: { theme: 'follow' } }), 'dark').theme).toBe('dark');
  });
});

describe('OCR bubble made only of function words', () => {
  it('falls back to listing every word so the popup is never empty', () => {
    expect(ocrWords("THAT'S")).toEqual([]);
    expect(ocrWords("THAT'S", true)).toEqual(["that's"]);
    expect(ocrWords('WHO DID IT !?', true)).toEqual(['who', 'did', 'it']);
  });
});

describe('sidebar appearance settings', () => {
  it('follows the UI theme by default; own theme and custom background are applied', async () => {
    const { sidebarSurface } = await import('@/ui/theme');
    expect(DEFAULT_SETTINGS.sidebar.theme).toBe('follow');
    expect(DEFAULT_SETTINGS.sidebar.background).toBe('');
    const d = sidebarSurface(DEFAULT_SETTINGS, 'dark');
    expect(d.theme).toBe('dark');
    expect(Object.keys(d.vars)).toEqual(expect.arrayContaining(['--ml-accent', '--ml-accent-fg', '--ml-text', '--ml-muted', '--ml-subtle']));
    expect(sidebarSurface(mergeSettings(DEFAULT_SETTINGS, { sidebar: { theme: 'light' } }), 'dark').theme).toBe('light');
    const cream = sidebarSurface(mergeSettings(DEFAULT_SETTINGS, { sidebar: { background: '#fffbeb' } }), 'dark');
    expect(cream.theme).toBe('light');
    expect(cream.vars['--ml-bg']).toBe('255 251 235');
    const navy = sidebarSurface(mergeSettings(DEFAULT_SETTINGS, { sidebar: { background: '#1e1b4b' } }), 'light');
    expect(navy.theme).toBe('dark');
    expect(sanitizeSettings({ sidebar: { theme: 'neon', background: 'blue' } }).sidebar).toMatchObject({ theme: 'follow', background: '' });
  });
});

describe('LingoLens logos and app appearance settings', () => {
  it('ships six styles of the same lens logo (incl. Kính trong); the default is Liquid Glass', async () => {
    const { LOGOS, logoById, DEFAULT_LOGO } = await import('@/ui/logo-data');
    expect(LOGOS.map((l) => l.id)).toEqual(['glass', 'clear', 'oil', 'sunset', 'clay', 'ink']);
    for (const l of LOGOS) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(typeof l.bg).toBe('function');
      expect(typeof l.fg).toBe('function');
    }
    expect(logoById('nope').id).toBe('glass');
    expect(DEFAULT_LOGO).toBe('glass');
    expect(DEFAULT_SETTINGS.appearance.logo).toBe('glass');
  });
  it('renders the chosen logo and validates logo / UI scale settings', async () => {
    const { LogoMark } = await import('@/ui/logos');
    expect(renderToStaticMarkup(<LogoMark id="clay" size={40} />)).toContain('data-ml-logo="clay"');
    expect(sanitizeSettings({ appearance: { logo: 'rocket', uiScale: 'huge' } }).appearance).toMatchObject({ logo: 'glass', uiScale: 'medium' });
    expect(sanitizeSettings({ appearance: { logo: 'ink', uiScale: 'large' } }).appearance).toMatchObject({ logo: 'ink', uiScale: 'large' });
  });
});
