/**
 * "Bản dịch máy (Chrome)" block: natural EN→VI translation from Chrome's on-device Translator API.
 * Rendered only when the user enabled it in Settings; falls back to a short notice when the browser
 * cannot translate EN→VI. The dictionary gloss stays visible underneath as a cross-check.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EN_VI, VI_EN, type LanguagePair } from '@/modules/mt';
import { detectLanguage } from '@/language/detect';
import type { Settings } from '@/shared/settings';
import { getTranslator, machineTranslate, machineTranslateLong, mtAvailability, needsChunking, type MtAvailability } from '@/translation/chrome-mt';
import type { JobProgress, JobResult } from '@/modules/translation';
import { CopyButton } from './CopyButton';
import { Button, Progress, Spinner, cx } from './components';
import { SettingsStore } from '@/storage/settings-store';
import { chromeLocal } from '@/storage/kv';

type State =
  | { k: 'checking' }
  | { k: 'unsupported' | 'unavailable' }
  | { k: 'need-download' }
  | { k: 'downloading'; p: number }
  | { k: 'translating'; progress?: JobProgress }
  | { k: 'done'; text: string }
  /** a long text where some parts could not be translated (or the user cancelled): shows what is there + "retry the failed parts" */
  | { k: 'partial'; result: JobResult }
  | { k: 'error'; msg: string };

export type MtState = State['k'] | 'off';

