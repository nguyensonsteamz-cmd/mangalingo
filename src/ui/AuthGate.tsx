/** First-use screen: "Đăng nhập Google để bắt đầu". Wraps a page; shows the app once signed in (or when sign-in cannot be offered yet). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Notice, Spinner } from '@/ui/components';
import { IconLogo } from '@/ui/icons';
import { getSmartSetup, openConsole } from '@/ui/smart-setup-client';
import { SetupError } from '@/modules/smart-setup';
import { ERROR_INFO } from '@/modules/smart-setup';
import { send } from '@/shared/messages';
import { useGate, writeAuth } from './auth';

export function AuthGate({ children, goToSetup, compact }: { children: ReactNode; /** open the Smart Setup page after a successful sign-in */ goToSetup?: () => void; /** small toolbar popup */ compact?: boolean }) {
  const gate = useGate();
  if (gate === 'loading') {
    return (
      <div className={compact ? 'flex h-[200px] w-[340px] items-center justify-center' : 'flex min-h-[60vh] items-center justify-center'}>
        <Spinner />
      </div>
    );
  }
  if (gate === 'open') return <>{children}</>;
  return <AuthScreen goToSetup={goToSetup} compact={compact} />;
}

export function AuthScreen({ goToSetup, compact }: { goToSetup?: () => void; compact?: boolean }) {
  const flow = getSmartSetup();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const run = useRef(0);
  useEffect(() => {
    void flow.configured().then(setConfigured, () => setConfigured(false));
    // access may already have been granted (an earlier window that finished after its page was closed): pick it up without a prompt
    void flow
      .connectSilent()
      .then(async (st) => {
        if (st) {
          await writeAuth({ signedIn: true, account: st.account });
          goToSetup?.();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const signIn = async () => {
    if (compact) {
      // the toolbar popup closes as soon as the Google window opens, which would cut the sign-in off: do it in a full tab
      await send({ type: 'options:open', section: 'setup' }).catch(() => {});
      window.close();
      return;
    }
    const id = ++run.current;
    setBusy(true);
    setError(null);
    try {
      // a sign-in window that never answers (hidden behind another window, or an older request still pending) must not hang this screen
      const st = await Promise.race([
        flow.connect(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new SetupError('GOOGLE_AUTH_FAILED', 'Hết thời gian chờ cửa sổ đăng nhập của Google (2 phút). Hãy tìm và đóng cửa sổ đăng nhập Google đang mở (có thể nằm sau cửa sổ này) rồi bấm đăng nhập lại.')), 120_000)),
      ]);
      if (id !== run.current) return; // cancelled meanwhile
      await writeAuth({ signedIn: true, account: st.account });
      goToSetup?.();
    } catch (e) {
      if (id === run.current) setError(e as SetupError);
    } finally {
      if (id === run.current) setBusy(false);
    }
  };
  const cancel = () => {
    run.current++;
    setBusy(false);
  };

  return (
    <div
      className={compact ? 'flex w-[340px] flex-col items-center gap-3 px-5 py-5 text-center' : 'mx-auto flex min-h-[70vh] max-w-[440px] flex-col items-center justify-center gap-4 px-5 py-8 text-center'}
      data-ml-auth-gate=""
    >
      <IconLogo size={compact ? 44 : 56} />
      <div>
        <h1 className={compact ? 'text-[18px] font-bold tracking-tight text-text' : 'text-[22px] font-bold tracking-tight text-text'}>{compact ? 'Đăng nhập để bắt đầu' : 'Chào mừng đến LingoLens'}</h1>
        {!compact && (
          <p className="mt-1.5 text-[14px] text-muted">Đăng nhập tài khoản Google để bắt đầu. Bản dịch chính dùng Google Cloud Translation trong dự án Google Cloud của chính bạn; LingoLens không có máy chủ và không lưu mật khẩu của bạn.</p>
        )}
      </div>
      {configured === false ? (
        <div className="w-full space-y-3 text-left">
          <Notice tone="warn" title="Bản này chưa cấu hình đăng nhập Google">
            Nhà phát triển cần tạo một OAuth client ID (loại phù hợp với nền tảng này) trong Google Cloud và đưa vào lúc build (xem docs/GOOGLE-OAUTH-SETUP.md). Khi chưa có, bạn có thể dùng tạm bản dịch trên thiết bị và nhập Google API key thủ công trong Cài đặt.
          </Notice>
          <Button className="w-full" onClick={() => void writeAuth({ skipped: true })} data-ml-auth-skip="">
            Tiếp tục tạm thời, chưa đăng nhập
          </Button>
          <Button className="w-full" variant="ghost" onClick={() => openConsole('https://console.cloud.google.com/apis/credentials')}>
            Mở Google Cloud Console
          </Button>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <Button className="w-full" variant="primary" disabled={busy || configured === null} onClick={() => void signIn()} data-ml-auth-signin="">
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập với Google'}
          </Button>
          {busy && !compact && (
            <div className="space-y-1.5 text-[12.5px] text-muted" data-ml-auth-waiting="">
              <p>Một cửa sổ đăng nhập của Google sẽ mở ra. Nếu không thấy, hãy tìm nó trên thanh tác vụ (có thể nằm sau cửa sổ này).</p>
              <Button size="sm" variant="ghost" onClick={cancel} data-ml-auth-cancel="">
                Hủy và thử lại
              </Button>
            </div>
          )}
          {error && (
            <Notice tone="error" title={ERROR_INFO[error.code]?.title ?? 'Không đăng nhập được'}>
              {ERROR_INFO[error.code] ? `${ERROR_INFO[error.code].cause} ${ERROR_INFO[error.code].fix}` : error.message}
              {error.detail && (
                <span className="mt-2 block break-words font-mono text-[11px] opacity-80" data-ml-auth-detail="">
                  Chi tiết kỹ thuật: {error.detail}
                  {(globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id ? ` · ID extension: ${(globalThis as { chrome?: { runtime?: { id?: string } } }).chrome!.runtime!.id}` : ''}
                </span>
              )}
            </Notice>
          )}
        </div>
      )}
      {!compact && (
        <p className="text-[11.5px] text-subtle">Quyền được yêu cầu: quản lý dự án Google Cloud Translation của bạn (cloud-platform) và địa chỉ email để hiển thị tên tài khoản. Có thể thu hồi bất kỳ lúc nào trong Cài đặt → Tài khoản.</p>
      )}
    </div>
  );
}
