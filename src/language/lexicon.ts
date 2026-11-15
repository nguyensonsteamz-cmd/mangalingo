/**
 * Closed-class English words and contraction expansions. These are finite, well-documented lists
 * (grammar reference material), so the tagger can rely on them before guessing open-class words.
 */

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

export const SUBJECT_PRONOUNS = set('i you he she it we they one');
export const PRONOUNS = set(
  'i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves y\'all ya someone somebody something anyone anybody anything everyone everybody everything nobody nothing none one ones this these those',
);
export const POSSESSIVE_DETERMINERS = set('my your his her its our their');
export const DETERMINERS = set(
  'the a an this that these those my your his her its our their some any no every each either neither another other such what which whose all both half several many much few little more most less least enough',
);
export const PREPOSITIONS = set(
  'about above across after against along amid among around as at before behind below beneath beside besides between beyond by despite down during except for from in inside into like near of off on onto out outside over past per since than through throughout till to toward towards under underneath unlike until up upon via with within without',
);
export const COORDINATORS = set('and but or nor so yet');
export const SUBORDINATORS = set(
  'because although though if unless when whenever while whereas since until till before after once as whether that so lest',
);
export const RELATIVES = set('who whom whose which that where when');
export const WH_WORDS = set('what where when why who whom whose which how');
export const MODALS = set('can could may might must shall should will would ought');
export const BE_FORMS = set('be am is are was were been being');
export const HAVE_FORMS = set('have has had having');
export const DO_FORMS = set('do does did doing done');
export const NEGATIONS = set('not never no nobody nothing nowhere none neither nor');
export const INTERJECTIONS = set(
  'oh ah ahh uh um umm hmm huh hey hi hello wow whoa ouch oops yay ugh eh ha haha hahaha yo yeah yep yup nope nah ok okay alright damn dammit geez jeez gosh shh psst ew eww aw aww phew boo yikes argh grr bye goodbye please thanks wha',
);
export const PARTICLES = set('up down out off in on away back over through around about along by forward apart aside together');
export const LINKING_VERBS = set('be seem become look feel sound smell taste appear remain stay get grow turn prove');
export const ADVERBS = set(
  'very really too so quite rather just only also even still already yet again always never often sometimes usually here there now then soon later today tomorrow tonight yesterday maybe perhaps probably definitely actually literally seriously totally almost nearly ever once twice away back ago else instead anyway somehow anymore together alone right well',
);
export const NUMBERS = set('zero one two three four five six seven eight nine ten eleven twelve hundred thousand million first second third');

export interface Expansion {
  parts: string[];
  note: string;
  informal?: boolean;
}

