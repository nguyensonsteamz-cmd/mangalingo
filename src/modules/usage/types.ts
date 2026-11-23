/**
 * Shared types of the translation usage module. All numbers are LOCAL counters kept on this device. Neither provider has a quota
 * or a bill that LingoLens could meter: on-device translation is free and local, and Google Translate (web, unofficial) has no
 * official quota or billing at all.
 */

/** 'device' (default): on-device translation. 'google-web': Google Translate web (unofficial, no key, no billing; the text is sent to Google). */
export type TranslationProvider = 'device' | 'google-web';

export interface UsageSettings {
  provider: TranslationProvider;
}

/** One ledger = one provider in one calendar month (UTC). Counts SOURCE characters of successfully processed text only, each chunk once. */
export interface MonthlyUsage {
  /** Month, UTC: "YYYY-MM". */
  month: string;
  provider: string;
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
  languagePair: string;
  /** first / last successful use (ms since epoch) */
  firstAt: number;
  lastAt: number;
}

export interface RequestLogEntry {
  t: number;
  chars: number;
  kind: 'success' | 'cached' | 'failed';
  provider?: string;
}

export interface UsageState {
  version: 2;
  /** Month in UTC ("YYYY-MM"). The display period resets at 00:00 UTC on the 1st. */
  month: string;
  /** First day of the current month (UTC, "YYYY-MM-DD"). */
  lastReset: string;
  /** current month, one ledger per provider */
  ledgers: Record<string, MonthlyUsage>;
  /** finished months (oldest first), one entry per ledger */
  history: MonthlyUsage[];
  /** recent requests (newest first, capped) */
  log: RequestLogEntry[];
  /** idempotency keys already counted (newest first, capped): a retry with the same key is never counted again */
  committed: string[];
}

export interface UsageSnapshot {
  settings: UsageSettings;
  /** active ledger */
  provider: string;
  languagePair: string;
  month: string;
  lastReset: string;
  nextReset: string;
  /** "2026-12-01T00:00:00Z" */
  nextResetAt: string;
  usedChars: number;
  operations: number;
  requests: number;
  cachedRequests: number;
  cachedChars: number;
  failedRequests: number;
  /** this month, every provider */
  ledgers: MonthlyUsage[];
  history: MonthlyUsage[];
  log: RequestLogEntry[];
}

export type TranslateOutcome =
  | { source: 'device' }
  | { source: 'google'; text: string; cached: boolean; chars: number };

export interface TranslateOptions {
  /** stable key of this chunk: a retry with the same key is counted once */
  idempotencyKey?: string;
  /** keep the line breaks inside the text (long-text chunks) */
  keepBreaks?: boolean;
  languagePair?: string;
}
