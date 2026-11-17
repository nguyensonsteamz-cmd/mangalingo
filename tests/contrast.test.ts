import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import { contrastRatio, hexToRgb, popupSurface, readableOn, sidebarSurface, TEXT_FLIP } from '@/ui/theme';

const rgbOf = (v: string) => v.split(' ').map(Number) as [number, number, number];

describe('text never melts into its background', () => {
  it('readableOn moves a too-close colour until the contrast reaches 4.5, and leaves a good one alone', () => {
    const lightBg: [number, number, number] = [255, 255, 255];
    const paleAccent: [number, number, number] = [230, 235, 255];
    expect(contrastRatio(paleAccent, lightBg)).toBeLessThan(2);
    expect(contrastRatio(readableOn(paleAccent, lightBg), lightBg)).toBeGreaterThanOrEqual(4.5);
    const darkBg: [number, number, number] = [20, 22, 30];
    const darkAccent: [number, number, number] = [30, 30, 90];
    expect(contrastRatio(readableOn(darkAccent, darkBg), darkBg)).toBeGreaterThanOrEqual(4.5);
    const good: [number, number, number] = [10, 10, 10];
    expect(readableOn(good, lightBg)).toEqual(good);
  });

  it('a custom popup colour of ANY brightness gets the text tone (light/dark) with the higher contrast', () => {
    for (let g = 0; g <= 255; g += 15) {
      const hex = '#' + [g, g, g].map((v) => v.toString(16).padStart(2, '0')).join('');
      const s = { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, background: hex } };
      const { theme } = popupSurface(s, 'dark');
      const bg = hexToRgb(hex);
      const text: [number, number, number] = theme === 'light' ? [10, 12, 20] : [255, 255, 255];
      const other: [number, number, number] = theme === 'light' ? [255, 255, 255] : [10, 12, 20];
      expect(contrastRatio(text, bg), hex).toBeGreaterThanOrEqual(contrastRatio(other, bg) - 0.01);
    }
    expect(TEXT_FLIP).toBeCloseTo(0.179, 3);
  });

  it('the accent used as text stays readable on a custom popup / sidebar colour', () => {
    for (const bg of ['#ffffff', '#f4f4f4', '#101010', '#7c9cff', '#ffe066', '#1a237e']) {
      const s = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, accent: '#7c9cff' }, popup: { ...DEFAULT_SETTINGS.popup, background: bg }, sidebar: { ...DEFAULT_SETTINGS.sidebar, background: bg } };
      for (const v of [popupSurface(s, 'dark').vars, sidebarSurface(s, 'dark').vars]) {
        expect(contrastRatio(rgbOf(v['--ml-accent']), hexToRgb(bg)), bg).toBeGreaterThanOrEqual(4.4);
      }
    }
  });

  it('clear glass is tinted to the theme and never thinner than the floor', () => {
    for (const theme of ['dark', 'light'] as const) {
      const s = { ...DEFAULT_SETTINGS, popup: { ...DEFAULT_SETTINGS.popup, material: 'clear' as const, background: '', theme } };
      const v = popupSurface(s, theme).vars;
      expect(Number(v['--ml-glass-alpha'])).toBeGreaterThanOrEqual(0.5);
      const surf = rgbOf(v['--ml-surface']);
      expect(theme === 'dark' ? surf[0] < 60 : surf[0] > 200).toBe(true);
    }
  });
});