/** Whole-token contractions and colloquial reductions, expanded for grammar analysis. */
export const CONTRACTIONS: Record<string, Expansion> = {
  "can't": { parts: ['can', 'not'], note: "can't = cannot" },
  "won't": { parts: ['will', 'not'], note: "won't = will not" },
  "shan't": { parts: ['shall', 'not'], note: "shan't = shall not" },
  "ain't": { parts: ['is', 'not'], note: "ain't = am/is/are not, hoặc have/has not (khẩu ngữ, không chuẩn)", informal: true },
  "i'm": { parts: ['i', 'am'], note: "I'm = I am" },
  "let's": { parts: ['let', 'us'], note: "let's = let us (rủ rê: hãy cùng…)" },
  gonna: { parts: ['going', 'to'], note: 'gonna = going to (khẩu ngữ)', informal: true },
  wanna: { parts: ['want', 'to'], note: 'wanna = want to (khẩu ngữ)', informal: true },
  gotta: { parts: ['got', 'to'], note: 'gotta = (have) got to – phải (khẩu ngữ)', informal: true },
  hafta: { parts: ['have', 'to'], note: 'hafta = have to (khẩu ngữ)', informal: true },
  gimme: { parts: ['give', 'me'], note: 'gimme = give me (khẩu ngữ)', informal: true },
  lemme: { parts: ['let', 'me'], note: 'lemme = let me (khẩu ngữ)', informal: true },
  dunno: { parts: ['do', 'not', 'know'], note: "dunno = (I) don't know (khẩu ngữ)", informal: true },
  kinda: { parts: ['kind', 'of'], note: 'kinda = kind of – hơi, kiểu như (khẩu ngữ)', informal: true },
  sorta: { parts: ['sort', 'of'], note: 'sorta = sort of – hơi hơi (khẩu ngữ)', informal: true },
  outta: { parts: ['out', 'of'], note: 'outta = out of (khẩu ngữ)', informal: true },
  lotta: { parts: ['lot', 'of'], note: 'lotta = lot of (khẩu ngữ)', informal: true },
  tryna: { parts: ['trying', 'to'], note: 'tryna = trying to (khẩu ngữ)', informal: true },
  gotcha: { parts: ['got', 'you'], note: 'gotcha = got you – hiểu rồi / bắt được rồi (khẩu ngữ)', informal: true },
  whatcha: { parts: ['what', 'are', 'you'], note: 'whatcha = what are you / what have you (khẩu ngữ)', informal: true },
  "c'mon": { parts: ['come', 'on'], note: "c'mon = come on (khẩu ngữ)", informal: true },
  "y'know": { parts: ['you', 'know'], note: "y'know = you know (khẩu ngữ)", informal: true },
  "y'all": { parts: ['you', 'all'], note: "y'all = you all – các bạn (khẩu ngữ Mỹ)", informal: true },
  "d'you": { parts: ['do', 'you'], note: "d'you = do you (khẩu ngữ)", informal: true },
  innit: { parts: ['is', 'not', 'it'], note: "innit = isn't it (khẩu ngữ Anh)", informal: true },
  ya: { parts: ['you'], note: 'ya = you (khẩu ngữ)', informal: true },
  "'em": { parts: ['them'], note: "'em = them (khẩu ngữ)", informal: true },
  "'cause": { parts: ['because'], note: "'cause = because (khẩu ngữ)", informal: true },
  cuz: { parts: ['because'], note: 'cuz = because (khẩu ngữ)', informal: true },
};

const SUFFIX_CONTRACTIONS: [RegExp, string[], string][] = [
  [/^(.+)n't$/, ['not'], "n't = not"],
  [/^(.+)'re$/, ['are'], "'re = are"],
  [/^(.+)'ve$/, ['have'], "'ve = have"],
  [/^(.+)'ll$/, ['will'], "'ll = will"],
  [/^(.+)'d$/, ['would'], "'d = would hoặc had (tùy ngữ cảnh)"],
  [/^(.+)'m$/, ['am'], "'m = am"],
];

const S_IS_HOSTS = set('it he she that what who there here where how this everything nothing something everyone someone nobody');

/**
 * Expands a normalised token into analysis parts. Returns null when the token is not a contraction.
 * "'s" is expanded to "is" only after pronoun-like hosts; otherwise it is possessive (left as is).
 */
export function expandContraction(norm: string): Expansion | null {
  const w = norm.replace(/’/g, "'");
  if (CONTRACTIONS[w]) return CONTRACTIONS[w];
  for (const [re, tail, note] of SUFFIX_CONTRACTIONS) {
    const m = w.match(re);
    if (m) {
      let head = m[1];
      if (tail[0] === 'not') {
        if (head === 'ca') head = 'can';
        else if (head === 'wo') head = 'will';
        else if (head === 'sha') head = 'shall';
        // didn't → did, isn't → is
      }
      return { parts: [head, ...tail], note };
    }
  }
  const s = w.match(/^(.+)'s$/);
  if (s && S_IS_HOSTS.has(s[1])) return { parts: [s[1], 'is'], note: "'s = is hoặc has (tùy ngữ cảnh)" };
  return null;
}
