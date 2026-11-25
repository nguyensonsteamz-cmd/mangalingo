/**
 * Data for the iPhone home-screen widget (see ios/LingoLensWidget). The saved words are cut down to what the widget shows (the word,
 * its pronunciation, its part of speech and the meaning) and sent to the app shell, which writes them where the widget can read them.
 * Nothing leaves the phone.
 */
import type { VocabEntry } from '@/shared/types';
import { POS_VI } from '@/ui/views';

export interface WidgetWordJson {
  w: string;
  ipa?: string;
  vi: string;
  /** part of speech, in Vietnamese ("danh từ") */
  p?: string;
}

/** one line, no "|" (the paste format separates fields with it) */
const oneLine = (s: string | undefined, max: number) => (s ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const posLabel = (pos: string | undefined): string => oneLine(pos ? ((POS_VI as Record<string, string>)[pos] ?? pos) : '', 30);

/** The words the widget may show: the ones not marked "known", newest first, cut to what fits a widget. */
export function widgetWords(entries: VocabEntry[], max = 300): WidgetWordJson[] {
  return entries
    .filter((e) => e.status !== 'known' && oneLine(e.word, 240))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max)
    .map((e) => {
      // whole sentences are kept (the widget wraps them), only absurd lengths are cut
      const w: WidgetWordJson = { w: oneLine(e.word, 240), vi: oneLine(e.meaning || e.translation, 300) };
      const ipa = oneLine(e.ipa, 40);
      const p = posLabel(e.pos);
      if (ipa) w.ipa = ipa;
      if (p) w.p = p;
      return w;
    });
}

/**
 * The text copied for the widget's paste field (the only way when the widget cannot read the app's data, e.g. a free Apple ID):
 * "word | ipa | meaning | part of speech" per word, words separated by " ¶ " so it survives a single-line text field.
 */
export function pasteText(words: WidgetWordJson[], max = 150): string {
  return words
    .slice(0, max)
    .map((x) => [x.w, x.ipa ?? '', x.vi, x.p ?? ''].join(' | ').replace(/( \| )+$/, '').replace(/ \|\s*$/, ''))
    .join(' ¶ ');
}

/** How the widget walks through the words every hour (Settings → Widget). Kept on the phone; sent to the widget with the words. */
export type WidgetOrder = 'random' | 'sequential';
const ORDER_KEY = 'lingolens:widgetOrder';
export const WIDGET_ORDER_EVENT = 'lingolens:widget-order';

export function getWidgetOrder(): WidgetOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === 'sequential' ? 'sequential' : 'random';
  } catch {
    return 'random';
  }
}

const INTERVAL_KEY = 'lingolens:widgetInterval';
/** minutes between two words (Settings → Widget) */
export const WIDGET_INTERVALS: { value: string; minutes: number; label: string }[] = [
  { value: '15', minutes: 15, label: '15 phút' },
  { value: '30', minutes: 30, label: '30 phút' },
  { value: '60', minutes: 60, label: '1 giờ' },
  { value: '120', minutes: 120, label: '2 giờ' },
  { value: '180', minutes: 180, label: '3 giờ' },
  { value: '360', minutes: 360, label: '6 giờ' },
  { value: '720', minutes: 720, label: '12 giờ' },
  { value: '1440', minutes: 1440, label: '1 ngày' },
];

export function getWidgetInterval(): number {
  try {
    const m = Number(localStorage.getItem(INTERVAL_KEY));
    return WIDGET_INTERVALS.some((x) => x.minutes === m) ? m : 60;
  } catch {
    return 60;
  }
}

export function setWidgetInterval(minutes: number): void {
  try {
    localStorage.setItem(INTERVAL_KEY, String(minutes));
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  window.dispatchEvent(new Event(WIDGET_ORDER_EVENT));
}

const THEME_KEY = 'lingolens:widgetTheme';

/** The look chosen in Settings → Widget (a WidgetThemeId); widgets set to "Theo cài đặt trong app" follow it. */
export function getWidgetTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) || 'white';
  } catch {
    return 'white';
  }
}

export function setWidgetTheme(id: string): void {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  window.dispatchEvent(new Event(WIDGET_ORDER_EVENT));
}

export function setWidgetOrder(o: WidgetOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, o);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  window.dispatchEvent(new Event(WIDGET_ORDER_EVENT)); // the words are sent again with the new order
}
