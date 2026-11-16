/**
 * Context explanations from observable text features (punctuation, interjections, intensifiers,
 * stutters, elongation, contractions). Each note says which text triggered it.
 */
import type { Chunk, ContextNote } from '@/shared/types';
import type { Tagged } from '@/language/postag';
import { isMostlyUpper } from '@/language/tokenize';

const INTERJECTION_TONE: Record<string, string> = {
  ugh: 'khó chịu, chán nản', argh: 'bực bội, thất vọng', grr: 'tức giận', wow: 'ngạc nhiên, thán phục', whoa: 'ngạc nhiên, sửng sốt',
  huh: 'thắc mắc, ngạc nhiên hoặc không nghe rõ', eh: 'thắc mắc, muốn xác nhận', oh: 'chợt hiểu ra hoặc ngạc nhiên',
  ah: 'chợt nhận ra, hoặc thở phào', ouch: 'đau', oops: 'lỡ làm sai', phew: 'nhẹ nhõm', yay: 'vui mừng', hmm: 'đang suy nghĩ, nghi ngờ',
  tch: 'khó chịu (tặc lưỡi)', tsk: 'chê trách', ha: 'chế giễu hoặc đắc thắng', haha: 'cười', geez: 'bực mình, ngán ngẩm',
  jeez: 'bực mình, ngán ngẩm', damn: 'tức giận, bực bội (thô)', yikes: 'sợ hãi, ngượng', ew: 'ghê tởm', eww: 'ghê tởm', aw: 'thất vọng nhẹ hoặc cảm động',
  aww: 'cảm động, thấy dễ thương', um: 'ngập ngừng', uh: 'ngập ngừng', shh: 'bảo im lặng', hey: 'gọi chú ý hoặc phản đối',
};
const INTENSIFIERS: Record<string, string> = {
  freaking: 'nhấn mạnh cảm xúc (thay cho từ tục)', fricking: 'nhấn mạnh cảm xúc', damn: 'nhấn mạnh, thô', bloody: 'nhấn mạnh (Anh), hơi thô',
  totally: 'nhấn mạnh "hoàn toàn"', literally: 'nhấn mạnh (khẩu ngữ, không nhất thiết theo nghĩa đen)', so: 'nhấn mạnh mức độ',
  super: 'nhấn mạnh "cực kỳ" (khẩu ngữ)', really: 'nhấn mạnh', absolutely: 'nhấn mạnh tuyệt đối', seriously: 'nhấn mạnh sự nghiêm túc / bực bội',
};

export function toneNotes(text: string, tagged: Tagged[], chunks: Chunk[]): ContextNote[] {
  const notes: ContextNote[] = [];
  const t = text.trim();
  const add = (kind: ContextNote['kind'], snippet: string, title: string, explanation: string) => {
    if (!notes.some((n) => n.title === title && n.text === snippet)) notes.push({ kind, text: snippet, title, explanation, source: 'rules' });
  };

  if (/\?!|!\?/.test(t)) add('tone', '?!', 'Ngạc nhiên / sốc', 'Dấu "?!" thể hiện câu hỏi kèm cảm xúc mạnh: kinh ngạc, không tin nổi hoặc tức giận.');
  else if (/!{2,}/.test(t)) add('tone', '!!', 'Cảm xúc rất mạnh', 'Nhiều dấu "!" cho thấy nhân vật đang hét lên hoặc cực kỳ kích động.');
  if (/(\.\.\.|…)/.test(t)) add('tone', '…', 'Ngập ngừng / bỏ lửng', 'Dấu "…" thể hiện ngập ngừng, im lặng, bỏ lửng câu nói hoặc cảm xúc khó nói thành lời.');
  const stutter = t.match(/\b(\p{L}{1,2})-\1\p{L}*/iu);
  if (stutter) add('tone', stutter[0], 'Nói lắp', `"${stutter[0]}" là cách viết thể hiện nhân vật nói lắp vì hồi hộp, sợ hãi hoặc xấu hổ.`);
  const elong = t.match(/\b\p{L}*(\p{L})\1{2,}\p{L}*\b/u);
  if (elong) add('tone', elong[0], 'Kéo dài âm', `"${elong[0]}" kéo dài chữ cái để nhấn mạnh hoặc thể hiện cảm xúc (hét, rên, nũng nịu).`);
  if (isMostlyUpper(t) && t.length > 6) {
    add('tone', 'CAPS', 'Chữ in hoa', 'Manga tiếng Anh thường viết hoa toàn bộ lời thoại nên đây có thể chỉ là kiểu chữ. Ngoài manga, chữ in hoa thường thể hiện việc la hét.');
  }
  for (const u of tagged) {
    const tone = INTERJECTION_TONE[u.norm];
    if (tone && (u.tag === 'INTJ' || u.norm === 'damn')) add('tone', u.text, `Thán từ "${u.text}"`, `Thể hiện: ${tone}.`);
    const inten = INTENSIFIERS[u.norm];
    if (inten && u.tag !== 'INTJ' && u.tag !== 'CCONJ' && u.tag !== 'SCONJ') add('tone', u.text, `"${u.text}" – từ nhấn mạnh`, `${inten[0].toUpperCase()}${inten.slice(1)}.`);
  }
  const contractions = tagged.filter((u, i) => u.from && tagged[i - 1]?.from !== u.from);
  const seen = new Set<string>();
  for (const c of contractions) {
    const parts = tagged.filter((u) => u.from === c.from && u.start === c.start).map((u) => u.norm);
    const key = c.from!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    add('contraction', c.from!, `Dạng rút gọn "${c.from}"`, `= ${parts.join(' ')}${c.informal ? ' (khẩu ngữ)' : ''}.`);
  }
  for (const ch of chunks) {
    if (ch.kind !== 'phrase' || !ch.phraseType) continue;
    // not worth a note: "going to + verb" is the future, not "go to"; "Do you know what…" is a question, not the filler "you know"
    if (ch.lemma === 'go to' || ch.lemma === 'be to') continue;
    if (ch.lemma === 'you know' && /\b(do|did|does|would|could|can|will)\s+you\s+know\b/i.test(text)) continue;
    const kind = ch.phraseType === 'phrasal' ? 'phrasal' : ch.phraseType === 'slang' ? 'slang' : ch.phraseType === 'idiom' ? 'idiom' : 'expression';
    const title = { phrasal: 'Cụm động từ', slang: 'Tiếng lóng', idiom: 'Thành ngữ', expression: 'Cách diễn đạt cố định' }[kind];
    const meaning = ch.vi ? `Nghĩa: ${ch.vi}.` : ch.en ? `English: ${ch.en}` : 'Có trong từ điển như một cụm cố định.';
    notes.push({ kind, text: ch.text, title: `${title}: "${ch.lemma ?? ch.text}"`, explanation: ch.note ? `${meaning} ${ch.note}` : meaning, source: ch.source ?? 'rules' });
  }
  return notes;
}
