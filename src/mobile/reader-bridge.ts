/**
 * Engine side of the Web Reader. The in-app browser (a native WKWebView on top of this one) cannot run the
 * dictionary / translation code itself, so Swift forwards what the user clicked or selected to
 * `window.__mlReader` here. EVERYTHING goes through the same engine as the rest of the app:
 *   lookup  → the shared router (dictionary + grammar rules)
 *   translate → machineTranslate(): on-device Apple Translation or the quota-guarded Google provider
 *   save    → the shared vocabulary notebook
 * so the usage meter, the cache and the cost protection apply to the Reader exactly as elsewhere.
 */
import type { BlockedDecision } from '@/modules/usage/types';
import type { LookupRequest, LookupResult, OcrLine, Pos, Sense, WordLookup } from '@/shared/types';
import { groupLines } from '@/ocr/result';
import { plausibleText } from '@/ocr/bubbles';

export interface ReaderRequest {
  text: string;
  context?: string;
  mode?: 'word' | 'sentence' | 'paragraph';
}

export interface ReaderPayload {
  title: string;
  ipa?: string;
  pos?: string[];
  meanings?: { pos?: string; vi: string }[];
  english?: string[];
  mt?: string;
  mtLabel?: string;
  note?: string;
  saveable?: boolean;
  saved?: boolean;
  canSpeak?: boolean;
  blocked?: { message: string; needsConsent: boolean; additionalChars: number; estimatedCostUsd: number };
  error?: string;
}

export interface ReaderDeps {
  lookup(req: LookupRequest): Promise<LookupResult>;
  /** machineTranslate(): the guarded translation path. Rejects with an error carrying `.decision` when blocked. */
  translate(text: string): Promise<string>;
  hasLemma(lemma: string): Promise<boolean>;
  saveWord(e: { word: string; lemma: string; meaning: string; pos?: Pos; ipa?: string; sentence?: string; sourceUrl?: string; sourceTitle?: string }): Promise<void>;
  openDetails(text: string, context?: string): void;
  posLabel(pos: Pos): string;
  primaryMeaning(r: WordLookup): string | Promise<string>;
}

const blockedOf = (e: unknown): BlockedDecision | null => {
  const d = (e as { decision?: BlockedDecision } | null)?.decision;
  return d && typeof d === 'object' && 'reason' in d ? d : null;
};

const uniq = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];

function groupVi(senses: Sense[]): [Pos, string[]][] {
  const by = new Map<Pos, string[]>();
  for (const s of senses) {
    if (!s.vi?.length) continue;
    by.set(s.pos, [...(by.get(s.pos) ?? []), ...s.vi]);
  }
  return [...by.entries()];
}

export function createReaderBridge(deps: ReaderDeps) {
  const mtLine = async (text: string, p: ReaderPayload, label = 'Bản dịch') => {
    try {
      const out = await deps.translate(text);
      p.mt = out;
      p.mtLabel = label;
    } catch (e) {
      const d = blockedOf(e);
      if (d) p.blocked = { message: d.message, needsConsent: d.needsConsent, additionalChars: d.additionalChars, estimatedCostUsd: d.estimatedCostUsd };
      else p.error = `Không dịch được: ${(e as Error)?.message ?? e}`;
    }
  };

  return {
    /** What the popup shows for a clicked word / selected sentence or paragraph. */
    async lookup(req: ReaderRequest): Promise<ReaderPayload> {
      const text = req.text.trim();
      const mode = req.mode ?? 'sentence';
      try {
        if (mode === 'word') {
          const r = await deps.lookup({ text, context: req.context, mode: 'word', assumeEnglish: true });
          if (r.kind === 'word') {
            const p: ReaderPayload = { title: r.query, ipa: r.ipa, pos: r.posList.slice(0, 4).map((x) => deps.posLabel(x)), saveable: r.found };
            const groups = groupVi(r.senses);
            p.meanings = groups.slice(0, 4).map(([pos, vi]) => ({ pos: groups.length > 1 ? deps.posLabel(pos) : undefined, vi: uniq(vi).slice(0, 3).join('; ') }));
            if (!groups.length) {
              // no Vietnamese data: the machine translation of the word (guarded), English definitions as the cross-check
              p.english = uniq(r.senses.map((s) => s.en ?? '')).slice(0, 2);
              await mtLine(text.toLowerCase(), p, 'Dịch máy');
            }
            p.saved = r.found ? await deps.hasLemma(r.lemma) : false;
            return p;
          }
          if (r.kind === 'phrase') {
            const p: ReaderPayload = { title: r.phrase, saveable: false };
            p.meanings = uniq(r.senses.flatMap((s) => s.vi ?? [])).slice(0, 3).map((vi) => ({ vi }));
            if (!p.meanings.length) await mtLine(text, p);
            return p;
          }
          if (r.kind === 'unsupported') return { title: text, error: 'Đây không phải tiếng Anh.', canSpeak: false };
        }
        // sentence / paragraph: the (guarded) translation of exactly the text the user chose
        const p: ReaderPayload = { title: mode === 'paragraph' ? 'Bản dịch đoạn' : 'Bản dịch câu', saveable: false };
        await mtLine(text, p);
        return p;
      } catch (e) {
        return { title: text.slice(0, 60), error: `Không tra được: ${(e as Error)?.message ?? e}` };
      }
    },

    async save(req: { word: string; context?: string; url?: string; title?: string }): Promise<{ ok: boolean; message?: string }> {
      try {
        const r = await deps.lookup({ text: req.word, context: req.context, mode: 'word', assumeEnglish: true });
        if (r.kind !== 'word' || !r.found) return { ok: false, message: 'Từ này chưa có trong từ điển nên chưa lưu được.' };
        await deps.saveWord({ word: r.query, lemma: r.lemma, meaning: await deps.primaryMeaning(r), pos: r.context?.likelyPos ?? r.posList[0], ipa: r.ipa, sentence: req.context, sourceUrl: req.url, sourceTitle: req.title });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e as Error)?.message ?? 'Không lưu được.' };
      }
    },

    /** Speech bubbles of an OCR result (same grouping and filtering as the scan screen). */
    ocrBlocks(lines: OcrLine[]): { id: string; text: string; confidence: number; box: { x: number; y: number; w: number; h: number } }[] {
      return groupLines(lines, { reline: false })
        .filter((b) => plausibleText(b.text, b.confidence, true))
        .map((b) => ({ id: b.id, text: b.text, confidence: b.confidence, box: b.box }));
    },

    openDetails(text: string, context?: string) {
      deps.openDetails(text, context);
    },
  };
}

export type ReaderBridge = ReturnType<typeof createReaderBridge>;
