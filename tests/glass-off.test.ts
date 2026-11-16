import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings';
import { glassAttr, glassIsOff, popupSurface, themeVars } from '@/ui/theme';

const withGlass = (glass: boolean, material: Settings['popup']['material'] = 'glass'): Settings => ({
  ...DEFAULT_SETTINGS,
  appearance: { ...DEFAULT_SETTINGS.appearance, glass },
  popup: { ...DEFAULT_SETTINGS.popup, material },
});

describe('glass effect switch ("Hiệu ứng kính")', () => {
  it('on: no data-glass attribute, glass variables stay', () => {
    const s = withGlass(true);
    expect(glassAttr(s, 'page')).toEqual({});
    expect(themeVars(s, 'page')['--ml-glass-off']).toBe('0');
  });
  it('off: every surface (page, sidebar, popup) is flat', () => {
    const s = withGlass(false);
    for (const surface of ['page', 'sidebar', 'popup'] as const) {
      expect(glassIsOff(s, surface)).toBe(true);
      expect(glassAttr(s, surface)).toEqual({ 'data-glass': 'off' });
      expect(themeVars(s, surface)['--ml-glass-off']).toBe('1');
    }
  });
  it('the global switch beats a "clear glass" popup material', () => {
    const s = withGlass(false, 'clear');
    expect(themeVars(s, 'popup')['--ml-glass-off']).toBe('1');
    expect(popupSurface(s, 'dark').vars['--ml-glass-off']).toBe('1');
  });
  it('a solid popup material flattens only the popup', () => {
    const s = withGlass(true, 'solid');
    expect(glassAttr(s, 'popup')).toEqual({ 'data-glass': 'off' });
    expect(glassAttr(s, 'page')).toEqual({});
  });
});
