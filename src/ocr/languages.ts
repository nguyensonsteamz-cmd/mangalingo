/**
 * OCR language registry. Only `eng` is bundled in v0.1; the registry exists so additional
 * traineddata (e.g. jpn_vert for vertical Japanese, kor, chi_sim) can be added by dropping the
 * file into vendor/tesseract/lang and flipping `bundled`.
 */
export interface OcrLanguage {
  code: string;
  name: string;
  bundled: boolean;
  vertical?: boolean;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', name: 'English (horizontal)', bundled: true },
  { code: 'jpn_vert', name: 'Japanese (vertical) – not bundled', bundled: false, vertical: true },
  { code: 'kor', name: 'Korean – not bundled', bundled: false },
  { code: 'chi_sim', name: 'Chinese (simplified) – not bundled', bundled: false },
];

export const isBundled = (code: string) => OCR_LANGUAGES.some((l) => l.code === code && l.bundled);
