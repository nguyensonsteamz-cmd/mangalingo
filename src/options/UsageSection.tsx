/**
 * Settings → "Nguồn dịch": choose where translation happens (on the device, or Google Translate web) and see the local counters.
 * There is no API key, billing or quota here: Google Cloud Translation was removed. All figures are LOCAL counters.
 */
import { useState, type ReactNode } from 'react';
import { Button, Field, Notice, Segmented } from '@/ui/components';
import { fmtDate, fmtInt, usageActions, useUsage } from '@/ui/usage-client';
import { USAGE_DISCLAIMER } from '@/modules/usage/disclaimer';
import type { UsageSettings } from '@/modules/usage/types';
import { copyText } from '@/mobile/ios';

function Card({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">{title}</h2>
        {desc && <p className="mt-0.5 text-[12.5px] text-muted">{desc}</p>}
      </div>
      <div className="ml-glass-card divide-y divide-border/60 rounded-[20px] px-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-xl bg-text/[0.04] px-3 py-2" data-ml-usage-stat={testId}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-[16px] font-bold tabular-nums text-text">{value}</div>
      {sub && <div className="text-[11px] text-subtle">{sub}</div>}
    </div>
  );
}

function download(name: string, text: string, mime: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function UsageSection() {
  const { snap, error, refresh } = useUsage();
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const save = async (patch: Partial<UsageSettings>) => {
    try {
      await usageActions.settings(patch);
      await refresh();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  if (!snap) {
    return <div className="py-6 text-[13px] text-muted">{error ? `Không tải được dữ liệu: ${error}` : 'Đang tải…'}</div>;
  }
  const s = snap.settings;
  const web = s.provider === 'google-web';

  const exportReport = async (format: 'json' | 'csv') => {
    const text = await usageActions.exportReport(format);
    const ok = download(`lingolens-usage-${snap.month}.${format}`, text, format === 'csv' ? 'text/csv' : 'application/json');
    if (!ok) {
      const copied = await copyText(text);
      setMsg({ tone: 'info', text: copied ? 'Không tải tệp được trên thiết bị này; báo cáo đã được chép vào bộ nhớ tạm.' : 'Không xuất được báo cáo.' });
    } else setMsg({ tone: 'info', text: `Đã xuất báo cáo ${format.toUpperCase()}.` });
  };

  return (
    <div className="space-y-6" data-ml-usage-section="">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Nguồn dịch</h1>
        <p className="mt-1 text-[13px] text-muted">
          Chọn nơi dịch diễn ra: trên thiết bị của bạn (mặc định, không gửi văn bản đi đâu) hoặc Google Dịch (web), không cần khoá API, tài khoản hay thanh toán.
        </p>
      </div>

      <Card title="Dịch bằng">
        <Field
          label="Nguồn dịch"
          description={
            web
              ? 'Văn bản được gửi trực tiếp từ thiết bị tới Google Dịch (web). Không cần khoá API, không tính phí. Đây không phải API chính thức của Google: Google có thể giới hạn hoặc chặn bất cứ lúc nào, khi đó hãy dùng dịch trên máy.'
              : 'Dịch trên máy (Chrome Translator / Apple Translation / ML Kit): không gửi văn bản đi đâu, không tính phí.'
          }
        >
          <Segmented
            value={s.provider}
            onChange={(v) => void save({ provider: v })}
            options={[
              { value: 'device', label: 'Trên máy' },
              { value: 'google-web', label: 'Google Dịch (web)' },
            ]}
          />
        </Field>
        {web && (
          <div className="py-3 text-[12px] text-muted" data-ml-usage-web-note="">
            Google Dịch (web) không có hạn mức hay hoá đơn chính thức, nên LingoLens không hiển thị hạn mức hay chi phí. LingoLens gửi từng yêu cầu một, cách nhau tối thiểu 1,2 giây, và tạm ngừng 15 phút nếu Google giới hạn hoặc chặn. Khi đó LingoLens không tự chuyển sang nguồn khác: hãy chọn lại “Trên máy”.
          </div>
        )}
      </Card>

      <Card title="Số liệu tháng này (UTC)" desc="Bộ đếm cục bộ. Dịch trên máy được ghi riêng, chỉ để tham khảo.">
        <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3" data-ml-usage-web-stats="">
          <Stat testId="used" label="Ký tự đã dịch" value={fmtInt(snap.usedChars)} />
          <Stat testId="requests" label="Yêu cầu thành công" value={fmtInt(snap.requests)} />
          <Stat testId="failed" label="Yêu cầu lỗi" value={fmtInt(snap.failedRequests)} />
          <Stat testId="cached" label="Dịch từ bộ nhớ đệm" value={fmtInt(snap.cachedRequests)} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-[12.5px] text-muted">
          <span>
            Đặt lại lần cuối: <b className="text-text" data-ml-usage-last-reset="">{fmtDate(snap.lastReset)}</b>
          </span>
          <span>
            Đặt lại tiếp theo: <b className="text-text" data-ml-usage-next-reset="">{fmtDate(snap.nextReset)}</b>
          </span>
        </div>
        <div className="py-3 text-[11.5px] leading-snug text-subtle">{USAGE_DISCLAIMER}</div>
      </Card>

      <Card title="Dữ liệu sử dụng" desc="Chỉ nằm trên thiết bị này.">
        <div className="flex flex-wrap gap-2 py-3">
          <Button size="sm" onClick={() => void exportReport('json')} data-ml-usage-export="">
            Xuất báo cáo (JSON)
          </Button>
          <Button size="sm" onClick={() => void exportReport('csv')}>
            Xuất CSV
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              await usageActions.clearHistory();
              await refresh();
              setMsg({ tone: 'info', text: 'Đã xoá lịch sử sử dụng (số liệu tháng này được giữ).' });
            }}
          >
            Xoá lịch sử
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!confirmReset) {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 4000);
                return;
              }
              setConfirmReset(false);
              await usageActions.reset();
              await refresh();
              setMsg({ tone: 'info', text: 'Đã đặt lại toàn bộ dữ liệu sử dụng cục bộ.' });
            }}
            data-ml-usage-reset=""
          >
            {confirmReset ? 'Bấm lại để xác nhận' : 'Đặt lại dữ liệu cục bộ'}
          </Button>
        </div>
        {snap.history.length > 0 && (
          <div className="py-3">
            <div className="mb-1 text-[12.5px] font-medium text-text">Lịch sử theo tháng</div>
            <table className="w-full text-left text-[12px] tabular-nums text-muted">
              <thead>
                <tr className="text-subtle">
                  <th className="py-0.5 font-medium">Tháng</th>
                  <th className="py-0.5 font-medium">Nguồn</th>
                  <th className="py-0.5 font-medium">Ký tự</th>
                  <th className="py-0.5 font-medium">Yêu cầu</th>
                </tr>
              </thead>
              <tbody>
                {[...snap.history].reverse().map((h, i) => (
                  <tr key={`${h.month}-${h.provider}-${i}`}>
                    <td className="py-0.5">{h.month}</td>
                    <td className="py-0.5">{h.provider === 'google-web' ? 'Google Dịch (web)' : h.provider === 'device' ? 'Trên máy' : h.provider}</td>
                    <td className="py-0.5">{fmtInt(h.chars)}</td>
                    <td className="py-0.5">{fmtInt(h.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
