import { describe, expect, it } from 'vitest';
import { tokenize, normalizeWord, isMostlyUpper } from '@/language/tokenize';
import { extractWordAt, sentenceAround } from '@/language/word-at';
import { splitSentences } from '@/language/segment';
import { detectLanguage, isEnglishLike } from '@/language/detect';
import { lemmaCandidates, generateForms, plural, presentParticiple, regularPast } from '@/language/morphology';
import { expandContraction } from '@/language/lexicon';
import { isPastForm, isPastParticiple } from '@/language/irregular';
import { arpabetToIpa } from '@/dictionary/ipa';

const at = (text: string, marker: string, delta = 0) => extractWordAt(text, text.indexOf(marker) + delta)?.word;

describe('word extraction (click-to-lookup)', () => {
  it('returns the word under the caret, not its neighbours', () => {
    const t = 'The village was destroyed by the demon.';
    expect(at(t, 'village', 3)).toBe('village');
    expect(at(t, 'was', 0)).toBe('was');
    expect(at(t, 'demon', 4)).toBe('demon');
  });
  it('excludes punctuation and quotes', () => {
    expect(at('"Run!" he said.', 'Run', 1)).toBe('Run');
    expect(at('Wait... what?!', 'what', 2)).toBe('what');
    expect(at('(hello)', 'hello', 0)).toBe('hello');
    expect(at('the end.', 'end', 2)).toBe('end');
  });
  it('keeps contractions and curly apostrophes', () => {
    expect(at("I don't know", "don't", 3)).toBe("don't");
    expect(at('It’s fine', 'It’s', 1)).toBe('It’s');
    expect(at("rock'n'roll", 'rock', 1)).toBe("rock'n'roll");
  });
  it('keeps hyphenated compounds', () => {
    expect(at('a well-known ninja', 'well', 1)).toBe('well-known');
    expect(at('a well-known ninja', 'known', 2)).toBe('well-known');
  });
  it('handles clipped forms and abbreviations', () => {
    expect(at("Get 'em now", 'em', 0)).toBe("'em");
    expect(at("I'm goin' home", 'goin', 1)).toBe("goin'");
    expect(at('Made in the U.S. today', 'U.S.', 1)).toBe('U.S.');
  });
  it('returns the word when the caret is at its end, null on whitespace', () => {
    expect(at('hello world', ' ', 0)).toBe('hello');
    expect(extractWordAt('a   b', 2)).toBeNull();
    expect(extractWordAt('', 0)).toBeNull();
    expect(extractWordAt('!!!', 1)).toBeNull();
  });
  it('extracts the surrounding sentence as context', () => {
    const t = 'First sentence here. The bank of the river was muddy. Last one!';
    const s = t.indexOf('bank');
    expect(sentenceAround(t, s, s + 4)).toBe('The bank of the river was muddy.');
  });
});

describe('tokenizer & normalisation', () => {
  it('tokenizes words, numbers and punctuation', () => {
    const toks = tokenize("I've got 3 swords, dude!").filter((t) => t.type !== 'space');
    expect(toks.map((t) => [t.text, t.type])).toEqual([
      ["I've", 'word'], ['got', 'word'], ['3', 'num'], ['swords', 'word'], [',', 'punct'], ['dude', 'word'], ['!', 'punct'],
    ]);
  });
  it('normalizes case, apostrophes, possessives and stutters', () => {
    expect(normalizeWord('Naruto’s')).toBe('naruto');
    expect(normalizeWord("It's")).toBe("it's");
    expect(normalizeWord('W-what')).toBe('what');
    expect(normalizeWord('I-I')).toBe('i');
    expect(normalizeWord('end.')).toBe('end');
    expect(normalizeWord('players’')).toBe('players');
  });
  it('detects manga-style all caps', () => {
    expect(isMostlyUpper("WHAT THE HELL IS GOING ON?!")).toBe(true);
    expect(isMostlyUpper('What is going on')).toBe(false);
  });
});

