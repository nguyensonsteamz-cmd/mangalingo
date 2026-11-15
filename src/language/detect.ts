/**
 * Local language detection: Unicode script analysis first, then stop-word scoring for
 * Latin-script languages. No network, no model files. Short Latin text defaults to English
 * with low confidence because single-word lookups are by far the most common case.
 */
import type { LanguageResult } from '@/shared/types';

const NAMES: Record<string, string> = {
  en: 'English', vi: 'Tiếng Việt', fr: 'Français', es: 'Español', de: 'Deutsch', it: 'Italiano',
  pt: 'Português', nl: 'Nederlands', id: 'Bahasa Indonesia', ja: '日本語', zh: '中文', ko: '한국어',
  ru: 'Русский', th: 'ไทย', ar: 'العربية', hi: 'हिन्दी', el: 'Ελληνικά', he: 'עברית', und: 'Không xác định',
};

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'you', 'i', 'it', 'to', 'of', 'that', 'this', 'what', 'was', 'with', 'for',
    'not', "don't", "i'm", "it's", 'have', 'be', 'me', 'my', 'we', 'he', 'she', 'they', 'do', 'just', 'can',
    'will', 'your', 'there', 'so', 'but', 'no', 'yes', 'on', 'in', 'at', 'a', 'an', 'all', 'if', 'know', 'get'],
  fr: ['le', 'la', 'les', 'et', 'est', 'une', 'un', 'des', 'du', 'je', 'tu', 'il', 'elle', 'nous', 'vous',
    'pas', 'que', 'qui', 'dans', 'pour', 'avec', 'ce', 'mais', 'sur', 'au', 'aux', 'ne', 'mon', 'oui', 'très'],
  es: ['el', 'los', 'las', 'y', 'es', 'una', 'un', 'que', 'de', 'yo', 'tú', 'él', 'ella', 'no', 'por', 'para',
    'con', 'pero', 'muy', 'está', 'qué', 'sí', 'del', 'se', 'lo', 'mi', 'como', 'más', 'hay', 'soy'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'nicht', 'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'mit',
    'für', 'auf', 'den', 'dem', 'zu', 'aber', 'auch', 'was', 'wie', 'ja', 'nein', 'sehr', 'noch', 'bin', 'hast'],
  it: ['il', 'lo', 'gli', 'e', 'è', 'una', 'che', 'di', 'io', 'tu', 'lui', 'lei', 'non', 'per', 'con', 'ma',
    'sono', 'sei', 'molto', 'questo', 'della', 'del', 'anche', 'come', 'cosa', 'perché', 'ciao', 'grazie'],
  pt: ['o', 'os', 'as', 'e', 'é', 'uma', 'um', 'que', 'de', 'eu', 'você', 'ele', 'ela', 'não', 'por', 'para',
    'com', 'mas', 'muito', 'está', 'sim', 'do', 'da', 'se', 'meu', 'como', 'mais', 'tem', 'sou', 'isso'],
  nl: ['de', 'het', 'een', 'en', 'is', 'niet', 'ik', 'jij', 'je', 'hij', 'zij', 'wij', 'met', 'voor', 'op',
    'maar', 'ook', 'wat', 'hoe', 'ja', 'nee', 'heel', 'nog', 'ben', 'heb', 'dat', 'dit', 'van', 'zijn'],
  id: ['yang', 'dan', 'di', 'ini', 'itu', 'aku', 'kamu', 'dia', 'kami', 'tidak', 'ada', 'untuk', 'dengan',
    'saya', 'apa', 'ke', 'dari', 'juga', 'sudah', 'belum', 'bisa', 'akan', 'mau', 'ya', 'tapi', 'karena'],
  vi: ['và', 'của', 'là', 'không', 'có', 'người', 'này', 'tôi', 'bạn', 'anh', 'em', 'được', 'cho', 'một',
    'những', 'các', 'với', 'đã', 'sẽ', 'thì', 'mà', 'cũng', 'rồi', 'nhưng', 'vì', 'khi', 'đó', 'ở', 'gì', 'nào'],
};

