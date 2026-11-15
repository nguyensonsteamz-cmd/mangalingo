/**
 * Rule-based grammar analysis on top of the tagger: sentence type, tense/aspect, voice,
 * conditionals, clauses, subject/verb/object and notable features, with Vietnamese explanations.
 * Every finding carries the evidence (the words that triggered the rule).
 */
import type { Clause, GrammarFeature, GrammarReport, SentenceType } from '@/shared/types';
import { BE_FORMS, DO_FORMS, HAVE_FORMS, LINKING_VERBS, RELATIVES, SUBORDINATORS } from './lexicon';
import { lemmaCandidates } from './morphology';
import { TAG_LABEL_VI, type Tagged } from './postag';
import { IRREGULAR_VERB_FORMS } from './irregular';

export const GRAMMAR_DISCLAIMER =
  'Phân tích dựa trên quy tắc ngữ pháp (không dùng AI). Câu phức, câu rút gọn trong hội thoại hoặc lỗi OCR có thể khiến kết quả sai.';

const TENSES: Record<string, { name: string; nameVi: string; explain: string }> = {
  'present-simple': { name: 'Present simple', nameVi: 'Hiện tại đơn', explain: 'Diễn tả sự thật, thói quen, trạng thái hiện tại. Cấu trúc: S + V(s/es) / am-is-are.' },
  'past-simple': { name: 'Past simple', nameVi: 'Quá khứ đơn', explain: 'Hành động đã xảy ra và kết thúc trong quá khứ. Cấu trúc: S + V2/V-ed / was-were.' },
  'present-continuous': { name: 'Present continuous', nameVi: 'Hiện tại tiếp diễn', explain: 'Hành động đang diễn ra lúc nói hoặc kế hoạch gần. Cấu trúc: am/is/are + V-ing.' },
  'past-continuous': { name: 'Past continuous', nameVi: 'Quá khứ tiếp diễn', explain: 'Hành động đang diễn ra tại một thời điểm trong quá khứ. Cấu trúc: was/were + V-ing.' },
  'present-perfect': { name: 'Present perfect', nameVi: 'Hiện tại hoàn thành', explain: 'Hành động đã xảy ra, còn liên quan đến hiện tại (kết quả, kinh nghiệm). Cấu trúc: have/has + V3.' },
  'past-perfect': { name: 'Past perfect', nameVi: 'Quá khứ hoàn thành', explain: 'Hành động xảy ra trước một mốc khác trong quá khứ. Cấu trúc: had + V3.' },
  'present-perfect-continuous': { name: 'Present perfect continuous', nameVi: 'Hiện tại hoàn thành tiếp diễn', explain: 'Hành động kéo dài từ quá khứ đến hiện tại. Cấu trúc: have/has been + V-ing.' },
  'past-perfect-continuous': { name: 'Past perfect continuous', nameVi: 'Quá khứ hoàn thành tiếp diễn', explain: 'Hành động kéo dài đến một mốc trong quá khứ. Cấu trúc: had been + V-ing.' },
  'future-simple': { name: 'Future simple (will)', nameVi: 'Tương lai đơn', explain: 'Dự đoán, quyết định tức thời, lời hứa. Cấu trúc: will/shall + V.' },
  'future-continuous': { name: 'Future continuous', nameVi: 'Tương lai tiếp diễn', explain: 'Hành động sẽ đang diễn ra tại một thời điểm trong tương lai. Cấu trúc: will be + V-ing.' },
  'future-perfect': { name: 'Future perfect', nameVi: 'Tương lai hoàn thành', explain: 'Hành động sẽ hoàn tất trước một mốc tương lai. Cấu trúc: will have + V3.' },
  'going-to': { name: 'Be going to (future)', nameVi: 'Tương lai gần (be going to)', explain: 'Dự định đã có hoặc dự đoán có căn cứ. Cấu trúc: am/is/are going to + V.' },
  'modal': { name: 'Modal verb + base verb', nameVi: 'Động từ khuyết thiếu + V', explain: 'Động từ khuyết thiếu (can, could, may, might, must, should, would…) bổ sung ý khả năng, bắt buộc, lời khuyên… cho động từ chính.' },
  'imperative': { name: 'Imperative', nameVi: 'Câu mệnh lệnh', explain: 'Động từ nguyên mẫu đứng đầu, chủ ngữ "you" được hiểu ngầm. Dùng để ra lệnh, yêu cầu, khuyên.' },
};

