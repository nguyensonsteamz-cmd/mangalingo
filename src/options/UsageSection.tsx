/**
 * Settings → "Hạn mức dịch": translation provider + API key, the monthly usage dashboard, quota and
 * paid-translation limits, and the local usage data tools. All figures are LOCAL ESTIMATES, not Google
 * Cloud Billing data.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Field, Notice, Segmented, Toggle, cx } from '@/ui/components';
import { UsageNotice } from '@/ui/UsageNotice';
import { MonthlyUsageCard } from '@/ui/MonthlyUsageCard';
import { authorizePaid, fmtDate, fmtInt, fmtPct, fmtUsd, usageActions, useUsage } from '@/ui/usage-client';
import { USAGE_DISCLAIMER } from '@/modules/usage/disclaimer';
import type { UsageSettings } from '@/modules/usage/types';
import { copyText } from '@/mobile/ios';
import { LocalModelSection } from './LocalModelSection';

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

/** Number input that commits on blur / Enter and shows the stored value again if the commit fails. */
function NumField({ value, onCommit, min, step = 1, suffix, width = 'w-32', testId }: { value: number; onCommit: (n: number) => void; min?: number; step?: number; suffix?: string; width?: string; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value && (min === undefined || n >= min)) onCommit(n);
    else setText(String(value));
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        className={cx('ml-focus ml-glass-field h-9 rounded-xl px-2.5 text-right text-[13px] tabular-nums text-text', width)}
        data-ml-usage-input={testId}
      />
      {suffix && <span className="w-12 text-[12px] text-subtle">{suffix}</span>}
    </span>
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
  const [keyText, setKeyText] = useState('');
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
  const google = s.provider === 'google';

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
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Hạn mức dịch</h1>
        <p className="mt-1 text-[13px] text-muted">
          Theo dõi lượng ký tự gửi đi dịch và chặn việc vô tình phát sinh phí Google Cloud Translation. LingoLens ưu tiên Google Cloud Translation (bản dịch sát nghĩa nhất). Khi hết hạn mức miễn phí, bạn quyết định: dừng và chuyển sang dịch trên máy (miễn phí), hoặc cho phép dịch có phí.
        </p>
      </div>

      <UsageNotice snap={snap} onChanged={() => void refresh()} />

      <Card title="Nguồn dịch">
        <Field label="Dịch bằng" description={google ? 'Văn bản được gửi tới Google Cloud Translation và tính phí theo ký tự khi vượt hạn mức miễn phí.' : 'Dịch trên máy (Chrome Translator / Apple Translation): không gửi văn bản đi đâu, không tính phí; chất lượng thấp hơn Google.'}>
          <Segmented
            value={s.provider}
            onChange={(v) => void save({ provider: v })}
            options={[
              { value: 'device', label: 'Trên máy (dự phòng)' },
              { value: 'google', label: 'Google Cloud' },
            ]}
          />
        </Field>
        {google && (
          <Field label="Khoá API Google Cloud" description={snap.hasKey ? `Đã lưu trên thiết bị này (…${snap.keyHint}). Không bao giờ hiển thị lại đầy đủ.` : 'Chưa có khoá: LingoLens sẽ tiếp tục dịch trên máy cho tới khi bạn nhập khoá.'} stacked>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                placeholder={snap.hasKey ? '••••••••••••' : 'Dán khoá API'}
                className="ml-focus ml-glass-field h-9 min-w-0 flex-1 rounded-xl px-2.5 text-[13px] text-text"
                data-ml-usage-key=""
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!keyText.trim()}
                onClick={async () => {
                  try {
                    await usageActions.settings(undefined, keyText.trim());
                    setKeyText('');
                    setMsg({ tone: 'info', text: 'Đã lưu khoá API (chỉ trên thiết bị này).' });
                    await refresh();
                  } catch (e) {
                    setMsg({ tone: 'error', text: (e as Error).message });
                  }
                }}
              >
                Lưu khoá
              </Button>
              {snap.hasKey && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await usageActions.settings(undefined, null);
                    await refresh();
                  }}
                >
                  Xoá khoá
                </Button>
              )}
            </div>
          </Field>
        )}
        {!google && <div className="py-3 text-[12px] text-muted">Chọn “Google Cloud” (ưu tiên) để nhập khoá API hoặc dùng Smart Setup và bật theo dõi hạn mức. Đang dùng bộ dịch trên máy: không có gì được gửi đi và không có gì bị tính phí.</div>}
        <div className="py-3 text-[12px] text-muted">
          Không muốn tự tạo khoá? <button type="button" className="font-semibold text-accent underline" onClick={() => (location.hash = 'setup')}>Dùng Lingolens Smart Setup</button> để thiết lập Google Cloud ngay trong ứng dụng.
        </div>
        {google && (
        <div className="py-3">
          <Notice tone="warn" title="Bảo mật khoá API">
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-snug">
              <li>Khoá chỉ được lưu cục bộ trên thiết bị và chỉ gửi tới translation.googleapis.com. Đừng đưa khoá vào mã nguồn hoặc chia sẻ khoá.</li>
              <li>Trong Google Cloud Console → Credentials, hãy giới hạn khoá chỉ cho “Cloud Translation API” (API restrictions) và đặt ràng buộc ứng dụng phù hợp.</li>
              <li>Đặt Budget &amp; alerts (Billing) và hạn mức API (Quotas) trên Google Cloud: đó mới là kiểm soát chi phí thật sự.</li>
              <li>Ứng dụng này không dùng khoá tài khoản dịch vụ (service account) và không lưu thông tin đăng nhập Google.</li>
            </ul>
          </Notice>
        </div>
        )}
      </Card>

      <Card title="Mức dùng tháng này (UTC)" desc={google ? undefined : 'Chỉ đếm khi bạn dùng Google Cloud. Dịch trên máy không được đo.'}>
        <div className="py-3">
          <MonthlyUsageCard snap={snap} />
        </div>
        <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3">
          <Stat testId="used" label="Ký tự đã dùng" value={fmtInt(snap.usedChars)} />
          <Stat testId="free" label="Hạn mức miễn phí" value={fmtInt(snap.freeQuota)} />
          <Stat testId="remaining" label="Miễn phí còn lại" value={fmtInt(snap.remainingFree)} />
          <Stat testId="percent" label="Đã dùng" value={fmtPct(snap.ratio)} />
          <Stat testId="billable" label="Ký tự tính phí (ước tính)" value={fmtInt(snap.billableChars)} />
          <Stat testId="cost" label="Chi phí ước tính" value={fmtUsd(snap.estimatedCostUsd)} sub={`${fmtUsd(s.pricePerMillionUsd)} / 1 triệu ký tự`} />
          <Stat testId="requests" label="Số yêu cầu dịch" value={fmtInt(snap.requests)} sub={snap.failedRequests ? `${fmtInt(snap.failedRequests)} lỗi` : undefined} />
          <Stat testId="cached" label="Dịch từ bộ nhớ đệm" value={fmtInt(snap.cachedRequests)} sub="không tính vào hạn mức" />
          <Stat testId="paid" label="Yêu cầu trả phí" value={fmtInt(snap.paidRequests)} sub={`${fmtInt(snap.paidChars)} ký tự`} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-[12.5px] text-muted">
          <span>
            Đặt lại lần cuối: <b className="text-text" data-ml-usage-last-reset="">{fmtDate(snap.lastReset)}</b>
          </span>
          <span>
            Đặt lại tiếp theo: <b className="text-text" data-ml-usage-next-reset="">{fmtDate(snap.nextReset)}</b>
          </span>
          <Badge tone="warn" title="Không phải dữ liệu thanh toán của Google">
            ước tính cục bộ
          </Badge>
        </div>
        <div className="py-3 text-[11.5px] leading-snug text-subtle">{USAGE_DISCLAIMER}</div>
      </Card>

      <Card title="Hạn mức miễn phí & cảnh báo" desc="Có thể chỉnh. Giao diện không gắn cứng con số nào.">
        <Field label="Hạn mức miễn phí mỗi tháng" description="Google Cloud Translation (Basic): 500.000 ký tự / tháng.">
          <NumField testId="free" value={s.freeQuotaChars} min={1} step={1000} suffix="ký tự" width="w-36" onCommit={(n) => void save({ freeQuotaChars: n })} />
        </Field>
        <Field label="Ngưỡng cảnh báo">
          <NumField testId="warn" value={Math.round(s.warnRatio * 100)} min={1} suffix="%" width="w-24" onCommit={(n) => void save({ warnRatio: n / 100 })} />
        </Field>
        <Field label="Ngưỡng mức dùng cao">
          <NumField testId="critical" value={Math.round(s.criticalRatio * 100)} min={1} suffix="%" width="w-24" onCommit={(n) => void save({ criticalRatio: n / 100 })} />
        </Field>
        <Field label="Ngưỡng dừng" description="Từ ngưỡng này, yêu cầu có thể tính phí bị chặn nếu bạn chưa cho phép.">
          <NumField testId="hard" value={Math.round(s.hardStopRatio * 100)} min={1} suffix="%" width="w-24" onCommit={(n) => void save({ hardStopRatio: n / 100 })} />
        </Field>
        <Field label="Đơn giá ước tính" description="USD cho mỗi 1 triệu ký tự vượt hạn mức. Chỉ dùng để ước tính.">
          <NumField testId="price" value={s.pricePerMillionUsd} min={0} step={0.5} suffix="USD" width="w-28" onCommit={(n) => void save({ pricePerMillionUsd: n })} />
        </Field>
      </Card>

      <Card title="Dịch có phí" desc="Tắt theo mặc định. LingoLens không bao giờ tự bật. Dù bạn cho phép, các giới hạn dưới đây luôn được áp dụng.">
        <Toggle
          label="Cho phép dịch có phí khi hết hạn mức miễn phí"
          description={s.paidEnabled ? 'Đang bật: yêu cầu vượt hạn mức sẽ được gửi (trong các giới hạn bên dưới) và có thể bị Google tính phí.' : 'Đang tắt: khi hết hạn mức miễn phí, mọi yêu cầu có thể tính phí bị chặn và bạn sẽ được hỏi.'}
          checked={s.paidEnabled}
          onChange={(v) => void (v ? authorizePaid() : usageActions.authorize(false)).then(() => refresh())}
        />
        <Field label="Ký tự trả phí tối đa mỗi tháng">
          <NumField testId="maxPaidChars" value={s.maxPaidCharsPerMonth} min={1} step={1000} suffix="ký tự" width="w-36" onCommit={(n) => void save({ maxPaidCharsPerMonth: n })} />
        </Field>
        <Field label="Chi phí ước tính tối đa mỗi tháng">
          <NumField testId="maxCost" value={s.maxMonthlyCostUsd} min={0.01} step={0.5} suffix="USD" width="w-28" onCommit={(n) => void save({ maxMonthlyCostUsd: n })} />
        </Field>
        <Field label="Ký tự tối đa cho mỗi yêu cầu">
          <NumField testId="maxPerRequest" value={s.maxCharsPerRequest} min={1} step={100} suffix="ký tự" width="w-32" onCommit={(n) => void save({ maxCharsPerRequest: n })} />
        </Field>
        <Field label="Yêu cầu trả phí tối đa mỗi ngày">
          <NumField testId="maxPaidPerDay" value={s.maxPaidRequestsPerDay} min={1} step={10} suffix="lần" width="w-28" onCommit={(n) => void save({ maxPaidRequestsPerDay: n })} />
        </Field>
        <div className="py-2 text-[11.5px] text-subtle">Hôm nay đã có {fmtInt(snap.paidRequestsToday)} yêu cầu trả phí. Chạm bất kỳ giới hạn nào, yêu cầu sẽ bị dừng và có cảnh báo.</div>
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
              setMsg({ tone: 'info', text: 'Đã xoá lịch sử sử dụng (mức dùng tháng này được giữ).' });
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
                  <th className="py-0.5 font-medium">Ký tự</th>
                  <th className="py-0.5 font-medium">Yêu cầu</th>
                  <th className="py-0.5 font-medium">Trả phí</th>
                </tr>
              </thead>
              <tbody>
                {[...snap.history].reverse().map((h) => (
                  <tr key={h.month}>
                    <td className="py-0.5">{h.month}</td>
                    <td className="py-0.5">{fmtInt(h.chars)}</td>
                    <td className="py-0.5">{fmtInt(h.requests)}</td>
                    <td className="py-0.5">{fmtInt(h.paidChars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LocalModelSection />

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