describe('sentence segmentation', () => {
  const seg = (t: string) => splitSentences(t).map((s) => s.text);
  it('splits on terminal punctuation including ?! clusters and quotes', () => {
    expect(seg('Run! "Why?!" he asked. I don\'t know.')).toEqual(['Run!', '"Why?!"', 'he asked.', "I don't know."]);
  });
  it('does not split abbreviations, initials, decimals', () => {
    expect(seg('Mr. Smith met Dr. Jones at 3.30 p.m. today. Then he left.')).toEqual(['Mr. Smith met Dr. Jones at 3.30 p.m. today.', 'Then he left.']);
    expect(seg('J. K. Rowling wrote it. Yes.')).toEqual(['J. K. Rowling wrote it.', 'Yes.']);
    expect(seg('See e.g. this one. Done.')).toEqual(['See e.g. this one.', 'Done.']);
  });
  it('keeps ellipsis continuations together but splits before a new capitalised sentence', () => {
    expect(seg("I... I don't know. WHAT?! NO WAY...")).toEqual(["I... I don't know.", 'WHAT?!', 'NO WAY...']);
  });
  it('treats paragraph breaks as boundaries and keeps offsets', () => {
    const t = 'line one\n\nline two';
    const s = splitSentences(t);
    expect(s.map((x) => x.text)).toEqual(['line one', 'line two']);
    expect(t.slice(s[1].start, s[1].end)).toBe('line two');
  });
  it('handles long paragraphs quickly', () => {
    const para = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const t0 = performance.now();
    expect(splitSentences(para)).toHaveLength(400);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('language detection (local)', () => {
  it('detects English, including short and slangy text', () => {
    expect(detectLanguage("What the hell is going on here?").code).toBe('en');
    expect(detectLanguage('gonna').code).toBe('en');
    expect(detectLanguage('café').code).toBe('en'); // single word → English dictionary attempt
  });
  it('detects other languages by script or stop words', () => {
    expect(detectLanguage('Xin chào các bạn, hôm nay chúng ta sẽ học.').code).toBe('vi');
    expect(detectLanguage('Bonjour, je suis très content de vous voir.').code).toBe('fr');
    expect(detectLanguage('¿Qué estás haciendo con el perro? No lo sé.').code).toBe('es');
    expect(detectLanguage('Ich bin nicht sicher, aber das ist gut.').code).toBe('de');
    expect(detectLanguage('お前はもう死んでいる').code).toBe('ja');
    expect(detectLanguage('나는 학생입니다').code).toBe('ko');
    expect(detectLanguage('我们走吧').code).toBe('zh');
    expect(detectLanguage('Привет, как дела?').code).toBe('ru');
  });
  it('reports no-letter input as undetermined', () => {
    expect(detectLanguage('12345 !!!').code).toBe('und');
  });
  it('isEnglishLike accepts low-confidence Latin text', () => {
    expect(isEnglishLike(detectLanguage('ok'))).toBe(true);
    expect(isEnglishLike(detectLanguage('Bonjour, je suis très content de vous voir.'))).toBe(false);
  });
});

describe('morphology', () => {
  const lemmas = (w: string) => lemmaCandidates(w).map((c) => c.lemma);
  it('produces irregular and rule-based lemma candidates', () => {
    expect(lemmas('went')).toContain('go');
    expect(lemmas('children')).toContain('child');
    expect(lemmas('better')).toContain('good');
    expect(lemmas('stopped')).toContain('stop');
    expect(lemmas('running')).toContain('run');
    expect(lemmas('tries')).toContain('try');
    expect(lemmas('making')).toContain('make');
    expect(lemmas('boxes')).toContain('box');
    expect(lemmas("nothin'")).toContain('nothing');
    expect(lemmas("'em")).toContain('them');
  });
  it('generates word forms', () => {
    expect(regularPast('stop')).toBe('stopped');
    expect(regularPast('try')).toBe('tried');
    expect(presentParticiple('make')).toBe('making');
    expect(presentParticiple('die')).toBe('dying');
    expect(plural('city')).toBe('cities');
    expect(plural('child')).toBe('children');
    const f = Object.fromEntries(generateForms('go', ['verb']).map((x) => [x.label, x.form]));
    expect(f).toMatchObject({ past: 'went', 'past participle': 'gone', '-ing': 'going', '3rd person': 'goes' });
    const a = Object.fromEntries(generateForms('happy', ['adj']).map((x) => [x.label, x.form]));
    expect(a).toMatchObject({ comparative: 'happier', superlative: 'happiest' });
  });
  it('classifies past forms without false positives', () => {
    expect(isPastForm('walked')).toBe(true);
    expect(isPastForm('need')).toBe(false);
    expect(isPastForm('agreed')).toBe(true);
    expect(isPastParticiple('destroyed')).toBe(true);
    expect(isPastParticiple('taken')).toBe(true);
    expect(isPastParticiple('take')).toBe(false);
  });
  it('expands contractions and informal reductions', () => {
    expect(expandContraction("can't")?.parts).toEqual(['can', 'not']);
    expect(expandContraction("won't")?.parts).toEqual(['will', 'not']);
    expect(expandContraction("didn't")?.parts).toEqual(['did', 'not']);
    expect(expandContraction("they're")?.parts).toEqual(['they', 'are']);
    expect(expandContraction('gonna')).toMatchObject({ parts: ['going', 'to'], informal: true });
    expect(expandContraction("it's")?.parts).toEqual(['it', 'is']);
    expect(expandContraction("naruto's")).toBeNull(); // possessive, not "is"
  });
});

describe('ARPAbet → IPA', () => {
  it('maps phonemes and places stress marks', () => {
    expect(arpabetToIpa('G IH1 V')).toBe('/ɡɪv/');
    expect(arpabetToIpa('D IH0 S T R OY1 D')).toBe('/dɪˈstrɔɪd/');
    expect(arpabetToIpa('B AH0 N AE1 N AH0')).toBe('/bəˈnænə/');
    expect(arpabetToIpa('W AO1 T ER0')).toBe('/ˈwɔtɚ/');
    expect(arpabetToIpa('')).toBe('');
  });
});
