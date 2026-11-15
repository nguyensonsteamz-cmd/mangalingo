/**
 * iPhone scan screen: the screenshot (from the Shortcuts action or the photo library) with a frame
 * in the middle — drag it onto a bubble / sentence / single word and resize it by its corners —
 * then “Quét vùng này”, or “Quét toàn màn hình” for every bubble (numbered). Text recognition is
 * Apple Vision on the device; meanings come from the in-app dictionary.
 */
import { useEffect, useRef, useState } from 'react';
import type { LookupResult, OcrBlock, WordLookup } from '@/shared/types';
import { send } from '@/shared/messages';
import { bubbleBlock, groupLines } from '@/ocr/result';
import { plausibleText } from '@/ocr/bubbles';
import { ocrWords } from '@/ocr/words';
import { resizeRect, type Handle, type Rect } from '@/popup/position';
import { primaryMeaning } from '@/ui/views';
import { Spinner, cx } from '@/ui/components';
import { IconBack, IconScan, IconVolume } from '@/ui/icons';
import { canSpeak, speak } from '@/ui/speech';
import { recognize } from './ios';

type Box = { x: number; y: number; w: number; h: number }; // normalised 0..1 of the image

async function toBase64(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Không đọc được ảnh.'));
    r.readAsDataURL(blob);
  });
}

/** Opens the Lookup tab with a word / sentence (same content as the extension's sidebar). */
export function openLookup(text: string) {
  void send({ type: 'sidebar:push', payload: { type: 'lookup', text } }).then(() => {
    location.hash = 'lookup';
  });
}

const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_POS: Record<string, string> = { nw: '-left-3 -top-3', ne: '-right-3 -top-3', sw: '-left-3 -bottom-3', se: '-right-3 -bottom-3' };