const MODAL_MEANING: Record<string, string> = {
  can: 'có thể (khả năng / sự cho phép)', could: 'có thể (quá khứ của can, hoặc lịch sự / khả năng thấp hơn)',
  may: 'có lẽ / được phép (trang trọng)', might: 'có lẽ (khả năng thấp)', must: 'phải (bắt buộc / suy luận chắc chắn)',
  should: 'nên (lời khuyên / kỳ vọng)', would: 'sẽ (giả định, lịch sự, thói quen quá khứ)', shall: 'sẽ / nhé? (đề nghị, trang trọng)',
  will: 'sẽ', ought: 'nên (ought to)',
};

const isVerbish = (t: Tagged) => t.tag === 'VERB' || t.tag === 'AUX' || t.tag === 'MODAL';
const lemmaOf = (t: Tagged) => {
  if (BE_FORMS.has(t.norm)) return 'be';
  if (HAVE_FORMS.has(t.norm)) return 'have';
  if (DO_FORMS.has(t.norm)) return 'do';
  const irr = IRREGULAR_VERB_FORMS.get(t.norm);
  if (irr) return irr[0].base;
  return lemmaCandidates(t.norm).find((c) => c.pos === 'verb')?.lemma ?? t.norm;
};
const isPresentBe = (w: string) => ['am', 'is', 'are'].includes(w);
const isPastBe = (w: string) => ['was', 'were'].includes(w);

interface VerbGroup {
  units: Tagged[];
  startIdx: number;
  endIdx: number;
}

/** Collects verb groups: (MODAL|AUX|NEG|ADV)* VERB? sequences anchored on a verbal token. */
export function verbGroups(tags: Tagged[]): VerbGroup[] {
  const groups: VerbGroup[] = [];
  let i = 0;
  while (i < tags.length) {
    if (!isVerbish(tags[i])) {
      i++;
      continue;
    }
    const start = i;
    const units: Tagged[] = [];
    while (i < tags.length) {
      const t = tags[i];
      if (isVerbish(t) || t.tag === 'NEG' || (t.tag === 'ADV' && units.length > 0 && i + 1 < tags.length && isVerbish(tags[i + 1]))) {
        units.push(t);
        i++;
        // A main VERB ends the group unless followed by "to"+verb handled elsewhere.
        if (t.tag === 'VERB' && !(BE_FORMS.has(t.norm) && tags[i] && (tags[i].form === 'ing' || tags[i].form === 'pp'))) {
          if (t.norm === 'going' && tags[i]?.norm === 'to' && tags[i + 1]?.tag === 'VERB') {
            units.push(tags[i], tags[i + 1]);
            i += 2;
          }
          break;
        }
      } else if (
        // subject–auxiliary inversion: "Are you going…", "Did she know…"
        (t.tag === 'PRON' || t.tag === 'PROPN' || t.tag === 'NOUN') && units.length > 0 &&
        units.every((u) => u.tag !== 'VERB') && tags[i + 1] && (isVerbish(tags[i + 1]) || tags[i + 1].tag === 'NEG')
      ) {
        i++;
      } else break;
    }
    groups.push({ units, startIdx: start, endIdx: i - 1 });
  }
  return groups;
}

interface TenseFinding {
  id: string;
  evidence: string;
  passive: boolean;
}

