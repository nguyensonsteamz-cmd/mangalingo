/**
 * Settings schema: defaults + validation rules. Every value read from storage goes through
 * `sanitizeSettings`, so corrupted or out-of-range data can never reach the UI.
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type PopupPosition = 'auto' | 'below' | 'above';
export type PopupTheme = 'follow' | 'light' | 'dark';
export type AutoClose = 'off' | 'scroll' | 'leave' | 'timer';
export type ClickModifier = 'none' | 'alt' | 'ctrl' | 'shift';
export type FontFamily = 'system' | 'sans' | 'serif' | 'readable' | 'mono';
export type SidebarTab = 'translation' | 'vocabulary' | 'grammar' | 'context' | 'saved';
export type OcrLayout = 'sparse' | 'auto' | 'block';
export type OcrTrigger = 'hover' | 'manual';
export type ContentWidth = 'full' | 'comfortable' | 'narrow';

export interface Settings {
  /**
   * LingoLens is OFF by default and only works on the sites the user switched it on for
   * (toolbar popup → "Bật trên trang này"). `enabled` is a global pause for all of them.
   */
  general: { enabled: boolean; sites: string[] };
  appearance: {
    theme: ThemeMode;
    accent: string;
    /** App logo (in the UI, the app icon on phones, the Chrome toolbar icon). */
    logo: 'glass' | 'clear' | 'oil' | 'sunset' | 'clay' | 'ink';
    /** Size of the phone app's interface (text, buttons). */
    uiScale: 'small' | 'medium' | 'large';
    /** Liquid Glass material (translucent, blurred panels); off = opaque panels. */
    glass: boolean;
    /** Background of the app pages (side panel, settings, toolbar popup, phone app). */
    background: 'ambient' | 'vivid' | 'plain';
    /** Colour of the glass selection pill (active tab, chosen option); '' = the accent colour. */
    selectColor: string;
  };
  popup: {
    enabled: boolean;
    width: number;
    /** Popup colour scheme in web pages: 'follow' = same as appearance.theme. */
    theme: PopupTheme;
    /** Custom popup background (#rrggbb); '' = the theme's default surface. */
    background: string;
    /** Popup material on web pages: tinted Liquid Glass, clear glass (like the "Kính trong" logo) or solid. */
    material: 'glass' | 'clear' | 'solid';
    /** Opacity of the popup glass tint, 0.05–0.95; 0 = the material's own value. */
    glassAlpha: number;
    fontSize: number; // 0 = follow typography
    position: PopupPosition;
    opacity: number;
    animation: boolean;
    autoClose: AutoClose;
    autoCloseSeconds: number;
    sections: { meaning: boolean; context: boolean; examples: boolean; grammar: boolean };
  };
  sidebar: {
    enabled: boolean;
    defaultState: 'expanded' | 'compact';
    width: ContentWidth;
    fontSize: number; // 0 = follow typography
    defaultTab: SidebarTab;
    /** Sidebar colour scheme: 'follow' = same as appearance.theme. */
    theme: PopupTheme;
    /** Custom sidebar background (#rrggbb); '' = the theme's default. */
    background: string;
  };
  typography: {
    fontFamily: FontFamily;
    fontSize: number;
    lineHeight: number;
    wordSpacing: number;
    translationSize: number;
  };
  dictionary: {
    showIpa: boolean;
    showPronunciation: boolean;
    showExamples: boolean;
    showSynonyms: boolean;
    showAntonyms: boolean;
    showCollocations: boolean;
    showPos: boolean;
    showEnglishDefinition: boolean;
  };
  reading: {
    clickLookup: boolean;
    clickModifier: ClickModifier;
    selectLookup: boolean;
    autoDetectLanguage: boolean;
    targetLanguage: 'vi' | 'en';
    autoPopup: boolean;
    /** 'machine': natural EN→VI translation via Chrome's on-device Translator API, shown above the
     *  dictionary gloss (default). 'dictionary': dictionary gloss only. */
    translationMode: 'machine' | 'dictionary';
    ignoredSites: string[];
  };
  ocr: {
    enabled: boolean;
    language: 'eng';
    trigger: OcrTrigger;
    layout: OcrLayout;
    showBoxes: boolean;
    /** Colour of the OCR speech-bubble boxes (#rrggbb). */
    boxColor: string;
    confidenceThreshold: number;
    autoCache: boolean;
    minImageSize: number;
  };
  shortcuts: { closePopup: 'Escape' | 'q' | 'x' };
}

