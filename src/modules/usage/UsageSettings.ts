import type { UsageSettings } from './types';

export const DEFAULT_USAGE_SETTINGS: UsageSettings = {
  provider: 'device',
  freeQuotaChars: 500_000,
  warnRatio: 0.8,
  criticalRatio: 0.9,
  hardStopRatio: 1,
  pricePerMillionUsd: 20,
  paidEnabled: false,
  // consent is never unlimited: these always apply
  maxPaidCharsPerMonth: 100_000,
  maxMonthlyCostUsd: 2,
  maxCharsPerRequest: 5_000,
  maxPaidRequestsPerDay: 200,
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Validates / clamps settings read from storage or typed by the user. Limits can never be 0 or infinite. */
export function sanitizeUsageSettings(raw: Partial<UsageSettings> | undefined, base: UsageSettings = DEFAULT_USAGE_SETTINGS): UsageSettings {
  const r = raw ?? {};
  const warn = num(r.warnRatio, 0.01, 1, base.warnRatio);
  const critical = Math.max(warn, num(r.criticalRatio, 0.01, 1, base.criticalRatio));
  const hard = Math.max(critical, num(r.hardStopRatio, 0.01, 1, base.hardStopRatio));
  return {
    provider: r.provider === 'google' || r.provider === 'device' ? r.provider : base.provider,
    freeQuotaChars: Math.round(num(r.freeQuotaChars, 1, 1e9, base.freeQuotaChars)),
    warnRatio: warn,
    criticalRatio: critical,
    hardStopRatio: hard,
    pricePerMillionUsd: num(r.pricePerMillionUsd, 0, 1000, base.pricePerMillionUsd),
    paidEnabled: typeof r.paidEnabled === 'boolean' ? r.paidEnabled : base.paidEnabled,
    maxPaidCharsPerMonth: Math.round(num(r.maxPaidCharsPerMonth, 1, 1e9, base.maxPaidCharsPerMonth)),
    maxMonthlyCostUsd: num(r.maxMonthlyCostUsd, 0.01, 100000, base.maxMonthlyCostUsd),
    maxCharsPerRequest: Math.round(num(r.maxCharsPerRequest, 1, 100_000, base.maxCharsPerRequest)),
    maxPaidRequestsPerDay: Math.round(num(r.maxPaidRequestsPerDay, 1, 1e6, base.maxPaidRequestsPerDay)),
  };
}
