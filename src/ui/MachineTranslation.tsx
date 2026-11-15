/**
 * "Bản dịch máy (Chrome)" block: natural EN→VI translation from Chrome's on-device Translator API.
 * Rendered only when the user enabled it in Settings; falls back to a short notice when the browser
 * cannot translate EN→VI. The dictionary gloss stays visible underneath as a cross-check.
 */
import { useEffect, useState } from 'react';
import type { Settings } from '@/shared/settings';
import { getTranslator, machineTranslate, mtAvailability, type MtAvailability } from '@/translation/chrome-mt';
import { Button, Progress, Spinner, cx } from './components';
import { SettingsStore } from '@/storage/settings-store';
import { chromeLocal } from '@/storage/kv';

type State =
  | { k: 'checking' }
  | { k: 'unsupported' | 'unavailable' }
  | { k: 'need-download' }
  | { k: 'downloading'; p: number }
  | { k: 'translating' }
  | { k: 'done'; text: string }
  | { k: 'error'; msg: string };

export type MtState = State['k'] | 'off';

export function MachineTranslation({ text, s, className, onState }: { text: string; s: Settings; className?: string; onState?: (k: MtState) => void }) {
  const [st, setSt] = useState<State>({ k: 'checking' });
  const [justEnabled, setJustEnabled] = useState(false);
  const enabled = s.reading.translationMode === 'machine' || justEnabled;
  // When the feature is off, offer a one-click "enable" only if this Chrome can translate EN→VI.
  const [offerable, setOfferable] = useState(false);
  useEffect(() => {
    if (enabled) return;
    let alive = true;
    void mtAvailability().then((a) => alive && setOfferable(a !== 'unsupported' && a !== 'unavailable'));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const run = (alive: () => boolean) => {
    setSt({ k: 'translating' });
    machineTranslate(text).then(
      (out) => alive() && setSt({ k: 'done', text: out }),
      (e: Error) => alive() && setSt({ k: 'error', msg: e.message }),
    );
  };

  useEffect(() => {
    if (!enabled || !text.trim()) return;
    let alive = true;
    const isAlive = () => alive;
    setSt({ k: 'checking' });
    void mtAvailability().then((a: MtAvailability) => {
      if (!alive) return;
      if (a === 'available') run(isAlive);
      else if (a === 'downloading') {
        setSt({ k: 'downloading', p: 0 });
        getTranslator((p) => alive && setSt({ k: 'downloading', p })).then(() => alive && run(isAlive), (e: Error) => alive && setSt({ k: 'error', msg: e.message }));
      } else if (a === 'downloadable') {
        // Chrome only starts the one-time model download inside a user gesture. If the user has just
        // clicked (a bubble, a word, "scan"), that activation is still valid and we start right away.
        const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
        if (active) download();
        else setSt({ k: 'need-download' });
      }
      else setSt({ k: a });
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted">
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
    getTranslator((p) => setSt({ k: 'downloading', p })).then(
      () => run(() => true),
      (e: Error) => setSt({ k: 'error', msg: e.message }),
    );
  }

  return (
    <div
      className={cx('ml-card rounded-xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.07] px-3 py-2.5 hover:border-accent/50 hover:shadow-[0_8px_20px_-10px_rgb(var(--ml-accent)/0.6)]', className)}
      data-ml-mt=""
      data-state={st.k}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Bản dịch
      </div>
      {st.k === 'done' ? (
        <div className="ml-tr text-[1.08em] font-semibold leading-snug text-text" data-ml-mt-text="">
          {st.text}
        </div>
      ) : st.k === 'checking' || st.k === 'translating' ? (
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner /> {st.k === 'checking' ? 'Đang kiểm tra…' : 'Đang dịch…'}
        </div>
      ) : st.k === 'need-download' ? (
        <div className="space-y-1.5 text-[12px] text-muted">
          <div>Chrome cần tải mô hình dịch Anh → Việt một lần (từ Google). Sau đó mọi câu được dịch ngay trên máy, không gửi đi đâu.</div>
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
          {st.k === 'unsupported' ? 'Trình duyệt này không có Translator API (cần Chrome 138+).' : 'Chrome trên máy này chưa hỗ trợ dịch Anh → Việt.'} Đang dùng nghĩa ghép từ điển.
        </div>
      )}
    </div>
  );
}