export function classifyVerbGroup(g: VerbGroup): TenseFinding | null {
  const v = g.units.filter((u) => u.tag !== 'NEG' && u.tag !== 'ADV');
  if (v.length === 0) return null;
  const words = v.map((u) => u.norm);
  const evidence = g.units.map((u) => u.from ?? u.text).filter((x, i, a) => a.indexOf(x) === i).join(' ');
  const last = v[v.length - 1];
  const first = v[0];
  const passive = v.length >= 2 && v.slice(0, -1).some((u) => BE_FORMS.has(u.norm) || u.norm === 'get' || u.norm === 'got') && last.form === 'pp' && !BE_FORMS.has(last.norm);
  const has = (w: string) => words.includes(w);
  const idx = (w: string) => words.indexOf(w);

  // be going to + V
  const goingIdx = idx('going');
  if (goingIdx > 0 && words[goingIdx + 1] === 'to' && BE_FORMS.has(words[goingIdx - 1])) return { id: 'going-to', evidence, passive };

  if (first.tag === 'MODAL') {
    if (['will', 'shall'].includes(first.norm) || (first.norm === "'ll")) {
      if (words[1] === 'have' && (words[2] === 'been' ? v[3]?.form === 'ing' : true)) return { id: 'future-perfect', evidence, passive };
      if (words[1] === 'be' && last.form === 'ing') return { id: 'future-continuous', evidence, passive };
      return { id: 'future-simple', evidence, passive };
    }
    return { id: 'modal', evidence, passive };
  }
  if (HAVE_FORMS.has(first.norm) && v.length >= 2) {
    const past = first.norm === 'had';
    if (words[1] === 'been' && v[2]?.form === 'ing') return { id: past ? 'past-perfect-continuous' : 'present-perfect-continuous', evidence, passive };
    if (v[1].form === 'pp' || v[1].form === 'past' || words[1] === 'been') return { id: past ? 'past-perfect' : 'present-perfect', evidence, passive };
  }
  if (BE_FORMS.has(first.norm) && v.length >= 2) {
    if (v[1].form === 'ing' || (words[1] === 'being' && passive)) {
      return { id: isPastBe(first.norm) ? 'past-continuous' : 'present-continuous', evidence, passive };
    }
    if (passive) return { id: isPastBe(first.norm) ? 'past-simple' : 'present-simple', evidence, passive };
  }
  if (DO_FORMS.has(first.norm) && v.length >= 2) return { id: first.norm === 'did' ? 'past-simple' : 'present-simple', evidence, passive };
  if (has('been') && v.length === 1) return null;
  // Single verb
  if (isPresentBe(last.norm) || last.form === '3sg' || last.form === 'base') return { id: 'present-simple', evidence, passive };
  if (isPastBe(last.norm) || last.form === 'past' || last.form === 'pp') return { id: 'past-simple', evidence, passive };
  if (last.form === 'ing') return null; // gerund/participle without auxiliary
  return { id: 'present-simple', evidence, passive };
}

const textOf = (tags: Tagged[], from: number, to: number, src: string) => {
  if (from > to || from < 0 || to >= tags.length) return '';
  return src.slice(tags[from].start, tags[to].end).trim();
};