export const DEFAULT_SETTINGS: Settings = {
  general: { enabled: true, sites: [] },
  appearance: { theme: 'dark', accent: '#7c9cff', logo: 'glass', uiScale: 'medium', glass: true, background: 'ambient', selectColor: '' },
  popup: {
    enabled: true,
    width: 380,
    theme: 'light',
    background: '',
    material: 'glass',
    glassAlpha: 0,
    fontSize: 0,
    position: 'auto',
    opacity: 1,
    animation: true,
    autoClose: 'off',
    autoCloseSeconds: 8,
    sections: { meaning: true, context: true, examples: true, grammar: true },
  },
  sidebar: { enabled: true, defaultState: 'expanded', width: 'full', fontSize: 0, defaultTab: 'translation', theme: 'follow', background: '' },
  typography: { fontFamily: 'system', fontSize: 14, lineHeight: 1.55, wordSpacing: 0, translationSize: 15 },
  dictionary: {
    showIpa: true,
    showPronunciation: true,
    showExamples: true,
    showSynonyms: true,
    showAntonyms: true,
    showCollocations: true,
    showPos: true,
    showEnglishDefinition: true,
  },
  reading: {
    clickLookup: true,
    clickModifier: 'none',
    selectLookup: true,
    autoDetectLanguage: true,
    targetLanguage: 'vi',
    autoPopup: true,
    translationMode: 'machine',
    ignoredSites: [],
  },
  ocr: {
    enabled: true,
    language: 'eng',
    trigger: 'hover',
    layout: 'sparse',
    showBoxes: true,
    boxColor: '#f97316',
    confidenceThreshold: 45,
    autoCache: true,
    minImageSize: 220,
  },
  shortcuts: { closePopup: 'Escape' },
};

type Rule =
  | { t: 'bool' }
  | { t: 'num'; min: number; max: number; int?: boolean }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'color'; optional?: boolean }
  | { t: 'hosts' };

/** Validation rules keyed by dotted path. Paths missing here fall back to the default value's type. */
export const RULES: Record<string, Rule> = {
  'appearance.theme': { t: 'enum', values: ['dark', 'light', 'system'] },
  'appearance.accent': { t: 'color' },
  'appearance.logo': { t: 'enum', values: ['glass', 'clear', 'oil', 'sunset', 'clay', 'ink'] },
  'appearance.background': { t: 'enum', values: ['ambient', 'vivid', 'plain'] },
  'popup.material': { t: 'enum', values: ['glass', 'clear', 'solid'] },
  'popup.glassAlpha': { t: 'num', min: 0, max: 0.95 },
  'appearance.selectColor': { t: 'color', optional: true },
  'appearance.uiScale': { t: 'enum', values: ['small', 'medium', 'large'] },
  'popup.width': { t: 'num', min: 300, max: 600, int: true },
  'popup.background': { t: 'color', optional: true },
  'ocr.boxColor': { t: 'color' },
  'reading.translationMode': { t: 'enum', values: ['machine', 'dictionary'] },
  'general.sites': { t: 'hosts' },
  'popup.theme': { t: 'enum', values: ['follow', 'light', 'dark'] },
  'popup.fontSize': { t: 'num', min: 0, max: 22, int: true },
  'popup.position': { t: 'enum', values: ['auto', 'below', 'above'] },
  'popup.opacity': { t: 'num', min: 0.7, max: 1 },
  'popup.autoClose': { t: 'enum', values: ['off', 'scroll', 'leave', 'timer'] },
  'popup.autoCloseSeconds': { t: 'num', min: 2, max: 60, int: true },
  'sidebar.defaultState': { t: 'enum', values: ['expanded', 'compact'] },
  'sidebar.width': { t: 'enum', values: ['full', 'comfortable', 'narrow'] },
  'sidebar.fontSize': { t: 'num', min: 0, max: 22, int: true },
  'sidebar.theme': { t: 'enum', values: ['follow', 'light', 'dark'] },
  'sidebar.background': { t: 'color', optional: true },
  'sidebar.defaultTab': { t: 'enum', values: ['translation', 'vocabulary', 'grammar', 'context', 'saved'] },
  'typography.fontFamily': { t: 'enum', values: ['system', 'sans', 'serif', 'readable', 'mono'] },
  'typography.fontSize': { t: 'num', min: 11, max: 22, int: true },
  'typography.lineHeight': { t: 'num', min: 1.1, max: 2.2 },
  'typography.wordSpacing': { t: 'num', min: 0, max: 8 },
  'typography.translationSize': { t: 'num', min: 11, max: 26, int: true },
  'reading.clickModifier': { t: 'enum', values: ['none', 'alt', 'ctrl', 'shift'] },
  'reading.targetLanguage': { t: 'enum', values: ['vi', 'en'] },
  'reading.ignoredSites': { t: 'hosts' },
  'ocr.language': { t: 'enum', values: ['eng'] },
  'ocr.trigger': { t: 'enum', values: ['hover', 'manual'] },
  'ocr.layout': { t: 'enum', values: ['sparse', 'auto', 'block'] },
  'ocr.confidenceThreshold': { t: 'num', min: 0, max: 95, int: true },
  'ocr.minImageSize': { t: 'num', min: 80, max: 1200, int: true },
  'shortcuts.closePopup': { t: 'enum', values: ['Escape', 'q', 'x'] },
};

