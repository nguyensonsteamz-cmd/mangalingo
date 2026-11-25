import { useCallback, useEffect, useState } from 'react';
import { VOCAB_KEY } from '@/storage/vocab-store';
import { vocabStore } from '@/ui/VocabManager';
import { copyText, iosBridge, widgetConfigure, widgetDisconnect, widgetStatus, widgetSync, type WidgetStatus } from './ios';
import { pasteText, widgetWords } from './widget';

/**
 * Keeps the widget's data fresh: the saved words are sent to the app shell when the app starts and (debounced) whenever the notebook
 * changes. The shell uploads them (encrypted) when the sync is connected and asks the widget to reload. Only on the iPhone app.
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

const inputCls = 'ml-focus ml-glass-field h-10 w-full rounded-xl px-3 text-[14px] text-text';
const btnCls = 'ml-press rounded-full bg-text/[0.07] px-3 py-1.5 text-[12.5px] font-semibold text-muted';
const primaryCls = 'ml-btn-primary ml-press rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold';

/** Home-screen card for the widget: connects the encrypted GitHub sync (the widget then follows the saved words by itself). */
export function WidgetCard() {
  const [st, setSt] = useState<WidgetStatus | null | 'loading'>('loading');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');

  const sync = useCallback(async () => {
    const l = await vocabStore.list();
    const r = await widgetSync(widgetWords(l)); // uploads when connected; the report below reflects it
    setSt(await widgetStatus());
    return r;
  }, []);
  useEffect(() => {
    void sync();
  }, [sync]);
  if (!iosBridge()) return null;

  const status = st === 'loading' ? null : st;
  const connected = !!status?.cloud;

  const connect = async () => {
    setBusy(true);
    setMsg('');
    try {
      await widgetConfigure(repo, token);
      setToken('');
      const r = await sync();
      setMsg(r.cloud === 'ok' ? 'Đã kết nối và đồng bộ. Giờ chép mã đồng bộ và dán vào widget (một lần).' : r.cloud);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-glass-card rounded-[24px] px-4 py-3.5" data-ml-widget-card="">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-[22px]">🔤</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">Widget từ vựng</span>
          <span className="block text-[12.5px] leading-snug text-muted">Một từ đã lưu hiện trên màn hình chính, đổi mỗi giờ. Bấm mũi tên trên widget để sang từ khác ngay.</span>
        </span>
      </div>

      {status?.ok && (
        <div className="mt-2 text-[12px] font-semibold" data-ml-widget-verdict="group">
          ✅ Widget tự đọc được sổ từ (không cần cài đặt gì thêm).
        </div>
      )}

      {!connected ? (
        <div className="mt-2.5 space-y-2" data-ml-widget-connect="">
          <div className="text-[12.5px] font-semibold text-text">Tự cập nhật khi bạn lưu từ mới</div>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12.5px] leading-snug text-muted">
            <li>
              Trên github.com, tạo một repo <b>công khai (Public)</b>, ví dụ <code>lingolens-sync</code>.
            </li>
            <li>
              Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → tạo token: chọn <i>Only select repositories</i> → repo vừa tạo; quyền <b>Contents: Read and write</b>.
            </li>
            <li>Nhập tên repo và token vào đây.</li>
          </ol>
          <input className={inputCls} placeholder="ten-ban/lingolens-sync" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} data-ml-widget-repo="" />
          <input className={inputCls} type="password" placeholder="Token GitHub (github_pat_…)" value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} data-ml-widget-token="" />
          <button type="button" disabled={busy || !repo.trim() || !token.trim()} className={primaryCls + ' disabled:opacity-50'} onClick={() => void connect()} data-ml-widget-connect-btn="">
            {busy ? 'Đang kết nối…' : 'Kết nối'}
          </button>
          <div className="text-[11.5px] leading-snug text-subtle">
            Danh sách từ được <b>mã hoá trên iPhone trước khi gửi</b>: repo công khai chỉ chứa dữ liệu mã hoá, khoá nằm trong mã đồng bộ của bạn. Token cất trong Keychain của iPhone, chỉ gửi tới api.github.com.
          </div>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2" data-ml-widget-connected="">
          <div className="text-[12.5px] text-muted">
            Đồng bộ với <b className="text-text">{status?.repo}</b>. {status?.last}
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12.5px] leading-snug text-muted">
            <li>Giữ màn hình chính → dấu + → LingoLens → Thêm tiện ích.</li>
            <li>
              Bấm “Chép mã đồng bộ”, rồi giữ widget → Chỉnh sửa widget → dán vào ô <b>Mã đồng bộ</b> (chỉ một lần).
            </li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryCls}
              data-ml-widget-copy-code=""
              onClick={async () => {
                const code = status?.code;
                setMsg(code && (await copyText(code)) ? 'Đã chép mã đồng bộ. Dán vào ô “Mã đồng bộ” của widget.' : 'Không chép được.');
              }}
            >
              Chép mã đồng bộ
            </button>
            <button
              type="button"
              className={btnCls}
              onClick={async () => {
                setBusy(true);
                const r = await sync();
                setMsg(r.cloud === 'ok' ? 'Đã đồng bộ.' : r.cloud);
                setBusy(false);
              }}
              disabled={busy}
              data-ml-widget-sync-now=""
            >
              {busy ? 'Đang gửi…' : 'Đồng bộ ngay'}
            </button>
            <button
              type="button"
              className={btnCls}
              onClick={async () => {
                setSt(await widgetDisconnect());
                setMsg('Đã ngắt kết nối. Token đã xoá khỏi iPhone (dữ liệu mã hoá vẫn nằm trong repo của bạn: bạn có thể xoá repo).');
              }}
            >
              Ngắt kết nối
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className="mt-2 text-[12px] leading-snug text-muted" role="status" data-ml-widget-msg="">
          {msg}
        </div>
      )}

      <details className="mt-2 text-[11px] text-subtle">
        <summary>Cách dự phòng và chi tiết kỹ thuật</summary>
        <div className="mt-1.5 space-y-1.5">
          <div className="leading-snug text-muted">Không muốn dùng GitHub: bấm nút dưới, rồi giữ widget → Chỉnh sửa widget → dán vào ô “Danh sách từ (cách dự phòng)”. Phải chép và dán lại khi sổ từ đổi nhiều.</div>
          <button
            type="button"
            className={btnCls}
            data-ml-widget-copy=""
            onClick={async () => {
              const words = widgetWords(await vocabStore.list());
              if (!words.length) return setMsg('Chưa có từ nào để chép: hãy lưu vài từ trước.');
              const ok = await copyText(pasteText(words));
              setMsg(ok ? `Đã chép ${Math.min(words.length, 150)} từ. Dán vào ô “Danh sách từ”.` : 'Không chép được.');
            }}
          >
            Chép danh sách (cách dự phòng)
          </button>
          <pre className="whitespace-pre-wrap rounded-xl bg-text/[0.05] p-2 leading-snug text-muted" data-ml-widget-status="">
            {st === 'loading' ? 'Đang kiểm tra…' : st ? st.text : 'Không có cầu nối với ứng dụng iPhone.'}
          </pre>
        </div>
      </details>
    </div>
  );
}
