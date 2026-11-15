import { FONT_STACKS, type Settings } from '@/shared/settings';

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [124, 156, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick dark or light text on the accent colour. */
export function accentForeground(rgb: [number, number, number]): string {
  return luminance(rgb) > 0.35 ? '10 12 20' : '255 255 255';
}

const mix = (a: [number, number, number], b: [number, number, number], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(' ');

/**
 * Popup colours: the popup theme ('follow' = page UI theme) or a custom background colour. For a
 * custom colour the text scheme (light/dark tokens) is chosen from its luminance so text stays
 * readable, and the elevated/border tones are derived from it.
 */
export function popupSurface(s: Settings, pageTheme: 'dark' | 'light'): { theme: 'dark' | 'light'; vars: Record<string, string> } {
  const bg = s.popup.background;
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return { theme: s.popup.theme === 'follow' ? pageTheme : s.popup.theme, vars: {} };
  const rgb = hexToRgb(bg);
  const light = luminance(rgb) > 0.4;
  const toward: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255];
  return {
    theme: light ? 'light' : 'dark',
    vars: { '--ml-surface': rgb.join(' '), '--ml-elevated': mix(rgb, toward, 0.06), '--ml-border': mix(rgb, toward, 0.16) },
  };
}

export function resolveTheme(mode: Settings['appearance']['theme'], prefersDark: boolean): 'dark' | 'light' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** CSS custom properties derived from settings; `surface` picks the font-size override. */
export function themeVars(s: Settings, surface: 'popup' | 'sidebar' | 'page'): Record<string, string> {
  const rgb = hexToRgb(s.appearance.accent);
  const override = surface === 'popup' ? s.popup.fontSize : surface === 'sidebar' ? s.sidebar.fontSize : 0;
  const size = override || s.typography.fontSize;
  return {
    '--ml-accent': rgb.join(' '),
    '--ml-accent-fg': accentForeground(rgb),
    '--ml-box': hexToRgb(s.ocr.boxColor).join(' '),
    '--ml-font': FONT_STACKS[s.typography.fontFamily],
    '--ml-size': `${size}px`,
    '--ml-line': String(s.typography.lineHeight),
    '--ml-wordspace': `${s.typography.wordSpacing}px`,
    '--ml-tr-size': `${Math.max(size, s.typography.translationSize)}px`,
    '--ml-anim': s.popup.animation ? '140ms' : '0ms',
  };
}

/**
 * Sidebar colours: its own theme ('follow' = page UI theme) or a custom background. With a custom
 * colour the light/dark text tokens are chosen from its luminance, and cards / borders are derived.
 */
export function sidebarSurface(s: Settings, pageTheme: 'dark' | 'light'): { theme: 'dark' | 'light'; vars: Record<string, string> } {
  const bg = s.sidebar.background;
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return { theme: s.sidebar.theme === 'follow' ? pageTheme : s.sidebar.theme, vars: {} };
  const rgb = hexToRgb(bg);
  const light = luminance(rgb) > 0.4;
  const contrast: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255];
  return {
    theme: light ? 'light' : 'dark',
    vars: {
      '--ml-bg': rgb.join(' '),
      '--ml-surface': light ? mix(rgb, [255, 255, 255], 0.55) : mix(rgb, contrast, 0.05),
      '--ml-elevated': mix(rgb, contrast, light ? 0.05 : 0.1),
      '--ml-border': mix(rgb, contrast, light ? 0.14 : 0.2),
    },
  };
}

const SURFACE_KEYS = ['--ml-bg', '--ml-surface', '--ml-elevated', '--ml-border'];

/** Applies theme + vars to a page's <html> (side panel, options). */
export function applyPageTheme(s: Settings, surface: 'sidebar' | 'page') {
  const root = document.documentElement;
  const pageTheme = resolveTheme(s.appearance.theme, prefersDark());
  const sb = surface === 'sidebar' ? sidebarSurface(s, pageTheme) : { theme: pageTheme, vars: {} as Record<string, string> };
  root.dataset.theme = sb.theme;
  for (const k of SURFACE_KEYS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries({ ...themeVars(s, surface), ...sb.vars })) root.style.setProperty(k, v);
}
