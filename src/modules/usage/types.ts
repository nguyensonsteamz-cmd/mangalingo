/** Shared types of the translation usage module. All numbers are LOCAL estimates kept on this device (BYOK only). */

export type TranslationProvider = 'device' | 'google';

export interface UsageSettings {
  /** 'device' (default): on-device translation. 'google': Google Cloud Translation with the user's own key (BYOK). */
  provider: TranslationProvider;
  /** Free monthly quota in characters (Google Cloud Translation Basic: 500,000). */
  freeQuotaChars: number;
  /** warning thresholds (share of the quota): approaching / high usage / reached */
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

/**
 * One ledger = one provider + one credential in one billing month (UTC). Different providers and different API
 * credentials never share a ledger. Counts SOURCE characters of successfully processed text only, each chunk once.
 */
export interface MonthlyUsage {
  /** Billing month, UTC: "YYYY-MM". */
  month: string;
  provider: string;
  /** Smart Setup project id, or a short hash of a manually entered key, or "local" for on-device providers. */
  credentialId: string;
  /** Ownership of the credential. Only BYOK exists: LingoLens has no shared key and no server-side counter. */
  mode: 'byok';
  /** characters of SUCCESSFULLY processed source text (code points of the text sent) */
  chars: number;
  /** completed translation operations (one per finished job) */
  operations: number;
  /** successful provider requests (one per chunk / text) */
  requests: number;
  cachedRequests: number;
  cachedChars: number;
  /** failed attempts: informational only, never part of `chars` */
  failedRequests: number;
  /** characters / requests that went beyond the free quota */
  paidChars: number;
  paidRequests: number;
  languagePair: string;
  /** first / last successful use (ms since epoch) */
  firstAt: number;
  lastAt: number;
}

export interface RequestLogEntry {
  t: number;
  chars: number;
  kind: 'success' | 'cached' | 'failed' | 'blocked';
  provider?: string;
  paid?: boolean;
}

export interface UsageState {
  version: 2;
  /** Billing month in UTC ("YYYY-MM"). The display period resets at 00:00 UTC on the 1st. */
  month: string;
  /** First day of the current month (UTC, "YYYY-MM-DD"). */
  lastReset: string;
  /** current month, one ledger per provider + credential */
  ledgers: Record<string, MonthlyUsage>;
  day: { date: string; paidRequests: number };
  /** finished months (oldest first), one entry per ledger */
  history: MonthlyUsage[];
  /** recent requests (newest first, capped) */
  log: RequestLogEntry[];
  /** idempotency keys already counted (newest first, capped): a retry with the same key is never counted again */
  committed: string[];
}

export type WarningLevel = 'ok' | 'notice' | 'critical' | 'blocked';

export interface UsageSnapshot {
  settings: UsageSettings;
  /** active ledger */
  provider: string;
  credentialId: string;
  mode: 'byok';
  languagePair: string;
  /** billing month (UTC) and the next reset */
  month: string;
  lastReset: string;
  nextReset: string;
  /** "2026-12-01T00:00:00Z" */
  nextResetAt: string;
  usedChars: number;
  freeQuota: number;
  remainingFree: number;
  /** used / free quota, 0..infinity (1 = 100 %) */
  ratio: number;
  billableChars: number;
  estimatedCostUsd: number;
  /** is the cost estimate backed by a metered provider and a configured price? */
  costReliable: boolean;
  operations: number;
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
  /** this month, every provider / credential */
  ledgers: MonthlyUsage[];
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

export interface TranslateOptions {
  /** stable key of this chunk: a retry with the same key is counted once */
  idempotencyKey?: string;
  /** keep the line breaks inside the text (long-text chunks) */
  keepBreaks?: boolean;
  languagePair?: string;
}
