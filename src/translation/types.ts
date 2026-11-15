import type { ParagraphAnalysis, SentenceAnalysis } from '@/shared/types';

/**
 * A translation backend. Dictionary Mode (bundled) composes dictionary data and rules; future
 * providers (offline MT model, user-configured API) can implement the same interface without
 * changing the Dictionary Engine or the UI.
 */
export interface TranslationProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'dictionary' | 'machine';
  translateSentence(text: string): Promise<SentenceAnalysis>;
  translateParagraph(text: string): Promise<ParagraphAnalysis>;
}
