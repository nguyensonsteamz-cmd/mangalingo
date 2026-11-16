/**
 * Quota warnings and the explicit-consent dialog for paid translation.
 * Every figure is a locally tracked ESTIMATE (never Google Cloud Billing data).
 */
import { useState } from 'react';
import type { BlockedDecision, UsageSnapshot, WarningLevel } from '@/modules/usage/types';
import { UsageWarningManager } from '@/modules/usage/UsageWarningManager';
import { Button, cx } from './components';
import { fmtInt, fmtPct, fmtUsd, usageActions } from './usage-client';

const warnings = new UsageWarningManager();

export const LEVEL_TONE: Record<WarningLevel, string> = {
  ok: 'bg-accent',
  notice: 'bg-warn',
  critical: 'bg-[rgb(249_115_22)]',
  blocked: 'bg-danger',
};

/**
 * The warning for the current usage level: a quiet note at 80 %, a prominent banner at 95 %, and at 100 %
 * the stop / authorise choice. Renders nothing while usage is low or when Google translation is not in use.
 */
export function UsageNotice({ snap, onChanged }: { snap: UsageSnapshot | null; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!snap || snap.settings.provider !== 'google' || snap.level === 'ok') return null;
  const w = warnings.warningFor(snap.level);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (snap.level === 'notice') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/[0.07] px-3 py-2 text-[12.5px] text-text" role="status" data-ml-usage-notice="notice">
        <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
        <span className="min-w-0 flex-1">{w.message}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-muted">{fmtPct(snap.ratio)}</span>
      </div>
    );
  }
  if (snap.level === 'critical') {
    return (
      <div className="rounded-2xl border-2 border-[rgb(249_115_22/0.55)] bg-[rgb(249_115_22/0.12)] px-3.5 py-3" role="alert" data-ml-usage-notice="critical">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-[18px]" aria-hidden="true">⚠️</span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-text">{w.message}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              Đã dùng {fmtPct(snap.ratio)} · còn {fmtInt(snap.remainingFree)} ký tự miễn phí tháng này.
            </div>
          </div>
        </div>
      </div>
    );
  }
  // blocked (100 %)
  return (
    <div className="rounded-2xl border-2 border-danger/60 bg-danger/10 px-3.5 py-3" role="alertdialog" aria-label="Đã đạt hạn mức dịch miễn phí" data-ml-usage-notice="blocked">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-[18px]" aria-hidden="true">⛔</span>
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-text">{w.message}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {snap.settings.paidEnabled
              ? 'Dịch có phí đang được bạn cho phép, trong các giới hạn bên dưới. Bạn có thể tắt bất cứ lúc nào.'
              : 'Các yêu cầu có thể tính phí đang bị chặn cho tới khi bạn cho phép.'}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run(() => usageActions.settings({ provider: 'device' }))} data-ml-usage-stop="">
          Dừng dịch (chuyển về dịch trên máy)
        </Button>
        {snap.settings.paidEnabled ? (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => usageActions.authorize(false))}>
            Tắt dịch có phí
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => usageActions.authorize(true))} data-ml-usage-authorize="">
            Cho phép dịch có phí
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Shown where a translation was blocked by the guard: the reason, the estimated extra characters and cost,
 * and (when only consent is missing) the two choices. Authorising keeps the configured limits in force.
 */
export function UsageConsent({ decision, onAuthorized, onStop }: { decision: BlockedDecision; onAuthorized: () => void; onStop?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={cx('space-y-2 rounded-xl border-2 px-3 py-2.5', decision.needsConsent ? 'border-danger/55 bg-danger/10' : 'border-warn/50 bg-warn/10')} role="alertdialog" data-ml-usage-consent={decision.reason}>
      <div className="text-[13.5px] font-bold text-text">{decision.message}</div>
      {decision.needsConsent && (
        <>
          <div className="text-[12.5px] text-muted">
            Yêu cầu này ước tính thêm <b className="text-text">{fmtInt(decision.additionalChars)}</b> ký tự tính phí, khoảng <b className="text-text">{fmtUsd(decision.estimatedCostUsd)}</b> (ước tính cục bộ, không phải số liệu thanh toán của Google).
          </div>
          <div className="text-[11.5px] text-subtle">Khi cho phép, các giới hạn trong Cài đặt → Hạn mức dịch (ký tự trả phí / tháng, chi phí tối đa, số yêu cầu / ngày) vẫn được áp dụng.</div>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await usageActions.settings({ provider: 'device' });
                } finally {
                  setBusy(false);
                  onStop?.();
                }
              }}
              data-ml-usage-stop=""
            >
              Dừng dịch
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await usageActions.authorize(true);
                  onAuthorized();
                } finally {
                  setBusy(false);
                }
              }}
              data-ml-usage-authorize=""
            >
              Cho phép dịch có phí
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
