/**
 * Settings → Tài khoản. Lingolens has no account system of its own (no backend, no sign-in): everything stays on the
 * device. This page shows the Google account connected through Smart Setup (the user's OWN Google Cloud project that
 * pays for Google translation), the translation mode, and what data lives on this device.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@/ui/components';
import { getSmartSetup } from '@/ui/smart-setup-client';
import { fmtDate, useUsage } from '@/ui/usage-client';
import { vocabStore } from '@/ui/VocabManager';
import { notesStore } from '@/ui/notes';
import type { SetupError } from '@/modules/smart-setup';
import { ERROR_INFO } from '@/modules/smart-setup';

type Status = Awaited<ReturnType<ReturnType<typeof getSmartSetup>['status']>>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
      <dt className="shrink-0 whitespace-nowrap text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

export function AccountSection() {
  const flow = getSmartSetup();
  const { snap, refresh } = useUsage();
  const [status, setStatus] = useState<Status | null>(null);
  const [counts, setCounts] = useState<{ words: number; notes: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<SetupError | null>(null);
  const [confirm, setConfirm] = useState(false);

  const reload = useCallback(async () => {
    setStatus(await flow.status());
    const [v, n] = await Promise.all([vocabStore.list().catch(() => []), notesStore.list().catch(() => [])]);
    setCounts({ words: v.length, notes: n.length });
  }, [flow]);
  useEffect(() => {
    void reload();
  }, [reload, snap?.hasKey, snap?.settings.provider]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e as SetupError);
    } finally {
      setBusy('');
      await reload();
      await refresh();
    }
  };

  if (!status || !snap) return <div className="py-6 text-[13px] text-muted">Đang tải…</div>;
  const google = snap.settings.provider === 'google';
  const billingBadge = status.billing === 'ok' ? <Badge tone="ok">Billing đang hoạt động</Badge> : status.billing === 'pending' ? <Badge tone="warn">Chưa có Billing</Badge> : <Badge>Billing chưa kiểm tra</Badge>;

  return (
    <div className="space-y-6" data-ml-account-section="">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Tài khoản</h1>
        <p className="mt-1 text-[13px] text-muted">Tài khoản Google Cloud dùng cho dịch bằng Google, và dữ liệu của bạn trên thiết bị này.</p>
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-text">Tài khoản Google Cloud</h2>
        <div className="ml-glass-card rounded-[20px] p-4">
          {status.connected ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3451d1] to-[#8b5cf6] text-[20px] font-bold text-white" aria-hidden="true">
                  {(status.account ?? '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold" data-ml-account-email="">{status.account ?? 'Tài khoản Google'}</div>
                  <div className="text-[12px] text-muted">Đã kết nối qua Lingolens Smart Setup</div>
                </div>
              </div>
              <dl className="mt-3 divide-y divide-border/60">
                <Row label="Dự án">{status.project ? `${status.project.name}` : '—'}</Row>
                <Row label="Mã dự án"><span className="font-mono text-[12px]">{status.project?.id ?? '—'}</span></Row>
                <Row label="Khoá API"><span className="font-mono">••••{status.keyHint ?? '----'}</span></Row>
                <Row label="Thanh toán">{billingBadge}</Row>
                <Row label="Chế độ dịch"><Badge tone={google ? 'accent' : 'neutral'}>{google ? 'Google API' : 'Dịch máy trên thiết bị'}</Badge></Row>
                <Row label="Kết nối từ">{status.completedAt ? new Date(status.completedAt).toLocaleDateString('vi-VN') : '—'}</Row>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => (location.hash = 'setup')}>Quản lý khoá</Button>
                <Button size="sm" onClick={() => (location.hash = 'billing')}>Billing</Button>
                <Button size="sm" onClick={() => (location.hash = 'usage')}>Hạn mức dịch</Button>
                <Button size="sm" disabled={!!busy} onClick={() => void act('reconnect', () => flow.reconnect())}>
                  {busy === 'reconnect' ? 'Đang chờ Google…' : 'Kết nối lại Google'}
                </Button>
              </div>
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger/[0.06] p-3">
                <div className="text-[13px] font-semibold">Đăng xuất khỏi Google Cloud</div>
                <div className="mt-0.5 text-[12px] text-muted">Xoá khoá API khỏi thiết bị này và quay về dịch máy trên thiết bị. Khoá trên Google không bị xoá (xoá trong Smart Setup nếu muốn).</div>
                <Button
                  size="sm"
                  variant="danger"
                  className="mt-2"
                  disabled={!!busy}
                  onClick={() => {
                    if (!confirm) {
                      setConfirm(true);
                      setTimeout(() => setConfirm(false), 4000);
                      return;
                    }
                    setConfirm(false);
                    void act('signout', () => flow.disconnect());
                  }}
                  data-ml-account-signout=""
                >
                  {confirm ? 'Bấm lại để xác nhận' : 'Đăng xuất'}
                </Button>
              </div>
            </>
          ) : (
            <div data-ml-account-empty="">
              <div className="text-[14px] font-semibold">Chưa kết nối tài khoản Google Cloud</div>
              <p className="mt-1 text-[12.5px] text-muted">Dịch máy trên thiết bị miễn phí vẫn hoạt động. Kết nối Google Cloud để dùng Google Translate API bằng tài khoản của chính bạn.</p>
              <Button className="mt-3" variant="primary" onClick={() => (location.hash = 'setup')} data-ml-account-connect="">
                Kết nối Google Cloud
              </Button>
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px]" role="alert">
              <b>{ERROR_INFO[error.code]?.title ?? 'Có lỗi'}.</b> {ERROR_INFO[error.code]?.fix}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-text">Tài khoản Lingolens và dữ liệu</h2>
        <div className="ml-glass-card rounded-[20px] p-4">
          <p className="text-[12.5px] leading-snug text-muted">Lingolens không có tài khoản riêng và không cần đăng nhập: không có máy chủ Lingolens nào lưu dữ liệu của bạn. Mọi thứ dưới đây nằm trên thiết bị này.</p>
          <dl className="mt-2 divide-y divide-border/60">
            <Row label="Sổ từ vựng">{counts ? `${counts.words} từ` : '…'}</Row>
            <Row label="Ghi chú">{counts ? `${counts.notes} ghi chú` : '…'}</Row>
            <Row label="Hạn mức dịch tháng này">{snap.usedChars.toLocaleString('vi-VN')} ký tự {snap.accountAt ? '(theo tài khoản Google)' : '(ước tính cục bộ)'}</Row>
            <Row label="Đặt lại hạn mức">{fmtDate(snap.nextReset)}</Row>
          </dl>
          <div className="mt-2 text-[11.5px] leading-snug text-subtle">Khoá API được cất trong kho bảo mật của thiết bị và không bao giờ gửi cho Lingolens. Mỗi thiết bị tự thiết lập riêng; không có đồng bộ qua tài khoản.</div>
        </div>
      </section>
    </div>
  );
}
