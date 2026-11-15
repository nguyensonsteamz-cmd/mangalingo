/**
 * Meaning panel shown directly under an OCR speech bubble's text: a dictionary-mode gloss of the
 * whole bubble plus every content word with IPA, a pronunciation button and its best meaning.
 * All lookups go to the local dictionary in the background worker (nothing leaves the machine).
 */
import { useEffect, useState } from 'react';
import type { LookupResult, WordLookup } from '@/shared/types';
import type { Settings } from '@/shared/settings';
import { send } from '@/shared/messages';
import { IconButton, Spinner } from '@/ui/components';
import { IconVolume } from '@/ui/icons';
import { primaryMeaning } from '@/ui/views';
import { canSpeak, speak } from '@/ui/speech';
import * as A from '@/content/actions';
import { ocrWords } from '@/ocr/words';
import { MachineTranslation, type MtState } from '@/ui/MachineTranslation';
import { machineTranslate, mtAvailability, translatorReady } from '@/translation/chrome-mt';

// Results are cached per (word, context) so reopening a bubble is instant.
const cache = new Map<string, Promise<LookupResult | null>>();
function cachedLookup(text: string, context: string | undefined, mode?: 'word'): Promise<LookupResult | null> {
  const key = `${mode ?? ''}\u0000${text}\u0000${context ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = send({ type: 'lookup', req: { text, context, mode, assumeEnglish: true } }).catch(() => null);
    cache.set(key, p);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return p;
}

function bubbleGloss(r: LookupResult | null): { gloss: string; coverage: number } | null {
  if (!r) return null;
  if (r.kind === 'phrase') {
    const vi = r.senses.find((x) => x.vi?.length)?.vi;
    if (vi) return { gloss: vi.join('; '), coverage: 1 };
    return r.gloss ? { gloss: r.gloss, coverage: r.chunks.length ? r.chunks.filter((c) => c.status === 'vi').length / r.chunks.length : 0 } : null;
  }
  if (r.kind === 'sentence') return { gloss: r.gloss, coverage: r.coverage };
  if (r.kind === 'paragraph') return { gloss: r.sentences.map((x) => x.gloss).join(' '), coverage: r.coverage };
  return null;
}

export function OcrMeaning({ text, s }: { text: string; s: Settings }) {
  // Short bubbles made only of function words ("THAT'S") still get their words listed.
  const content = ocrWords(text);
  const words = content.length ? content : ocrWords(text, true);
  const [rows, setRows] = useState<Record<string, WordLookup | null | undefined>>({});
  // Machine translation of single words that have no Vietnamese meaning in the dictionary.
  const [mtWords, setMtWords] = useState<Record<string, string>>({});
  const useMt = s.reading.translationMode === 'machine';
  const [gloss, setGloss] = useState<{ gloss: string; coverage: number } | null | undefined>(undefined);
  const multiWord = text.trim().split(/\s+/).length > 1;

  useEffect(() => {
    let alive = true;
    setRows({});
    setMtWords({});
    setGloss(undefined);
    if (multiWord) void cachedLookup(text, undefined).then((r) => alive && setGloss(bubbleGloss(r)));
    for (const w of words) {
      void cachedLookup(w, text, 'word').then((r) => {
        if (!alive) return;
        const row = r?.kind === 'word' ? r : null;
        setRows((x) => ({ ...x, [w]: row }));
        if (useMt && !row?.hasVietnamese) {
          // Uses the model once it is on the machine (waits for a running download) – never starts one itself.
          void mtAvailability()
            .then((a) => (a === 'unsupported' || a === 'unavailable' ? null : (a === 'available' ? Promise.resolve() : translatorReady()).then(() => machineTranslate(w))))
            .then((vi) => alive && vi && vi.toLowerCase() !== w && setMtWords((x) => ({ ...x, [w]: vi })))
            .catch(() => {});
        }
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const speakable = s.dictionary.showPronunciation && canSpeak();
  // The dictionary gloss is only a fallback for when machine translation is off or cannot run.
  const [mtState, setMtState] = useState<MtState>('checking');
  const showGloss = multiWord && ['off', 'unsupported', 'unavailable', 'error'].includes(mtState);
  return (
    <div className="mt-3 space-y-3" data-ml-ocr-meaning="">
      <MachineTranslation text={text} s={s} onState={setMtState} />
      {showGloss && (
        <div className="ml-card rounded-xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.07] px-3 py-2.5 hover:border-accent/50">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Nghĩa (từ điển)
          </div>
          {gloss === undefined ? (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner /> Đang ghép nghĩa…
            </div>
          ) : gloss ? (
            <div className="ml-tr font-semibold leading-snug text-text" data-ml-ocr-gloss="">
              {gloss.gloss}
            </div>
          ) : (
            <div className="text-[12px] text-muted">Không ghép được nghĩa cho đoạn này.</div>
          )}
        </div>
      )}

      {words.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Từng từ
          </div>
          <ul className="space-y-1.5" data-ml-ocr-words="">
            {words.map((w) => {
              const r = rows[w];
              const meaning = r ? primaryMeaning(r) : '';
              const isVi = !!r?.hasVietnamese;
              return (
                <li
                  key={w}
                  data-ml-ocr-word={w}
                  role="button"
                  tabIndex={0}
                  title="Xem đầy đủ"
                  onClick={() => A.drillDown(w, text)}
                  onKeyDown={(e) => e.key === 'Enter' && A.drillDown(w, text)}
                  className="ml-card ml-glass-card ml-focus flex cursor-pointer items-start gap-1.5 rounded-2xl border-l-[4px] border-l-ok/70 px-2.5 py-2 hover:border-ok/50 hover:border-l-ok hover:bg-ok/[0.06] hover:shadow-[0_8px_18px_-10px_rgb(var(--ml-ok)/0.7)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-[13.5px] font-semibold text-text">{w}</span>
                      {r && r.lemma && r.lemma !== w && <span className="text-[11.5px] text-subtle">→ {r.lemma}</span>}
                      {s.dictionary.showIpa && r?.ipa && (
                        <span className="ml-ipa text-[12px] text-accent" data-ml-ipa="">
                          {r.ipa.startsWith('/') ? r.ipa : `/${r.ipa}/`}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 leading-snug">
                      {r === undefined ? (
                        <span className="text-[12.5px] text-subtle">…</span>
                      ) : !r?.hasVietnamese && mtWords[w] ? (
                        <>
                          <span className="text-[14px] font-bold text-text" data-ml-ocr-word-vi="">
                            {mtWords[w]}
                          </span>
                          <span className="ml-1.5 rounded bg-warn/15 px-1 align-middle text-[10px] font-semibold text-warn" title="Từ điển chưa có nghĩa tiếng Việt – dịch bằng Chrome">
                            dịch máy
                          </span>
                          {r?.found && meaning && <span className="mt-0.5 block text-[11.5px] italic text-muted">{meaning}</span>}
                        </>
                      ) : !r || !r.found ? (
                        <span className="text-[12.5px] text-subtle">không có trong từ điển (có thể OCR đọc sai)</span>
                      ) : meaning ? (
                        isVi ? (
                          <span className="text-[14px] font-bold text-text" data-ml-ocr-word-vi="">
                            {meaning}
                          </span>
                        ) : (
                          <span className="text-[12.5px] italic text-muted">{meaning}</span>
                        )
                      ) : (
                        <span className="text-[12.5px] text-subtle">chưa có nghĩa</span>
                      )}
                    </div>
                  </div>
                  {speakable && (
                    <IconButton
                      label={`Phát âm “${w}”`}
                      onClick={(e) => {
                        e.stopPropagation();
                        speak(w);
                      }}
                      className="shrink-0"
                    >
                      <IconVolume size={15} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