export function MachineTranslation({ text, s, className, onState, pair: pairProp }: { text: string; s: Settings; className?: string; onState?: (k: MtState) => void; pair?: LanguagePair }) {
  const [st, setSt] = useState<State>({ k: 'checking' });
  // direction: explicit prop, else Vietnamese text → Vietnamese-to-English, everything else keeps the original English → Vietnamese
  const pair: LanguagePair = useMemo(() => {
    if (pairProp) return pairProp;
    const d = detectLanguage(text);
    return d.code === 'vi' && d.confidence >= 0.6 ? VI_EN : EN_VI;
  }, [text, pairProp]);
  const viEn = pair.source === 'vi';
  const [justEnabled, setJustEnabled] = useState(false);
  const enabled = s.reading.translationMode === 'machine' || justEnabled;
  // When the feature is off, offer a one-click "enable" only if this Chrome can translate EN→VI.
  const [offerable, setOfferable] = useState(false);
  useEffect(() => {
    if (enabled) return;
    let alive = true;
    void mtAvailability(pair).then((a) => alive && setOfferable(a !== 'unsupported' && a !== 'unavailable'));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const abort = useRef<AbortController | null>(null);

  /** `retryFrom`: re-run only the chunks of an earlier partial result (their idempotency keys make sure nothing is counted twice) */
  const run = (alive: () => boolean, retryFrom?: JobResult) => {
    if (!needsChunking(text)) {
      setSt({ k: 'translating' });
      machineTranslate(text, pair).then(
        (out) => alive() && setSt({ k: 'done', text: out }),
        (e: Error) => alive() && setSt({ k: 'error', msg: e.message }),
      );
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setSt({ k: 'translating' });
    machineTranslateLong(text, { pair, signal: ac.signal, retryFrom, onProgress: (progress) => alive() && !ac.signal.aborted && setSt({ k: 'translating', progress }) }).then(
      (r) => {
        if (!alive()) return;
        if (r.complete) return setSt({ k: 'done', text: r.text });
        setSt({ k: 'partial', result: r });
      },
      (e: Error) => alive() && setSt({ k: 'error', msg: e.message }),
    );
  };
  const cancel = () => abort.current?.abort();

  useEffect(() => {
    if (!enabled || !text.trim()) return;
    let alive = true;
    const isAlive = () => alive;
    setSt({ k: 'checking' });
    void mtAvailability(pair).then((a: MtAvailability) => {
      if (!alive) return;
      if (a === 'available') run(isAlive);
      else if (a === 'downloading') {
        setSt({ k: 'downloading', p: 0 });
        getTranslator((p) => alive && setSt({ k: 'downloading', p }), pair).then(() => alive && run(isAlive), (e: Error) => alive && setSt({ k: 'error', msg: e.message }));
      } else if (a === 'downloadable') {
        // Chrome only starts the one-time model download inside a user gesture. If the user has just
        // clicked (a bubble, a word, "scan"), that activation is still valid and we start right away.
        const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
        if (active) download();
        else setSt({ k: 'need-download' });
      } else setSt({ k: a });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled]);

  const reported: MtState = enabled ? st.k : 'off';
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => onState?.(reported), [reported]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!text.trim()) return null;
  if (!enabled) {
    if (!offerable) return null;
    return (
      <div className={className} data-ml-mt="" data-state="off">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted">
          <span className="min-w-0 flex-1">Đang ở chế độ chỉ từ điển. Bật bản dịch máy của Chrome (chạy trên máy) để có câu dịch tự nhiên?</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              // Persist the opt-in, and start right away inside this click (Chrome needs the gesture to download the model).
              void new SettingsStore(chromeLocal()).update({ reading: { translationMode: 'machine' } });
              setJustEnabled(true);
              download();
            }}
          >
            Bật bản dịch máy
          </Button>
        </div>
      </div>
    );
  }

  function download() {
    // Called from a click handler: Chrome needs this user gesture to start the model download.
    setSt({ k: 'downloading', p: 0 });
    getTranslator((p) => setSt({ k: 'downloading', p }), pair).then(
      () => run(() => true),
      (e: Error) => setSt({ k: 'error', msg: e.message }),
    );
  }

  return (
    <div
      className={cx('ml-card rounded-2xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.08] px-3 py-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/calc(var(--ml-glass-hi)*0.5))] hover:border-accent/50 hover:shadow-[0_8px_20px_-10px_rgb(var(--ml-accent)/0.6)]', className)}
      data-ml-mt=""
      data-state={st.k}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Bản dịch{viEn ? ' Việt → Anh' : ''}
        {st.k === 'done' && <CopyButton text={st.text} label="Sao chép bản dịch" className="ml-auto h-6 w-6" />}
      </div>
      {st.k === 'done' ? (
        <div className="ml-tr text-[1.08em] font-semibold leading-snug text-text" data-ml-mt-text="">
          {st.text}
        </div>
      ) : st.k === 'translating' && st.progress && st.progress.total > 1 ? (
        <div className="space-y-1.5 text-[12.5px] text-muted" data-ml-mt-progress={`${st.progress.completed}/${st.progress.total}`}>
          <div className="flex items-center gap-2">
            <Spinner />
            <span className="min-w-0 flex-1">
              Đang dịch phần {Math.min(st.progress.total, st.progress.completed + 1)}/{st.progress.total}
              {st.progress.retrying > 0 ? ' (đang thử lại một phần…)' : ''}
            </span>
            <span className="tabular-nums">{Math.round((st.progress.charsDone / Math.max(1, st.progress.charsTotal)) * 100)}%</span>
          </div>
          <Progress value={st.progress.charsDone / Math.max(1, st.progress.charsTotal)} />
          <Button size="sm" onClick={cancel} data-ml-mt-cancel="">
            Huỷ
          </Button>
        </div>
      ) : st.k === 'partial' ? (
        <div className="space-y-2" data-ml-mt-partial={st.result.failedIndexes.length}>
          <div className="ml-tr text-[1.05em] leading-snug text-text">{st.result.text}</div>
          <div className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">
            {st.result.cancelled ? 'Đã huỷ.' : 'Một số phần chưa dịch được'} Còn {st.result.failedIndexes.length}/{st.result.chunks.length} phần giữ nguyên bản gốc.
            {st.result.outcomes.find((o) => o.error)?.error ? ` (${st.result.outcomes.find((o) => o.error)!.error})` : ''}
          </div>
          <Button size="sm" variant="primary" onClick={() => run(() => true, st.result)} data-ml-mt-retry="">
            {st.result.cancelled ? 'Dịch tiếp' : 'Thử lại phần lỗi'}
          </Button>
        </div>
      ) : st.k === 'checking' || st.k === 'translating' ? (
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner /> {st.k === 'checking' ? 'Đang kiểm tra…' : 'Đang dịch…'}
        </div>
      ) : st.k === 'need-download' ? (
        <div className="space-y-1.5 text-[12px] text-muted">
          <div>Chrome cần tải mô hình dịch {viEn ? 'Việt → Anh' : 'Anh → Việt'} một lần (từ Google). Sau đó mọi câu được dịch ngay trên máy, không gửi đi đâu.</div>
          <Button size="sm" variant="primary" onClick={download}>
            Tải mô hình dịch
          </Button>
        </div>
      ) : st.k === 'downloading' ? (
        <div className="space-y-1 text-[12px] text-muted">
          <div>Đang tải mô hình dịch… {Math.round(st.p * 100)}%</div>
          <Progress value={st.p} />
        </div>
      ) : st.k === 'error' ? (
        <div className="text-[12px] text-danger">Không dịch được: {st.msg}</div>
      ) : (
        <div className="text-[12px] text-muted">
          {st.k === 'unsupported' ? 'Trình duyệt này không có Translator API (cần Chrome 138+).' : `Bộ dịch trên máy này chưa hỗ trợ dịch ${viEn ? 'Việt → Anh' : 'Anh → Việt'}.`} Đang dùng nghĩa ghép từ điển.
        </div>
      )}
    </div>
  );
}
