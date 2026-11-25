import { useCallback, useEffect, useRef, useState } from 'react';
import { VOCAB_KEY } from '@/storage/vocab-store';
import { vocabStore } from '@/ui/VocabManager';
import { copyText, githubPoll, githubStart, iosBridge, iosPost, widgetConfigure, widgetDisconnect, widgetStatus, widgetSync, type GithubStart, type WidgetStatus } from './ios';
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
const primaryCls = 'ml-btn-primary ml-press rounded-full px-4 py-2 text-[13.5px] font-semibold';

const Step = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className="flex gap-2 text-[12.5px] leading-snug">
    <span className="w-5 shrink-0 text-center">{done ? '✅' : '⬜'}</span>
    <span className={done ? 'text-muted' : 'text-text'}>{children}</span>
  </li>
);

/**
 * Home-screen card for the widget. For a newcomer the whole set-up is: tap "Bật tự cập nhật", type the short code on GitHub, add the
 * widget and paste the sync code once. The app checks each step by itself and says when it is done.
 */
export function WidgetCard() {
  const [st, setSt] = useState<WidgetStatus | null | 'loading'>('loading');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<GithubStart | null>(null);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => setSt(await widgetStatus()), []);
  const sync = useCallback(async () => {
    const l = await vocabStore.list();
    const r = await widgetSync(widgetWords(l)); // uploads when connected
    await refresh();
    return r;
  }, [refresh]);

  useEffect(() => {
    void sync();
  }, [sync]);

  const status = st === 'loading' ? null : st;
  const connected = !!status?.cloud;
  const linked = !!status?.linked;

  // while the widget has not got the sync code yet, look again every few seconds (the app can see the widgets on the Home Screen)
  useEffect(() => {
    if (!connected || linked) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [connected, linked, refresh]);

  const stopPolling = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);
  if (!iosBridge()) return null;

  const finishLogin = async () => {
    stopPolling();
    setLogin(null);
    const r = await sync();
    const s = await widgetStatus();
    setSt(s);
    if (s?.code) await copyText(s.code); // one tap less: the code is already on the clipboard
    setMsg(r.cloud === 'ok' || r.cloud === 'off' ? 'Đã kết nối GitHub. Mã đồng bộ đã được chép sẵn: giờ thêm widget và dán mã vào.' : r.cloud);
  };

  const startLogin = async () => {
    setBusy(true);
    setMsg('');
    try {
      const info = await githubStart();
      setLogin(info);
      await copyText(info.userCode); // already on the clipboard: paste it on GitHub
      stopPolling();
      const started = Date.now();
      poll.current = setInterval(
        async () => {
          if (Date.now() - started > info.expiresIn * 1000) {
            stopPolling();
            setLogin(null);
            return setMsg('Mã đã hết hạn. Bấm “Bật tự cập nhật” để lấy mã mới.');
          }
          try {
            if ((await githubPoll(info.deviceCode)) === 'ok') await finishLogin();
          } catch (e) {
            stopPolling();
            setLogin(null);
            setMsg((e as Error).message);
          }
        },
        Math.max(5, info.interval + 1) * 1000,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manualConnect = async () => {
    setBusy(true);
    setMsg('');
    try {
      await widgetConfigure(repo, token);
      setToken('');
      await finishLogin();
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

      {!connected && !login && (
        <div className="mt-3 space-y-2.5" data-ml-widget-connect="">
          {status?.github ? (
            <>
              <button type="button" disabled={busy} className={primaryCls + ' w-full disabled:opacity-50'} onClick={() => void startLogin()} data-ml-widget-start="">
                {busy ? 'Đang lấy mã…' : 'Bật tự cập nhật'}
              </button>
              <div className="text-[11.5px] leading-snug text-subtle">
                Đăng nhập GitHub (miễn phí) bằng một mã ngắn. LingoLens tạo một repo công khai tên <code>lingolens-sync</code> trong tài khoản của bạn để chứa danh sách từ <b>đã mã hoá</b>: người khác mở repo cũng không đọc được. GitHub chỉ có quyền “public_repo” để tạo repo; bạn thu hồi bất cứ lúc nào ở github.com/settings/applications.
              </div>
            </>
          ) : (
            <div className="text-[12.5px] leading-snug text-muted">Bản này chưa có đăng nhập GitHub tự động: dùng cách nhập token bên dưới.</div>
          )}
          <details className="text-[11.5px] text-subtle" open={!status?.github}>
            <summary>Nâng cao: tự nhập token GitHub</summary>
            <div className="mt-2 space-y-2">
              <ol className="list-decimal space-y-0.5 pl-5 text-[12px] leading-snug text-muted">
                <li>
                  Trên github.com tạo repo <b>Public</b>, ví dụ <code>lingolens-sync</code>.
                </li>
                <li>
                  Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b>: chọn repo đó, quyền <b>Contents: Read and write</b>.
                </li>
              </ol>
              <input className={inputCls} placeholder="ten-ban/lingolens-sync" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} data-ml-widget-repo="" />
              <input className={inputCls} type="password" placeholder="Token GitHub (github_pat_…)" value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} data-ml-widget-token="" />
              <button type="button" disabled={busy || !repo.trim() || !token.trim()} className={btnCls + ' disabled:opacity-50'} onClick={() => void manualConnect()} data-ml-widget-connect-btn="">
                Kết nối bằng token
              </button>
            </div>
          </details>
        </div>
      )}

      {login && (
        <div className="mt-3 space-y-2.5 rounded-2xl bg-text/[0.05] p-3" data-ml-widget-login="">
          <div className="text-[12.5px] font-semibold text-text">1. Nhập mã này trên GitHub</div>
          <div className="select-all text-center font-mono text-[30px] font-bold tracking-[0.12em] text-accent" data-ml-widget-usercode="">
            {login.userCode}
          </div>
          <div className="text-[12px] leading-snug text-muted">Mã đã được chép sẵn. Bấm “Mở GitHub”, dán mã, rồi bấm <b>Authorize</b>. Quay lại LingoLens: app tự nhận ra.</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryCls} onClick={() => void iosPost({ cmd: 'openUrl', url: login.verifyUrl }).catch(() => {})} data-ml-widget-open-github="">
              Mở GitHub
            </button>
            <button type="button" className={btnCls} onClick={() => void copyText(login.userCode)}>
              Chép lại mã
            </button>
            <button
              type="button"
              className={btnCls}
              onClick={() => {
                stopPolling();
                setLogin(null);
              }}
            >
              Hủy
            </button>
          </div>
          <div className="text-[11.5px] text-subtle">Đang chờ bạn xác nhận trên GitHub…</div>
        </div>
      )}

      {connected && (
        <div className="mt-3 space-y-2" data-ml-widget-connected="">
          <ol className="space-y-1.5">
            <Step done>
              Đã kết nối GitHub (<b>{status?.repo}</b>). {status?.last}
            </Step>
            <Step done={(status?.widgets ?? 0) > 0}>
              Thêm widget: giữ màn hình chính → dấu <b>+</b> → LingoLens → <b>Thêm tiện ích</b>.
              {(status?.widgets ?? 0) > 0 ? ` (đã thấy ${status?.widgets} widget)` : ''}
            </Step>
            <Step done={linked}>
              Giữ widget → <b>Chỉnh sửa widget</b> → dán vào ô <b>Mã đồng bộ</b>. {linked ? 'Widget đã nhận mã.' : 'Đang chờ…'}
            </Step>
          </ol>
          {linked ? (
            <div className="rounded-xl bg-ok/10 px-3 py-2 text-[12.5px] font-semibold text-ok" data-ml-widget-done="">
              🎉 Xong! Từ giờ widget tự đổi khi bạn lưu từ mới.
            </div>
          ) : (
            <button
              type="button"
              className={primaryCls}
              data-ml-widget-copy-code=""
              onClick={async () => setMsg(status?.code && (await copyText(status.code)) ? 'Đã chép mã đồng bộ. Dán vào ô “Mã đồng bộ” của widget.' : 'Không chép được.')}
            >
              Chép mã đồng bộ
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnCls}
              disabled={busy}
              data-ml-widget-sync-now=""
              onClick={async () => {
                setBusy(true);
                const r = await sync();
                setMsg(r.cloud === 'ok' ? 'Đã đồng bộ.' : r.cloud);
                setBusy(false);
              }}
            >
              {busy ? 'Đang gửi…' : 'Đồng bộ ngay'}
            </button>
            <button type="button" className={btnCls} onClick={async () => setMsg(status?.code && (await copyText(status.code)) ? 'Đã chép mã đồng bộ.' : 'Không chép được.')}>
              Chép mã
            </button>
            <button
              type="button"
              className={btnCls}
              onClick={async () => {
                setSt(await widgetDisconnect());
                setMsg('Đã ngắt kết nối và xoá quyền khỏi iPhone. (Repo lingolens-sync trên GitHub vẫn còn: bạn có thể xoá nó.)');
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