const STOP_SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)]));

const SCRIPTS: [RegExp, string, string][] = [
  [/[぀-ヿ]/u, 'ja', 'Kana'],
  [/[가-힯ᄀ-ᇿ]/u, 'ko', 'Hangul'],
  [/[一-鿿㐀-䶿]/u, 'zh', 'Han'],
  [/[Ѐ-ӿ]/u, 'ru', 'Cyrillic'],
  [/[฀-๿]/u, 'th', 'Thai'],
  [/[؀-ۿ]/u, 'ar', 'Arabic'],
  [/[ऀ-ॿ]/u, 'hi', 'Devanagari'],
  [/[Ͱ-Ͽ]/u, 'el', 'Greek'],
  [/[֐-׿]/u, 'he', 'Hebrew'],
];

// Letters that exist only in Vietnamese orthography (among the languages we score).
const VI_LETTERS = /[ăơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu;

function result(code: string, confidence: number, script: string, method: string): LanguageResult {
  return { code, name: NAMES[code] ?? code, confidence: Math.round(confidence * 100) / 100, script, method };
}

export function detectLanguage(input: string): LanguageResult {
  const text = input.normalize('NFC');
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return result('und', 0, 'none', 'no-letters');

  // 1. Non-Latin scripts dominate → decide by script share.
  const counts = new Map<string, number>();
  for (const ch of letters) {
    for (const [re, code] of SCRIPTS) {
      if (re.test(ch)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        break;
      }
    }
  }
  // Japanese text mixes Han and Kana; any Kana means Japanese.
  if ((counts.get('ja') ?? 0) > 0 && (counts.get('ja')! + (counts.get('zh') ?? 0)) / letters.length > 0.3) {
    return result('ja', 0.9, 'Kana/Han', 'script');
  }
  for (const [re, code, script] of SCRIPTS) {
    void re;
    const c = counts.get(code) ?? 0;
    if (c / letters.length > 0.4) return result(code, Math.min(0.98, 0.6 + c / letters.length / 2), script, 'script');
  }

  // 2. Latin script.
  const tokens = (text.toLowerCase().match(/[\p{L}']+/gu) ?? []).map((t) => t.replace(/’/g, "'"));
  const viMarks = (text.match(new RegExp(VI_LETTERS.source, 'giu')) ?? []).length;
  if (viMarks >= 2 || (viMarks >= 1 && tokens.length <= 3)) {
    return result('vi', Math.min(0.97, 0.6 + viMarks / Math.max(4, tokens.length)), 'Latin', 'vietnamese-letters');
  }

  const scores: [string, number][] = Object.entries(STOP_SETS).map(([code, set]) => {
    let hits = 0;
    for (const t of tokens) if (set.has(t)) hits++;
    return [code, hits];
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, bestHits] = scores[0];
  const enHits = scores.find(([c]) => c === 'en')![1];

  if (tokens.length <= 3) {
    // Too short for statistics: single words are treated as English unless clearly foreign.
    if (best !== 'en' && bestHits >= 2 && enHits === 0) return result(best, 0.55, 'Latin', 'stopwords-short');
    return result('en', 0.5, 'Latin', 'short-text-default');
  }
  if (bestHits === 0) return result('en', 0.4, 'Latin', 'latin-default');
  if (best === 'en' || enHits >= bestHits) {
    return result('en', Math.min(0.99, 0.55 + enHits / tokens.length), 'Latin', 'stopwords');
  }
  const margin = (bestHits - enHits) / tokens.length;
  return result(best, Math.min(0.95, 0.5 + margin * 2), 'Latin', 'stopwords');
}

export function isEnglishLike(r: LanguageResult): boolean {
  return r.code === 'en' || r.code === 'und' || (r.confidence < 0.6 && r.script === 'Latin');
}
