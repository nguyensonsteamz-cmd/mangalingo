/**
 * One colour per part of speech, used by the notebook's tags (the widget uses the same hues). Full class names on purpose: Tailwind only
 * generates classes it can read in the source.
 */
const CHIP: Record<string, string> = {
  noun: 'bg-[#3B82F6]/15 text-[#3B82F6]',
  verb: 'bg-[#22C55E]/15 text-[#22C55E]',
  aux: 'bg-[#22C55E]/15 text-[#22C55E]',
  modal: 'bg-[#22C55E]/15 text-[#22C55E]',
  adj: 'bg-[#F97316]/15 text-[#F97316]',
  adv: 'bg-[#A855F7]/15 text-[#A855F7]',
  pron: 'bg-[#EC4899]/15 text-[#EC4899]',
  prep: 'bg-[#14B8A6]/15 text-[#14B8A6]',
  conj: 'bg-[#EAB308]/15 text-[#EAB308]',
  interj: 'bg-[#EF4444]/15 text-[#EF4444]',
  num: 'bg-[#06B6D4]/15 text-[#06B6D4]',
};
const OTHER = 'bg-text/[0.07] text-muted';

/** Classes for the tag of a part of speech code ("noun", "verb", "adj"…). Unknown kinds get a neutral grey. */
export const posChipClass = (pos: string | undefined): string => (pos && CHIP[pos]) || OTHER;
