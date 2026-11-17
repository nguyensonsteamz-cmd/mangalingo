/**
 * Settings → Billing: is billing set up for the Google Cloud project, a way to fix it, and the translation cost history.
 * Lingolens never links or creates billing. Google offers no API for an app to read the real invoices, so the history here
 * is the app's own LOCAL estimate; the official invoices are one tap away in the Google Cloud Console.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Notice, cx } from '@/ui/components';
import { getSmartSetup, openConsole } from '@/ui/smart-setup-client';
import { fmtInt, fmtUsd, useUsage } from '@/ui/usage-client';
import { ERROR_INFO, type SetupError } from '@/modules/smart-setup';

type Status = Awaited<ReturnType<ReturnType<typeof getSmartSetup>['status']>>;

const BILLING_CONSOLE = 'https://console.cloud.google.com/billing';

export function BillingSection() {
  const flow = getSmartSetup();
  const { snap, refresh } = useUsage();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [failure, setFailure] = useState<SetupError | null>(null);

  const reload = useCallback(async () => setStatus(await flow.status()), [flow]);
  useEffect(() => {
    void reload();
  }, [reload, snap?.hasKey]);

  if (!status || !snap) return <div className="py-6 text-[13px] text-muted">Đang tải…</div>;

  const projectId = status.project?.id;
  const consoleUrl = projectId ? ERROR_INFO.BILLING_NOT_ENABLED.consoleUrl!(projectId) : BILLING_CONSOLE;

  const verify = async () => {
    setBusy(true);
    setMsg(null);
    setFailure(null);
    try {
      const r = await flow.verifyBilling();
      await reload();
      await refresh();
      if (r.enabled) setMsg({ tone: 'info', text: 'Thanh toán đang hoạt động: Google dịch được bằng khoá của bạn.' });
      else if (r.error) setFailure(r.error);
    } finally {
      setBusy(false);
    }
  };

  // ---- cost history: the app's OWN estimate per month (current month last)
  const s = snap.settings;
  const rows = [
    ...snap.history.map((h) => ({ month: h.month, chars: h.chars, requests: h.requests, paid: h.paidChars })),
    { month: snap.month, chars: snap.usedChars, requests: snap.requests, paid: snap.paidChars },
  ].reverse();
  const cost = (chars: number) => (Math.max(0, chars - s.freeQuotaChars) / 1_000_000) * s.pricePerMillionUsd;

  const state = !status.connected ? 'none' : status.billing;
  const badge =
    state === 'ok' ? <Badge tone="ok">Đã thiết lập</Badge> : state === 'pending' ? <Badge tone="warn">Chưa thiết lập</Badge> : state === 'unknown' ? <Badge>Chưa kiểm tra</Badge> : <Badge>Chưa kết nối Google Cloud</Badge>;

  return (
    <div className="space-y-6" data-ml-billing-section="" data-ml-billing-state={state}>
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Billing</h1>
        <p className="mt-1 text-[13px] text-muted">
          Cloud Translation cần một tài khoản thanh toán gắn với dự án, kể cả khi bạn chỉ dùng phần miễn phí. Lingolens không tự liên kết hay tạo thanh toán thay bạn.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-text">Trạng thái</h2>
        <div className="ml-glass-card space-y-3 rounded-[20px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[13px]">
              <div className="text-muted">Dự án</div>
              <div className="truncate font-medium">{status.project ? `${status.project.name} (${status.project.id})` : '—'}</div>
            </div>
            <div data-ml-billing-badge="">{badge}</div>
          </div>
          {state === 'none' && (
            <div className="text-[12.5px] text-muted">
              Hãy kết nối Google Cloud bằng{' '}
              <button type="button" className="font-semibold text-accent underline" onClick={() => (location.hash = 'setup')}>
                Lingolens Smart Setup
              </button>{' '}
              trước.
            </div>
          )}
          {state === 'pending' && <div className="rounded-xl bg-warn/10 px-3 py-2 text-[12.5px] text-warn">Dự án chưa có thanh toán nên Google chưa dịch được. Mở trang Billing, liên kết tài khoản thanh toán của bạn với dự án rồi bấm "Kiểm tra lại".</div>}
          {state === 'ok' && <div className="rounded-xl bg-ok/10 px-3 py-2 text-[12.5px] text-ok">✓ Thanh toán đang hoạt động.</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openConsole(consoleUrl)} data-ml-billing-open="">
              Mở trang Billing ↗
            </Button>
            <Button size="sm" variant="primary" disabled={busy || state === 'none'} onClick={() => void verify()} data-ml-billing-verify="">
              {busy ? 'Đang kiểm tra…' : state === 'pending' ? 'Tôi đã liên kết, kiểm tra lại' : 'Kiểm tra lại'}
            </Button>
          </div>
          <div className="text-[11.5px] text-subtle">Kiểm tra bằng một lần dịch thử 5 ký tự với khoá đã lưu, không cần đăng nhập lại.</div>
        </div>
      </section>

      {failure && (
        <div className="rounded-2xl border-2 border-danger/50 bg-danger/10 p-3.5" role="alert" data-ml-billing-error={failure.code}>
          <div className="text-[14px] font-bold text-text">⚠️ {ERROR_INFO[failure.code].title}</div>
          <div className="mt-1 text-[12.5px] text-muted">{ERROR_INFO[failure.code].cause}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            <b className="text-text">Cách xử lý:</b> {ERROR_INFO[failure.code].fix}
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section>
        <h2 className="mb-1 text-[15px] font-semibold text-text">Lịch sử chi phí dịch{snap.accountAt ? ' (tháng này theo tài khoản Google)' : ' (ước tính cục bộ)'}</h2>
        <p className="mb-2 text-[12.5px] text-muted">Tháng này lấy số ký tự Google ghi nhận cho cả tài khoản (nếu đã đọc ở mục Hạn mức dịch), các tháng trước là ước tính trên thiết bị. Chi phí tính theo đơn giá bạn đặt ở mục Hạn mức dịch. Không phải hoá đơn của Google.</p>
        <div className="ml-glass-card overflow-x-auto rounded-[20px] p-4" data-ml-billing-history="">
          <table className="w-full text-left text-[12px] tabular-nums">
            <thead>
              <tr className="text-subtle">
                <th className="py-1 font-medium">Tháng</th>
                <th className="py-1 font-medium">Ký tự</th>
                <th className="py-1 font-medium">Trả phí</th>
                <th className="py-1 text-right font-medium">Ước tính</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.month} className={cx('border-t border-border/60', i === 0 && 'font-semibold')}>
                  <td className="py-1.5">{r.month}{i === 0 ? ' •' : ''}</td>
                  <td className="py-1.5">{fmtInt(r.chars)}</td>
                  <td className="py-1.5">{fmtInt(r.paid)}</td>
                  <td className="py-1.5 text-right">{fmtUsd(cost(r.chars))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-text">Hoá đơn chính thức</h2>
        <div className="ml-glass-card space-y-2 rounded-[20px] p-4">
          <p className="text-[12.5px] text-muted">Google không cung cấp API để ứng dụng đọc hoá đơn, vì vậy Lingolens không thể hiển thị hoá đơn thật. Xem hoá đơn, báo cáo chi phí và đặt cảnh báo ngân sách ngay trên Google Cloud.</p>
          <Button size="sm" onClick={() => openConsole(BILLING_CONSOLE)} data-ml-billing-invoices="">
            Mở hoá đơn và báo cáo trên Google Cloud ↗
          </Button>
        </div>
      </section>
    </div>
  );
}
