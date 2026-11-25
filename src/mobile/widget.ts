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
    .filter((e) => e.status !== 'known' && oneLine(e.word, 60))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max)
    .map((e) => {
      const w: WidgetWordJson = { w: oneLine(e.word, 60), vi: oneLine(e.meaning || e.translation, 110) };
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