export function normalizeHost(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '');
  if (!/^[a-z0-9.-]+$/.test(s) || s.length > 253 || s.startsWith('.') || s.endsWith('.')) return null;
  return s;
}

function sanitizeValue(rule: Rule | undefined, value: unknown, fallback: unknown): unknown {
  if (!rule) {
    if (typeof fallback === 'boolean') rule = { t: 'bool' };
    else return typeof value === typeof fallback ? value : fallback;
  }
  switch (rule.t) {
    case 'bool':
      return typeof value === 'boolean' ? value : fallback;
    case 'num': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isFinite(n)) return fallback;
      const c = Math.min(rule.max, Math.max(rule.min, n));
      return rule.int ? Math.round(c) : Math.round(c * 100) / 100;
    }
    case 'enum':
      return typeof value === 'string' && rule.values.includes(value) ? value : fallback;
    case 'color':
      if (rule.optional && value === '') return '';
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
    case 'hosts': {
      if (!Array.isArray(value)) return fallback;
      const out = new Set<string>();
      for (const v of value) {
        if (typeof v !== 'string') continue;
        const h = normalizeHost(v);
        if (h) out.add(h);
        if (out.size >= 500) break;
      }
      return [...out];
    }
  }
}

function walk(defaults: Record<string, unknown>, input: unknown, prefix: string): Record<string, unknown> {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(defaults)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      out[key] = walk(def as Record<string, unknown>, src[key], path);
    } else {
      out[key] = sanitizeValue(RULES[path], src[key], def);
    }
  }
  return out;
}

/** Returns a complete, valid Settings object from arbitrary (possibly partial/corrupt) input. */
export function sanitizeSettings(input: unknown): Settings {
  return walk(DEFAULT_SETTINGS as unknown as Record<string, unknown>, input, '') as unknown as Settings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (!b) return a;
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') {
        out[k] = merge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else if (v !== undefined) out[k] = v;
    }
    return out;
  };
  return sanitizeSettings(merge(base as unknown as Record<string, unknown>, patch as Record<string, unknown>));
}

/** True when `hostname` is `list` entry or one of its subdomains. */
export function hostListed(list: string[], hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return list.some((e) => {
    const s = e.replace(/^www\./, '');
    return h === s || h.endsWith(`.${s}`);
  });
}

/** True when LingoLens is switched on for this site (allow-list) and not paused. */
export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  return settings.general.enabled && hostListed(settings.general.sites, hostname) && !isSiteIgnored(settings, hostname);
}

/** True when LingoLens must stay inactive on this page (not switched on for this site, or paused). */
export function isInactive(settings: Settings, hostname: string): boolean {
  return !isSiteEnabled(settings, hostname);
}

export function isSiteIgnored(settings: Settings, hostname: string): boolean {
  const h = hostname.toLowerCase();
  return settings.reading.ignoredSites.some((s) => h === s || h.endsWith(`.${s}`));
}

export const FONT_STACKS: Record<FontFamily, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  sans: '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  readable: 'Verdana, "Segoe UI", Tahoma, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
};
