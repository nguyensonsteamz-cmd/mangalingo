/**
 * Monthly translation usage, the same compact component on Chrome, iPhone and Android: progress bar with the warning marks,
 * characters used / quota / remaining, share used, operations, billing month (UTC) and the next reset, and an estimated cost
 * only when it is backed by a metered provider and a configured price. The figure is Google's own count for the whole account
 * (all platforms) once it has been read from Cloud Monitoring; until then it is a LOCAL estimate (this device only).
 */
import { useId } from 'react';
import type { UsageSnapshot } from '@/modules/usage/types';
import { LEVEL_TONE } from './UsageNotice';
import { cx } from './components';
import { fmtInt, fmtPct, fmtUsd } from './usage-client';

const PROVIDER_LABEL: Record<string, string> = { 'google-v2': 'Google Cloud (khoá của bạn)', 'device-chrome': 'Dịch máy Chrome', 'device-apple': 'Apple Translation', 'device-mlkit': 'ML Kit' };

/** "2026-12-01T00:00:00Z" -> "01/12/2026 00:00 UTC" */
const fmtReset = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;

export function MonthlyUsageCard({ snap, compact = false }: { snap: UsageSnapshot; compact?: boolean }) {
  const id = useId();
  const pct = Math.min(100, snap.ratio * 100);
  const s = snap.settings;
  const marks = [s.warnRatio, s.criticalRatio, s.hardStopRatio].filter((r, i, a) => a.indexOf(r) === i);
  const label = `Mức dùng dịch tháng ${snap.month}: ${fmtPct(snap.ratio)} hạn mức, còn ${fmtInt(snap.remainingFree)} ký tự`;
  return (
    <div className={cx('rounded-2xl', compact ? 'px-1 py-0.5' : 'ml-glass-card p-4')} data-ml-usage-card={snap.level} aria-labelledby={id}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div id={id} className={cx('font-semibold text-text', compact ? 'text-[12.5px]' : 'text-[14px]')}>
          Dịch tháng {snap.month} <span className="font-normal text-subtle">(UTC)</span>
        </div>
        <div className={cx('font-bold tabular-nums text-text', compact ? 'text-[13px]' : 'text-[20px]')} data-ml-usage-percent="">
          {fmtPct(snap.ratio)}
        </div>
      </div>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-text/[0.1]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={label}
        aria-label="Mức dùng hạn mức dịch trong tháng"
      >
        <div className={cx('h-full rounded-full transition-[width] duration-300', LEVEL_TONE[snap.level])} style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, pct)}%` }} />
        {marks.map((r) => (
          <span key={r} className="absolute top-0 h-full w-px bg-text/45" style={{ left: `${Math.min(99.5, r * 100)}%` }} aria-hidden="true" />
        ))}
      </div>
      <div className={cx('mt-1.5 flex flex-wrap justify-between gap-x-3 text-muted tabular-nums', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
        <span data-ml-usage-used="">
          {fmtInt(snap.usedChars)} / {fmtInt(snap.freeQuota)} ký tự
        </span>
        <span data-ml-usage-remaining="">còn {fmtInt(snap.remainingFree)}</span>
      </div>
      {!compact && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
          <div className="flex justify-between gap-2"><dt className="text-muted">Lượt dịch</dt><dd className="font-medium tabular-nums" data-ml-usage-ops="">{fmtInt(snap.operations)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Yêu cầu API</dt><dd className="font-medium tabular-nums">{fmtInt(snap.requests)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Tháng tính</dt><dd className="font-medium">{snap.month} (UTC)</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Đặt lại lúc</dt><dd className="font-medium" data-ml-usage-reset="">{fmtReset(snap.nextResetAt)}</dd></div>
          <div className="col-span-2 flex justify-between gap-2"><dt className="text-muted">Nhà cung cấp</dt><dd className="min-w-0 truncate font-medium">{PROVIDER_LABEL[snap.provider] ?? snap.provider} · khoá riêng (BYOK)</dd></div>
          {snap.costReliable && (
            <div className="col-span-2 flex justify-between gap-2"><dt className="text-muted">Chi phí ước tính</dt><dd className="font-medium tabular-nums" data-ml-usage-cost="">{fmtUsd(snap.estimatedCostUsd)}</dd></div>
          )}
        </dl>
      )}
      <div className={cx('mt-2 text-subtle', compact ? 'text-[10.5px]' : 'text-[11px]')} data-ml-usage-source={snap.accountAt ? 'account' : 'local'}>
        {snap.accountAt
          ? `Theo tài khoản Google (mọi nền tảng) · đọc lúc ${new Date(snap.accountAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date(snap.accountAt).toLocaleDateString('vi-VN')}`
          : 'Ước tính trên thiết bị này. Vào Cài đặt → Hạn mức dịch để đọc số của cả tài khoản Google.'}
      </div>
    </div>
  );
}