export function analyzeGrammar(text: string, tags: Tagged[]): GrammarReport {
  const features: GrammarFeature[] = [];
  const words = tags.filter((t) => t.tag !== 'PUNCT');
  const lastPunct = text.trim().match(/[.!?…]+["'”’)]*$/)?.[0] ?? '';
  const groups = verbGroups(tags);
  const finite = groups.find((g) => g.units.some((u) => u.tag === 'MODAL' || u.tag === 'AUX' || (u.tag === 'VERB' && u.form !== 'ing' && !(u.form === 'base' && tags[g.startIdx - 1]?.tag === 'PART'))));
  const negated = tags.some((t) => t.tag === 'NEG' || ['nobody', 'nothing', 'nowhere', 'none'].includes(t.norm));

  // ---- sentence type
  let sentenceType: SentenceType = 'declarative';
  const firstContent = words.find((t) => t.tag !== 'INTJ');
  if (lastPunct.includes('?')) {
    sentenceType = firstContent && (firstContent.tag === 'WH' || words.some((t, i) => t.tag === 'WH' && i < 3)) ? 'wh-question' : 'yes-no-question';
  } else if (firstContent && (firstContent.tag === 'AUX' || firstContent.tag === 'MODAL') && words[words.indexOf(firstContent) + 1]?.tag === 'PRON') {
    sentenceType = 'yes-no-question';
  } else if (lastPunct.includes('!') || /^(what an?|how)\b/i.test(text.trim())) {
    sentenceType = 'exclamatory';
  }
  if (!finite && sentenceType === 'declarative') sentenceType = 'fragment';
  const imperativeStart = firstContent && ((firstContent.tag === 'VERB' && firstContent.form === 'base' && words.indexOf(firstContent) <= 1) || (firstContent.norm === 'do' && words[words.indexOf(firstContent) + 1]?.tag === 'NEG') || firstContent.norm === 'let');
  const subjectBefore = finite ? tags.slice(0, finite.startIdx).some((t) => ['PRON', 'NOUN', 'PROPN'].includes(t.tag)) : false;
  if (imperativeStart && !subjectBefore && sentenceType !== 'yes-no-question' && sentenceType !== 'wh-question') {
    features.push({ id: 'imperative', title: 'Câu mệnh lệnh / đề nghị', explanation: TENSES.imperative.explain, evidence: firstContent!.from ?? firstContent!.text });
    if (sentenceType === 'exclamatory') {
      features.push({ id: 'exclaim', title: 'Câu cảm thán', explanation: 'Dấu "!" thể hiện cảm xúc mạnh (ngạc nhiên, tức giận, thúc giục).' });
    }
    if (sentenceType === 'fragment' || sentenceType === 'declarative' || sentenceType === 'exclamatory') sentenceType = 'imperative';
  }

  // ---- tense & voice (main clause = first finite group outside if-clause when possible)
  const ifIdx = tags.findIndex((t) => t.norm === 'if' || t.norm === 'unless');
  const findings = groups.map((g) => ({ g, f: classifyVerbGroup(g) })).filter((x) => x.f);
  let main = findings[0];
  const leadSub = tags.findIndex((t) => t.tag !== 'INTJ' && t.tag !== 'PUNCT');
  const subIdx = ifIdx >= 0 ? ifIdx : leadSub >= 0 && tags[leadSub].tag === 'SCONJ' ? leadSub : -1;
  if (subIdx >= 0 && findings.length > 1) {
    const commaAfter = tags.findIndex((t, i) => i > subIdx && t.text === ',');
    const outside = findings.find((x) => x.g.startIdx < subIdx || (commaAfter > 0 && x.g.startIdx > commaAfter));
    if (outside) main = outside;
  }
  let tense: GrammarReport['tense'];
  if (main?.f && sentenceType !== 'imperative') {
    const t = TENSES[main.f.id];
    tense = { id: main.f.id, name: t.name, nameVi: t.nameVi, evidence: main.f.evidence };
    features.push({ id: `tense-${main.f.id}`, title: `Thì: ${t.nameVi}`, explanation: t.explain, evidence: main.f.evidence });
    const modal = main.g.units.find((u) => u.tag === 'MODAL');
    if (modal && MODAL_MEANING[modal.norm] && main.f.id === 'modal') {
      features.push({ id: 'modal-meaning', title: `"${modal.norm}" – ${MODAL_MEANING[modal.norm]}`, explanation: 'Sau động từ khuyết thiếu, động từ chính luôn ở dạng nguyên mẫu không "to".', evidence: main.f.evidence });
    }
  }
  const passiveFinding = findings.find((x) => x.f!.passive);
  const voice: GrammarReport['voice'] = passiveFinding ? 'passive' : findings.length ? 'active' : 'unknown';
  if (passiveFinding) {
    const by = tags.findIndex((t, i) => t.norm === 'by' && i > passiveFinding.g.endIdx);
    features.push({
      id: 'passive',
      title: 'Câu bị động (passive voice)',
      explanation: `Cấu trúc be + V3: chủ ngữ là đối tượng chịu tác động.${by >= 0 ? ' Cụm "by …" chỉ tác nhân thực hiện hành động.' : ' Tác nhân không được nêu (có thể vì không quan trọng hoặc không rõ).'}`,
      evidence: passiveFinding.f!.evidence,
    });
  }

  // ---- conditional
  let conditional: GrammarReport['conditional'];
  if (ifIdx >= 0) {
    const comma = tags.findIndex((t, i) => i > ifIdx && t.text === ',');
    const ifGroup = findings.find((x) => x.g.startIdx > ifIdx && (comma < 0 || x.g.startIdx < comma));
    const mainGroup = findings.find((x) => x !== ifGroup);
    const ifT = ifGroup?.f?.id;
    const mainWords = mainGroup ? mainGroup.g.units.map((u) => u.norm) : [];
    let type: '0' | '1' | '2' | '3' | 'mixed' | 'unknown' = 'unknown';
    const mainModalPast = mainWords.some((w) => ['would', 'could', 'might'].includes(w));
    if (ifT === 'past-perfect' && mainModalPast && mainWords.includes('have')) type = '3';
    else if ((ifT === 'past-simple' || ifT === 'past-continuous') && mainModalPast) type = '2';
    else if ((ifT === 'present-simple' || ifT === 'present-continuous' || ifT === 'present-perfect') && (mainWords.some((w) => ['will', 'can', 'may', 'might', 'should', 'must', "'ll"].includes(w)) || sentenceType === 'imperative' || mainGroup?.f?.id === 'going-to')) type = '1';
    else if (ifT === 'present-simple' && mainGroup?.f?.id === 'present-simple') type = '0';
    else if (ifT && mainModalPast) type = 'mixed';
    const explain: Record<string, string> = {
      '0': 'Điều kiện loại 0: sự thật hiển nhiên / quy luật (If + hiện tại đơn, hiện tại đơn).',
      '1': 'Điều kiện loại 1: có thể xảy ra ở hiện tại/tương lai (If + hiện tại đơn, will/can + V).',
      '2': 'Điều kiện loại 2: giả định trái với hiện tại (If + quá khứ đơn, would/could + V). "were" dùng cho mọi ngôi.',
      '3': 'Điều kiện loại 3: giả định trái với quá khứ (If + had V3, would/could have + V3).',
      mixed: 'Điều kiện hỗn hợp: mệnh đề If và mệnh đề chính khác mốc thời gian.',
      unknown: 'Có mệnh đề điều kiện (if/unless) nhưng quy tắc chưa xác định được loại.',
    };
    conditional = { type, evidence: textOf(tags, ifIdx, Math.min(tags.length - 1, (comma > 0 ? comma : ifIdx + 4)), text) };
    features.push({ id: 'conditional', title: `Câu điều kiện${type !== 'unknown' ? ` loại ${type === 'mixed' ? 'hỗn hợp' : type}` : ''}`, explanation: explain[type], evidence: conditional.evidence });
  }

  // ---- clauses
  const clauses: Clause[] = [];
  let cStart = 0;
  let cType: Clause['type'] = 'main';
  let cMarker: string | undefined;
  const pushClause = (endIdx: number) => {
    const t = textOf(tags, cStart, endIdx, text).replace(/^[,;\s]+|[,;\s]+$/g, '');
    if (t && /\p{L}/u.test(t)) clauses.push({ text: t, type: cType, marker: cMarker });
  };
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const prev = tags[i - 1];
    const startsSub = (t.tag === 'SCONJ' || (SUBORDINATORS.has(t.norm) && t.norm !== 'that' && t.tag !== 'ADP' && i > 0 && t.norm !== 'so')) && i > cStart;
    const startsRel = RELATIVES.has(t.norm) && i > 0 && prev && (prev.tag === 'NOUN' || prev.tag === 'PRON' || prev.tag === 'PROPN' || prev.text === ',') && tags[i + 1] && (isVerbish(tags[i + 1]) || tags[i + 1].tag === 'PRON' || tags[i + 1].tag === 'DET') && t.tag !== 'WH' && t.tag !== 'SCONJ';
    const startsCoord = t.tag === 'CCONJ' && i > cStart && tags.slice(i + 1, i + 4).some(isVerbish) && tags.slice(cStart, i).some(isVerbish);
    if (i > cStart && (startsSub || startsRel || startsCoord)) {
      pushClause(i - 1);
      cStart = i;
      cMarker = t.norm;
      cType = startsRel ? 'relative' : startsCoord ? 'coordinate' : t.norm === 'if' || t.norm === 'unless' ? 'conditional' : 'subordinate';
    } else if (i === 0 && (t.tag === 'SCONJ' || t.norm === 'if' || t.norm === 'unless')) {
      cMarker = t.norm;
      cType = t.norm === 'if' || t.norm === 'unless' ? 'conditional' : 'subordinate';
    } else if (t.text === ',' && cType !== 'main' && i + 1 < tags.length && clauses.length === 0 && i > cStart && tags.slice(cStart, i).some(isVerbish) && tags.slice(i + 1).some(isVerbish)) {
      // "When I came home, she was asleep" → subordinate | main
      pushClause(i - 1);
      cStart = i + 1;
      cType = 'main';
      cMarker = undefined;
    }
  }
  pushClause(tags.length - 1);
  if (clauses.length > 1) {
    features.push({
      id: 'complex',
      title: `Câu có ${clauses.length} mệnh đề`,
      explanation: 'Câu gồm nhiều mệnh đề nối bằng liên từ hoặc đại từ quan hệ. Xem phần "Mệnh đề" để thấy từng phần.',
    });
  }
  if (clauses.some((c) => c.type === 'relative')) {
    const rel = clauses.find((c) => c.type === 'relative')!;
    features.push({ id: 'relative', title: 'Mệnh đề quan hệ', explanation: `"${rel.marker}" mở đầu mệnh đề bổ nghĩa cho danh từ đứng trước nó.`, evidence: rel.text });
  }

  // ---- roles in the main clause
  const roles: GrammarReport['roles'] = {};
  const mainG = main?.g ?? finite;
  if (mainG) {
    let s = mainG.startIdx - 1;
    const subj: number[] = [];
    while (s >= 0 && ['PRON', 'NOUN', 'PROPN', 'DET', 'ADJ', 'NUM'].includes(tags[s].tag)) subj.unshift(s--);
    if (subj.length) roles.subject = textOf(tags, subj[0], subj[subj.length - 1], text);
    else if (sentenceType === 'yes-no-question' || sentenceType === 'wh-question') {
      const inv = tags.slice(mainG.startIdx, mainG.endIdx + 1).find((t) => t.tag === 'PRON' || t.tag === 'PROPN');
      if (inv) roles.subject = inv.text;
    }
    roles.verb = textOf(tags, mainG.startIdx, mainG.endIdx, text);
    const mainVerb = [...mainG.units].reverse().find((u) => u.tag === 'VERB' || u.tag === 'AUX');
    const linking = mainVerb && LINKING_VERBS.has(lemmaOf(mainVerb)) && !(main?.f?.passive);
    let o = mainG.endIdx + 1;
    // Inverted question without a subject before the verb: "Are you out of your mind?"
    if (!roles.subject && (sentenceType === 'yes-no-question' || sentenceType === 'wh-question') && tags[o] && ['PRON', 'PROPN'].includes(tags[o].tag)) {
      roles.subject = tags[o].text;
      o++;
    }
    while (o < tags.length && (tags[o].tag === 'PART' || tags[o].tag === 'ADV')) o++;
    const objIdx: number[] = [];
    while (o < tags.length && ['PRON', 'NOUN', 'PROPN', 'DET', 'ADJ', 'NUM', 'ADV'].includes(tags[o].tag) && !(objIdx.length && tags[o].tag === 'PRON' && tags[o - 1].tag !== 'DET')) {
      objIdx.push(o++);
    }
    if (objIdx.length) {
      const phrase = textOf(tags, objIdx[0], objIdx[objIdx.length - 1], text);
      if (linking) roles.complement = phrase;
      else if (!main?.f?.passive) roles.object = phrase;
    }
    if (!roles.subject && sentenceType === 'imperative') roles.subject = '(you – hiểu ngầm)';
  }

  // ---- other notable features
  if (sentenceType === 'yes-no-question') features.push({ id: 'q-yn', title: 'Câu hỏi Yes/No', explanation: 'Trợ động từ hoặc động từ khuyết thiếu đứng trước chủ ngữ (đảo ngữ); câu trả lời là có/không.' });
  if (sentenceType === 'wh-question') {
    const wh = tags.find((t) => t.tag === 'WH');
    features.push({ id: 'q-wh', title: `Câu hỏi có từ để hỏi${wh ? ` "${wh.text}"` : ''}`, explanation: 'Từ để hỏi (what, where, why, how…) đứng đầu, sau đó thường là trợ động từ + chủ ngữ + động từ.' });
  }
  if (sentenceType === 'exclamatory' && !features.some((f) => f.id === 'exclaim')) features.push({ id: 'exclaim', title: 'Câu cảm thán', explanation: 'Dấu "!" hoặc cấu trúc What a…! / How…! thể hiện cảm xúc mạnh (ngạc nhiên, tức giận, vui mừng).' });
  if (sentenceType === 'fragment') features.push({ id: 'fragment', title: 'Câu rút gọn / không có động từ chính', explanation: 'Thường gặp trong hội thoại và manga: chỉ là cụm từ, thán từ hoặc câu trả lời ngắn; ý nghĩa phụ thuộc vào ngữ cảnh.' });
  if (negated) {
    const neg = tags.find((t) => t.tag === 'NEG' || ['nobody', 'nothing', 'nowhere', 'none'].includes(t.norm));
    features.push({ id: 'negation', title: 'Câu phủ định', explanation: 'Có từ phủ định (not / n\'t / never / nothing…).', evidence: neg?.from ?? neg?.text });
  }
  const there = tags.findIndex((t) => t.norm === 'there');
  if (there >= 0 && tags[there + 1] && BE_FORMS.has(tags[there + 1].norm)) {
    features.push({ id: 'existential', title: 'Cấu trúc "There is/are"', explanation: 'Dùng để nói "có …" (sự tồn tại). Động từ be chia theo danh từ đứng sau.', evidence: textOf(tags, there, there + 1, text) });
  }
  if (tags.some((t) => t.norm === 'than') || tags.some((t) => (t.norm === 'more' || t.norm === 'most') && t.tag !== 'PRON')) {
    features.push({ id: 'comparison', title: 'So sánh', explanation: 'So sánh hơn (-er / more … than) hoặc so sánh nhất (the -est / the most …).' });
  }
  const informal = tags.filter((t) => t.informal).map((t) => t.from ?? t.text);
  if (informal.length) {
    features.push({ id: 'informal', title: 'Văn nói / khẩu ngữ', explanation: `Có dạng rút gọn khẩu ngữ: ${[...new Set(informal)].join(', ')}. Thường gặp trong hội thoại, không dùng trong văn viết trang trọng.` });
  }

  return {
    sentenceType,
    tense,
    voice,
    conditional,
    negated,
    roles,
    clauses,
    features,
    tags: tags.filter((t) => t.tag !== 'PUNCT').map((t) => ({ text: t.from && t.text !== t.from && t.norm !== t.text.toLowerCase() ? t.norm : t.text, tag: TAG_LABEL_VI[t.tag] })),
    confidence: words.length > 25 || clauses.length > 2 ? 'low' : 'medium',
    disclaimer: GRAMMAR_DISCLAIMER,
  };
}