export function Scan({ src, onBack }: { src: string; onBack: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box>({ x: 0.15, y: 0.38, w: 0.7, h: 0.18 });
  const [showFrame, setShowFrame] = useState(true);
  const [busy, setBusy] = useState<false | 'region' | 'full'>(false);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState<OcrBlock[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const b64 = useRef<Promise<string> | null>(null);
  const drag = useRef<{ kind: 'move' | Handle; x: number; y: number; start: Rect } | null>(null);

  useEffect(() => {
    b64.current = toBase64(src);
    b64.current.catch(() => setError('Không đọc được ảnh.'));
    setBlocks([]);
    setActive(null);
    setShowFrame(true);
  }, [src]);

  const size = () => {
    const r = wrap.current?.getBoundingClientRect();
    return { w: r?.width ?? 1, h: r?.height ?? 1 };
  };
  const onDown = (kind: 'move' | Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const { w, h } = size();
    drag.current = { kind, x: e.clientX, y: e.clientY, start: { left: frame.x * w, top: frame.y * h, width: frame.w * w, height: frame.h * h } };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { w, h } = size();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    let r = d.kind === 'move' ? { ...d.start, left: d.start.left + dx, top: d.start.top + dy } : resizeRect(d.start, d.kind, dx, dy);
    // keep the frame on the image
    r = { ...r, width: Math.min(r.width, w), height: Math.min(r.height, h) };
    r.left = Math.min(Math.max(0, r.left), w - r.width);
    r.top = Math.min(Math.max(0, r.top), h - r.height);
    setFrame({ x: r.left / w, y: r.top / h, w: r.width / w, h: r.height / h });
  };
  const onUp = () => {
    drag.current = null;
  };

  const run = async (mode: 'region' | 'full') => {
    setBusy(mode);
    setError('');
    try {
      const image = await (b64.current ?? toBase64(src));
      const lines = await recognize(image, mode === 'region' ? frame : undefined);
      let found: OcrBlock[];
      if (mode === 'region') {
        // the user framed one bubble / sentence / word: everything inside is one text
        const one = lines.length ? bubbleBlock(lines, 'b0', true) : null;
        found = one ? [one] : [];
      } else {
        found = groupLines(lines, { reline: false }).filter((b) => plausibleText(b.text, b.confidence, true));
      }
      setBlocks(found);
      setActive(found[0]?.id ?? null);
      setShowFrame(false);
      if (!found.length) setError(mode === 'region' ? 'Không thấy chữ trong khung. Kéo khung trùng lên chữ rồi quét lại.' : 'Không nhận ra chữ nào trong ảnh.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activeBlock = blocks.find((b) => b.id === active);

  return (
    <div className="mx-auto max-w-2xl pb-36" data-ml-scan="">
      <div className="ml-glass-bar sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 text-muted" aria-label="Quay lại">
          <IconBack size={20} />
        </button>
        <div className="flex-1 text-[15px] font-bold">Quét chữ</div>
        {!showFrame && (
          <button type="button" onClick={() => setShowFrame(true)} className="rounded-lg px-2 py-1 text-[13px] font-semibold text-accent">
            Khung mới
          </button>
        )}
      </div>

      <div className="relative mx-auto select-none touch-none" ref={wrap} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <img src={src} alt="Ảnh cần quét" className="block w-full" draggable={false} onError={() => setError('Không mở được ảnh.')} />
        {!showFrame &&
          blocks.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setActive(b.id)}
              className={cx('absolute rounded-md border-2', b.id === active ? 'border-accent bg-accent/20' : 'border-[rgb(var(--ml-box))] bg-[rgb(var(--ml-box)/0.12)]')}
              style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%` }}
              aria-label={`Bong bóng ${i + 1}`}
            >
              {blocks.length > 1 && (
                <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[11px] font-bold text-white">{i + 1}</span>
              )}
            </button>
          ))}
        {showFrame && (
          <div
            className="absolute rounded-lg border-[3px] border-accent bg-accent/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}
            onPointerDown={onDown('move')}
            data-ml-scan-frame=""
          >
            <span className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-fg">Kéo khung vào chữ cần đọc</span>
            {CORNERS.map((h) => (
              <span key={h} onPointerDown={onDown(h)} className={cx('absolute h-7 w-7 rounded-full border-[3px] border-white bg-accent shadow', CORNER_POS[h])} />
            ))}
          </div>
        )}
      </div>

      {error && <div className="mx-3 mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-text">{error}</div>}
      {activeBlock && <ScanResult key={activeBlock.id + activeBlock.text} text={activeBlock.text} n={blocks.length > 1 ? blocks.indexOf(activeBlock) + 1 : 0} />}

      <div className="ml-glass fixed inset-x-3 bottom-[calc(max(10px,env(safe-area-inset-bottom))+76px)] z-20 flex gap-2 rounded-[26px] p-2">
        <button type="button" disabled={!!busy || !showFrame} onClick={() => void run('region')} data-ml-magnetic="" className="ml-press ml-btn-primary ml-ripple flex flex-1 items-center justify-center gap-1.5 rounded-[20px] py-2.5 text-[14px] font-bold disabled:opacity-40">
          {busy === 'region' ? <Spinner /> : <IconScan size={16} />} Quét vùng này
        </button>
        <button type="button" disabled={!!busy} onClick={() => void run('full')} className="ml-press ml-glass-card ml-ripple flex flex-1 items-center justify-center gap-1.5 rounded-[20px] py-2.5 text-[14px] font-semibold text-text disabled:opacity-40">
          {busy === 'full' ? <Spinner /> : null} Quét toàn màn hình
        </button>
      </div>
    </div>
  );
}

/** Result card of one bubble: original text (tap a word), dictionary gloss, every word with IPA / meaning / sound. */
function ScanResult({ text, n }: { text: string; n: number }) {
  const [gloss, setGloss] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState<Record<string, WordLookup | null | undefined>>({});
  const content = ocrWords(text);
  const words = content.length ? content : ocrWords(text, true);

  useEffect(() => {
    let alive = true;
    if (text.trim().split(/\s+/).length > 1) {
      void send({ type: 'lookup', req: { text, assumeEnglish: true } })
        .then((r: LookupResult) => {
          if (!alive) return;
          if (r.kind === 'sentence') setGloss(r.gloss);
          else if (r.kind === 'paragraph') setGloss(r.sentences.map((x) => x.gloss).join(' '));
          else if (r.kind === 'phrase') setGloss(r.senses.find((x) => x.vi?.length)?.vi?.join('; ') ?? r.gloss);
          else setGloss(null);
        })
        .catch(() => alive && setGloss(null));
    } else setGloss(null);
    for (const w of words) {
      void send({ type: 'lookup', req: { text: w, context: text, mode: 'word', assumeEnglish: true } })
        .then((r) => alive && setRows((x) => ({ ...x, [w]: r.kind === 'word' ? r : null })))
        .catch(() => alive && setRows((x) => ({ ...x, [w]: null })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="mx-3 mt-3 space-y-3" data-ml-scan-result="">
      <div className="ml-glass-card rounded-[20px] border-l-[4px] border-l-subtle p-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          {n > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--ml-box))] px-1 text-[11px] text-white">{n}</span>}
          Nguyên văn
          {canSpeak() && (
            <button type="button" className="ml-auto text-muted" onClick={() => speak(text)} aria-label="Đọc">
              <IconVolume size={18} />
            </button>
          )}
        </div>
        <div className="ml-tr leading-relaxed">
          {text.split(/(\s+)/).map((w, i) =>
            /\s+/.test(w) ? (
              w
            ) : (
              <button key={i} type="button" className="rounded px-0.5 active:bg-accent/20" onClick={() => openLookup(w.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '') || w)}>
                {w}
              </button>
            ),
          )}
        </div>
        <button type="button" className="mt-2 rounded-lg bg-accent/15 px-2.5 py-1 text-[12.5px] font-semibold text-accent" onClick={() => openLookup(text)}>
          Phân tích câu
        </button>
      </div>

      {gloss !== null && (
        <div className="rounded-[20px] border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.08] p-3">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-accent">Nghĩa (từ điển)</div>
          {gloss === undefined ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> Đang tra…
            </div>
          ) : (
            <div className="ml-tr font-semibold">{gloss}</div>
          )}
        </div>
      )}

      {words.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ok">Từng từ</div>
          <ul className="space-y-1.5">
            {words.map((w) => {
              const r = rows[w];
              const meaning = r ? primaryMeaning(r) : '';
              return (
                <li key={w} className="ml-glass-card ml-press flex items-start gap-2 rounded-[18px] border-l-[4px] border-l-ok/70 px-3 py-2" onClick={() => openLookup(w)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-[15px] font-semibold">{w}</span>
                      {r && r.lemma !== w && <span className="text-[12px] text-subtle">→ {r.lemma}</span>}
                      {r?.ipa && <span className="ml-ipa text-[12.5px] text-accent">{r.ipa.startsWith('/') ? r.ipa : `/${r.ipa}/`}</span>}
                    </div>
                    <div className="text-[14px] leading-snug">
                      {r === undefined ? (
                        <span className="text-subtle">…</span>
                      ) : !r?.found ? (
                        <span className="text-[13px] text-subtle">không có trong từ điển (có thể đọc sai)</span>
                      ) : r.hasVietnamese ? (
                        <b>{meaning}</b>
                      ) : (
                        <i className="text-[13px] text-muted">{meaning}</i>
                      )}
                    </div>
                  </div>
                  {canSpeak() && (
                    <button
                      type="button"
                      className="p-1 text-muted"
                      aria-label={`Phát âm ${w}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        speak(w);
                      }}
                    >
                      <IconVolume size={18} />
                    </button>
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
