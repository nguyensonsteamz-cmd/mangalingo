/**
 * Irregular English inflections (standard reference lists). Format: base past participle,
 * alternatives separated by "/". Used for lemmatisation, word-form display and tense detection.
 */
const VERBS = `arise arose arisen|awake awoke awoken|awaken awoke awoken|be was/were been|bear bore borne|beat beat beaten|become became become|begin began begun|bend bent bent|bet bet bet|bid bid bid|bind bound bound|bite bit bitten|bleed bled bled|blow blew blown|break broke broken|breed bred bred|bring brought brought|broadcast broadcast broadcast|build built built|burn burnt/burned burnt/burned|burst burst burst|bust bust/busted bust/busted|buy bought bought|cast cast cast|catch caught caught|choose chose chosen|cling clung clung|come came come|cost cost cost|creep crept crept|cut cut cut|deal dealt dealt|dig dug dug|dive dove/dived dived|do did done|draw drew drawn|dream dreamt/dreamed dreamt/dreamed|drink drank drunk|drive drove driven|dwell dwelt dwelt|eat ate eaten|fall fell fallen|feed fed fed|feel felt felt|fight fought fought|find found found|flee fled fled|fling flung flung|fly flew flown|forbid forbade forbidden|forecast forecast forecast|foresee foresaw foreseen|forget forgot forgotten|forgive forgave forgiven|freeze froze frozen|get got got/gotten|give gave given|go went gone|grind ground ground|grow grew grown|hang hung/hanged hung/hanged|have had had|hear heard heard|hide hid hidden|hit hit hit|hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|know knew known|lay laid laid|lead led led|lean leant/leaned leant/leaned|leap leapt/leaped leapt/leaped|learn learnt/learned learnt/learned|leave left left|lend lent lent|let let let|lie lay lain|light lit/lighted lit/lighted|lose lost lost|make made made|mean meant meant|meet met met|mislead misled misled|mistake mistook mistaken|misunderstand misunderstood misunderstood|outdo outdid outdone|overcome overcame overcome|overhear overheard overheard|oversleep overslept overslept|overtake overtook overtaken|pay paid paid|prove proved proven/proved|put put put|quit quit quit|read read read|rebuild rebuilt rebuilt|redo redid redone|rethink rethought rethought|rewind rewound rewound|rewrite rewrote rewritten|rid rid rid|ride rode ridden|ring rang rung|rise rose risen|run ran run|saw sawed sawn|say said said|see saw seen|seek sought sought|sell sold sold|send sent sent|set set set|sew sewed sewn|shake shook shaken|shed shed shed|shine shone shone|shoot shot shot|show showed shown|shrink shrank shrunk|shut shut shut|sing sang sung|sink sank sunk|sit sat sat|slay slew slain|sleep slept slept|slide slid slid|sling slung slung|slit slit slit|smell smelt/smelled smelt/smelled|speak spoke spoken|speed sped sped|spell spelt/spelled spelt/spelled|spend spent spent|spill spilt/spilled spilt/spilled|spin spun spun|spit spat spat|split split split|spoil spoilt/spoiled spoilt/spoiled|spread spread spread|spring sprang sprung|stand stood stood|steal stole stolen|stick stuck stuck|sting stung stung|stink stank stunk|stride strode stridden|strike struck struck|string strung strung|strive strove striven|swear swore sworn|sweep swept swept|swell swelled swollen|swim swam swum|swing swung swung|take took taken|teach taught taught|tear tore torn|tell told told|think thought thought|throw threw thrown|thrust thrust thrust|tread trod trodden|undergo underwent undergone|understand understood understood|undertake undertook undertaken|undo undid undone|upset upset upset|wake woke woken|wear wore worn|weave wove woven|weep wept wept|wet wet wet|win won won|wind wound wound|withdraw withdrew withdrawn|withhold withheld withheld|withstand withstood withstood|wring wrung wrung|write wrote written`;

