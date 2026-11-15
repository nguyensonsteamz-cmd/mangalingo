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
 * Popup material (Settings → Floating Popup → Chất liệu popup), as CSS variables on the popup:
 *   glass = tinted Liquid Glass (theme default), clear = clear white glass like the "Kính trong"
 *   logo (12 % white, blur, grey hairline), solid = opaque, no blur.
 */
export function popupMaterialVars(material: Settings['popup']['material'], alpha = 0): Record<string, string> {
  if (material === 'solid') return { '--ml-glass-off': '1' };
  // Độ đục của kính (0 = the material's own value)
  const custom: Record<string, string> = alpha > 0 ? { '--ml-glass-alpha': String(alpha), '--ml-glass-card-alpha': String(Math.max(0.06, alpha * 0.8)) } : {};
  if (material === 'clear') {
    return {
      '--ml-surface': '255 255 255',
      '--ml-glass-alpha': '0.12',
      '--ml-glass-card-alpha': '0.1',
      '--ml-glass-edge': '72 80 98',
      '--ml-glass-edge-a': '0.45',
      '--ml-glass-hi': '0.7',
      '--ml-glass-blur': '18px',
      '--ml-glass-off': '0',
      ...custom,
    };
  }
  return custom;
}

/**
 * Popup colours: the popup theme ('follow' = page UI theme) or a custom background colour. For a
 * custom colour the text scheme (light/dark tokens) is chosen from its luminance so text stays
 * readable, and the elevated/border tones are derived from it.
 */
export function popupSurface(s: Settings, pageTheme: 'dark' | 'light'): { theme: 'dark' | 'light'; vars: Record<string, string> } {
  const bg = s.popup.background;
  const material = popupMaterialVars(s.popup.material, s.popup.glassAlpha);
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return { theme: s.popup.theme === 'follow' ? pageTheme : s.popup.theme, vars: material };
  const rgb = hexToRgb(bg);
  const light = luminance(rgb) > 0.4;
  const toward: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255];
  return {
    theme: light ? 'light' : 'dark',
    vars: { ...material, '--ml-surface': rgb.join(' '), '--ml-elevated': mix(rgb, toward, 0.06), '--ml-border': mix(rgb, toward, 0.16) },
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
/** Text colour on the selection pill: the selection colour itself, darkened / lightened for contrast. */
function selectionText(sel: [number, number, number]): string {
  const l = luminance(sel);
  if (l > 0.55) return mix(sel, [0, 0, 0], 0.55);
  return sel.join(' ');
}

export function themeVars(s: Settings, surface: 'popup' | 'sidebar' | 'page'): Record<string, string> {
  const rgb = hexToRgb(s.appearance.accent);
  const sel = /^#[0-9a-f]{6}$/i.test(s.appearance.selectColor) ? hexToRgb(s.appearance.selectColor) : rgb;
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
    '--ml-anim': s.popup.animation ? '320ms' : '0ms',
    '--ml-glass-off': s.appearance.glass ? '0' : '1',
    '--ml-sel': sel.join(' '),
    '--ml-sel-text': selectionText(sel),
    // in-page floating bits (toast, OCR pills, selection button) follow the popup material
    ...(surface === 'popup' ? popupMaterialVars(s.popup.material, s.popup.glassAlpha) : {}),
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
  root.dataset.bg = s.appearance.background;
  for (const k of SURFACE_KEYS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries({ ...themeVars(s, surface), ...sb.vars })) root.style.setProperty(k, v);
}
