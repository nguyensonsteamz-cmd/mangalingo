/**
 * Converts CMUdict ARPAbet transcriptions (General American) to IPA.
 * Deterministic phoneme mapping + stress marks placed before the maximal legal onset.
 * NOTE: this file must stay dependency-free – it is imported by scripts/build-data.mjs via Node.
 */

const VOWELS: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i',
  OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
};
const CONSONANTS: Record<string, string> = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n',
  NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

// Legal English syllable onsets (ARPAbet), used to place stress marks.
const ONSETS = new Set([
  'P R', 'P L', 'B R', 'B L', 'T R', 'T W', 'D R', 'D W', 'K R', 'K L', 'K W', 'G R', 'G L', 'G W', 'F R', 'F L',
  'TH R', 'TH W', 'SH R', 'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F', 'S P R', 'S P L', 'S T R', 'S K R',
  'S K W', 'S K L', 'P Y', 'B Y', 'K Y', 'F Y', 'M Y', 'V Y', 'HH Y', 'G Y', 'S Y', 'T Y', 'D Y', 'N Y', 'L Y', 'S K Y',
  'S P Y', 'S M Y', 'V R', 'HH W',
]);

export function arpabetToIpa(arpabet: string): string {
  const phones = arpabet.trim().split(/\s+/).filter(Boolean);
  if (phones.length === 0) return '';
  const parsed = phones.map((p) => {
    const m = p.match(/^([A-Z]+)([012])?$/);
    if (!m) return { base: p, stress: undefined as number | undefined, vowel: false };
    return { base: m[1], stress: m[2] === undefined ? undefined : Number(m[2]), vowel: m[1] in VOWELS };
  });
  const vowelCount = parsed.filter((p) => p.vowel).length;
  const marks: string[] = new Array(parsed.length).fill('');

  if (vowelCount > 1) {
    let prevVowel = -1;
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (!p.vowel) continue;
      if (p.stress === 1 || p.stress === 2) {
        // consonants between previous vowel and this vowel
        const cons: number[] = [];
        for (let j = prevVowel + 1; j < i; j++) cons.push(j);
        let onsetStart = i;
        for (let k = 0; k < cons.length; k++) {
          const cluster = cons.slice(k).map((c) => parsed[c].base).join(' ');
          if (cons.length - k === 1 || ONSETS.has(cluster)) {
            onsetStart = cons[k];
            break;
          }
        }
        if (prevVowel === -1) onsetStart = 0;
        marks[onsetStart] = (p.stress === 1 ? 'ˈ' : 'ˌ') + marks[onsetStart];
      }
      prevVowel = i;
    }
  }

  let out = '';
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    out += marks[i];
    if (p.vowel) {
      if (p.base === 'AH' && p.stress === 0) out += 'ə';
      else if (p.base === 'ER' && p.stress === 0) out += 'ɚ';
      else if (p.base === 'IH' && p.stress === 0 && i === parsed.length - 1) out += 'i';
      else out += VOWELS[p.base];
    } else {
      out += CONSONANTS[p.base] ?? p.base.toLowerCase();
    }
  }
  return `/${out}/`;
}
