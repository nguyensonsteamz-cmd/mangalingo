/** Shared types of the translation quota / cost protection module. All numbers are LOCAL estimates. */

export type TranslationProvider = 'device' | 'google';

export interface UsageSettings {
  /** 'device' (default): on-device translation, never metered. 'google': Google Cloud Translation, metered + protected. */
  provider: TranslationProvider;
  /** Free monthly quota in characters (Google Cloud Translation Basic: 500,000). */
  freeQuotaChars: number;
  warnRatio: number;
  criticalRatio: number;
  hardStopRatio: number;
  /** USD per 1,000,000 billable characters beyond the free quota (Basic edition list price). */
  pricePerMillionUsd: number;
  /** The user explicitly authorised paid translation (off by default, never switched on automatically). */
  paidEnabled: boolean;
  /** Limits that always apply to paid translation: consent is never unlimited. */
  maxPaidCharsPerMonth: number;
  maxMonthlyCostUsd: number;
  maxCharsPerRequest: number;
  maxPaidRequestsPerDay: number;
}

export interface MonthlyUsage {
  /** Calendar month, local time: "YYYY-MM". */
  month: string;
  /** Characters submitted to the API this month (code points of the normalised text). */
  chars: number;
  requests: number;
  cachedRequests: number;
  cachedChars: number;
  failedRequests: number;
  /** Characters / requests that went beyond the free quota. */
  paidChars: number;
  paidRequests: number;
}

export interface RequestLogEntry {
  t: number;
  chars: number;
  kind: 'billed' | 'cached' | 'failed' | 'blocked';
  paid?: boolean;
}

export interface UsageState {
  version: 1;
  month: string;
  /** First day of the current month ("YYYY-MM-DD"): when the counters were last reset. */
  lastReset: string;
  monthly: MonthlyUsage;
  day: { date: string; paidRequests: number };
  /** Finished months (oldest first). */
  history: MonthlyUsage[];
  /** Recent requests (newest first, capped). */
  log: RequestLogEntry[];
}

export type WarningLevel = 'ok' | 'notice' | 'critical' | 'blocked';

export interface UsageSnapshot {
  settings: UsageSettings;
  month: string;
  lastReset: string;
  nextReset: string;
  usedChars: number;
  freeQuota: number;
  remainingFree: number;
  /** used / free quota, 0..infinity (1 = 100 %). */
  ratio: number;
  billableChars: number;
  estimatedCostUsd: number;
  requests: number;
  cachedRequests: number;
  cachedChars: number;
  failedRequests: number;
  paidChars: number;
  paidRequests: number;
  paidRequestsToday: number;
  level: WarningLevel;
  hasKey: boolean;
  /** Last 4 characters of the saved key (never the key itself). */
  keyHint: string;
  history: MonthlyUsage[];
  log: RequestLogEntry[];
}

export type BlockReason = 'consent-needed' | 'request-too-long' | 'limit-chars' | 'limit-cost' | 'limit-requests';

export interface BlockedDecision {
  reason: BlockReason;
  message: string;
  /** Characters of this request that would be billable. */
  additionalChars: number;
  /** Estimated extra cost of this request (USD). */
  estimatedCostUsd: number;
  /** True when the only thing missing is the user's explicit authorisation. */
  needsConsent: boolean;
}

export type TranslateOutcome =
  | { source: 'device' }
  | { source: 'google'; text: string; cached: boolean; chars: number; paid: boolean }
  | { source: 'blocked'; decision: BlockedDecision };