const NOUNS = `man men|woman women|child children|foot feet|tooth teeth|goose geese|mouse mice|louse lice|person people|ox oxen|life lives|knife knives|wife wives|wolf wolves|leaf leaves|half halves|self selves|thief thieves|shelf shelves|loaf loaves|calf calves|elf elves|criterion criteria|phenomenon phenomena|cactus cacti|fungus fungi|nucleus nuclei|stimulus stimuli|analysis analyses|crisis crises|thesis theses|basis bases|hypothesis hypotheses|diagnosis diagnoses|die dice|potato potatoes|tomato tomatoes|hero heroes|echo echoes|veto vetoes|torpedo torpedoes|sheep sheep|fish fish|deer deer|series series|species species|aircraft aircraft`;

const ADJECTIVES = `good better best|well better best|bad worse worst|far farther/further farthest/furthest|little less least|much more most|many more most|old older/elder oldest/eldest`;

export interface VerbForms {
  base: string;
  past: string[];
  pp: string[];
}

export const IRREGULAR_VERBS: Map<string, VerbForms> = new Map();
/** surface form → base forms */
export const IRREGULAR_VERB_FORMS: Map<string, { base: string; kind: 'past' | 'pp' }[]> = new Map();

for (const row of VERBS.split('|')) {
  const [base, past, pp] = row.split(' ');
  const v = { base, past: past.split('/'), pp: pp.split('/') };
  IRREGULAR_VERBS.set(base, v);
  for (const f of v.past) {
    if (!IRREGULAR_VERB_FORMS.has(f)) IRREGULAR_VERB_FORMS.set(f, []);
    IRREGULAR_VERB_FORMS.get(f)!.push({ base, kind: 'past' });
  }
  for (const f of v.pp) {
    if (!IRREGULAR_VERB_FORMS.has(f)) IRREGULAR_VERB_FORMS.set(f, []);
    IRREGULAR_VERB_FORMS.get(f)!.push({ base, kind: 'pp' });
  }
}

// Forms of the primary auxiliaries
const AUX_FORMS: [string, string, string][] = [
  ['am', 'be', '1sg'], ['is', 'be', '3sg'], ['are', 'be', 'pl'], ['being', 'be', 'ing'],
  ['has', 'have', '3sg'], ['having', 'have', 'ing'], ['does', 'do', '3sg'], ['doing', 'do', 'ing'],
];
export const AUX_LEMMA: Map<string, string> = new Map(AUX_FORMS.map(([f, b]) => [f, b]));

export const IRREGULAR_PLURALS: Map<string, string> = new Map();
export const IRREGULAR_SINGULAR_TO_PLURAL: Map<string, string> = new Map();
for (const row of NOUNS.split('|')) {
  const [sg, pl] = row.split(' ');
  IRREGULAR_PLURALS.set(pl, sg);
  IRREGULAR_SINGULAR_TO_PLURAL.set(sg, pl);
}

export const IRREGULAR_COMPARATIVES: Map<string, string[]> = new Map();
export const IRREGULAR_ADJ: Map<string, { comp: string[]; sup: string[] }> = new Map();
for (const row of ADJECTIVES.split('|')) {
  const [base, comp, sup] = row.split(' ');
  IRREGULAR_ADJ.set(base, { comp: comp.split('/'), sup: sup.split('/') });
  for (const f of [...comp.split('/'), ...sup.split('/')]) {
    if (!IRREGULAR_COMPARATIVES.has(f)) IRREGULAR_COMPARATIVES.set(f, []);
    IRREGULAR_COMPARATIVES.get(f)!.push(base);
  }
}

const EED_PAST = /(agr|disagr|guarant|refer|fr|decr|degr|pedigr)eed$/;

/** Regular "-ed" form (walked, tried, agreed) – excludes "need", "seed", "bed", "red". */
export function looksLikeRegularEd(w: string): boolean {
  if (w.length <= 3 || !w.endsWith('ed')) return false;
  if (w.endsWith('eed')) return EED_PAST.test(w);
  return true;
}

export function isPastParticiple(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_VERB_FORMS.get(w)?.some((f) => f.kind === 'pp')) return true;
  if (IRREGULAR_VERBS.has(w) || IRREGULAR_VERB_FORMS.has(w)) return false;
  return looksLikeRegularEd(w);
}

export function isPastForm(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_VERB_FORMS.get(w)?.some((f) => f.kind === 'past')) return true;
  if (IRREGULAR_VERBS.has(w) || IRREGULAR_VERB_FORMS.has(w)) return false;
  return looksLikeRegularEd(w);
}
