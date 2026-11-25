import { useCallback, useEffect, useState } from 'react';
import { VOCAB_KEY } from '@/storage/vocab-store';
import { vocabStore } from '@/ui/VocabManager';
import { copyText, iosBridge, widgetStatus, widgetSync, type WidgetStatus } from './ios';
import { pasteText, widgetWords } from './widget';

/**
 * Keeps the widget's data fresh: the saved words are sent to the app shell when the app starts and (debounced) whenever the notebook
 * changes. Only on the iPhone app.
 */
export function useWidgetSync() {
  useEffect(() => {
    if (!iosBridge()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = () => void vocabStore.list().then((l) => widgetSync(widgetWords(l)));
    push();
    const on = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local' || !(VOCAB_KEY in changes)) return;
      clearTimeout(timer);
      timer = setTimeout(push, 1500);
    };
    chrome.storage.onChanged.addListener(on);
    return () => {
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(on);
    };
  }, []);
}

/** Home-screen card for the widget (test build): says whether the widget can read the app's words, and copies the paste list. */
export function WidgetCard() {
  const [st, setSt] = useState<WidgetStatus | null | 'loading'>('loading');
  const [msg, setMsg] = useState('');
  const refresh = useCallback(async () => {
    const l = await vocabStore.list();
    await widgetSync(widgetWords(l)); // write first, so the report below reflects it
    setSt(await widgetStatus());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!iosBridge()) return null;
  return (
    <div className="ml-glass-card rounded-[24px] px-4 py-3.5" data-ml-widget-card="">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-[22px]">🔤</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">Widget từ vựng (thử nghiệm)</span>
          <span className="block text-[12.5px] leading-snug text-muted">Một từ đã lưu, đổi mỗi giờ. Giữ màn hình chính → dấu + → LingoLens.</span>
        </span>
      </div>
      <pre className="mt-2.5 whitespace-pre-wrap rounded-xl bg-text/[0.05] p-2.5 text-[11px] leading-snug text-muted" data-ml-widget-status="">
        {st === 'loading' ? 'Đang kiểm tra…' : st ? st.text : 'Không có cầu nối với ứng dụng iPhone.'}
      </pre>
      {st && st !== 'loading' && (
        <div className="mt-1.5 text-[12px] font-semibold" data-ml-widget-verdict={st.ok ? 'group' : 'paste'}>
          {st.ok ? '✅ Widget tự đọc được sổ từ.' : '⚠️ App Group không dùng được: dùng cách dán (nút bên dưới).'}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => void refresh()} className="ml-press rounded-full bg-text/[0.07] px-3 py-1.5 text-[12.5px] font-semibold text-muted" data-ml-widget-refresh="">
          Kiểm tra lại
        </button>
        <button
          type="button"
          className="ml-btn-primary ml-press rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
          data-ml-widget-copy=""
          onClick={async () => {
            const words = widgetWords(await vocabStore.list());
            if (!words.length) return setMsg('Chưa có từ nào để chép: hãy lưu vài từ trước.');
            const ok = await copyText(pasteText(words));
            setMsg(ok ? `Đã chép ${Math.min(words.length, 120)} từ. Giữ widget → Chỉnh sửa widget → dán vào ô “Danh sách từ”.` : 'Không chép được.');
          }}
        >
          Chép danh sách cho widget
        </button>
      </div>
      {msg && (
        <div className="mt-1.5 text-[12px] text-muted" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}
