// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readAppTheme } from '@/mobile/app-theme';

const set = (el: HTMLElement, vars: Record<string, string>) => {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
};

describe('app theme for the Web Reader', () => {
  it('reads light/dark and the colours as "r g b"', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.dataset.theme = 'light';
    set(el, { '--ml-bg': '246 247 250', '--ml-surface': '255 255 255', '--ml-elevated': '241  243 247', '--ml-text': '24 27 35', '--ml-muted': '88 96 112', '--ml-border': '222 226 234', '--ml-accent': '52 81 209', '--ml-accent-fg': '255 255 255' });
    expect(readAppTheme(el)).toEqual({ light: true, bg: '246 247 250', surface: '255 255 255', elevated: '241 243 247', text: '24 27 35', muted: '88 96 112', border: '222 226 234', accent: '52 81 209', accentFg: '255 255 255' });
  });

  it('sends nothing while a colour is missing or malformed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    set(el, { '--ml-bg': 'red' });
    expect(readAppTheme(el)).toBeNull();
  });
});
