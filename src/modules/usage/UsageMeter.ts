import { firstOfNextMonth, resetInstant } from './calendar';
import { emptyLedger, ledgerKey } from './UsageRepository';
import type { MonthlyUsage, RequestLogEntry, UsageSettings, UsageSnapshot, UsageState, WarningLevel } from './types';

export interface Active {
  provider: string;
  credentialId: string;
  languagePair?: string;
}

/** Counting and estimates. Everything here is a LOCAL estimate, not Google Cloud Billing data. */
export class UsageMeter {
  /** Warning level from the share of the quota used: 80 % approaching, 90 % high usage, 100 % reached (all configurable). */
  levelOf(usedChars: number, s: UsageSettings): WarningLevel {
    const at = (r: number) => usedChars >= Math.round(s.freeQuotaChars * r);
    if (at(s.hardStopRatio)) return 'blocked';
    if (at(s.criticalRatio)) return 'critical';
    if (at(s.warnRatio)) return 'notice';
    return 'ok';
  }

  costOf(billableChars: number, s: UsageSettings): number {
    return (billableChars / 1_000_000) * s.pricePerMillionUsd;
  }

  ledger(state: UsageState, a: Active): MonthlyUsage {
    const k = ledgerKey(a.provider, a.credentialId);
    return (state.ledgers[k] ??= emptyLedger(state.month, a.provider, a.credentialId, a.languagePair));
  }

  snapshot(state: UsageState, s: UsageSettings, key: string, now: Date, a: Active): UsageSnapshot {
    const m = state.ledgers[ledgerKey(a.provider, a.credentialId)] ?? emptyLedger(state.month, a.provider, a.credentialId, a.languagePair);
    const billable = Math.max(0, m.chars - s.freeQuotaChars);
    const nextReset = firstOfNextMonth(now);
    return {
      settings: s,
      provider: a.provider,
      credentialId: a.credentialId,
      mode: 'byok',
      languagePair: m.languagePair,
      month: state.month,
      lastReset: state.lastReset,
      nextReset,
      nextResetAt: resetInstant(nextReset),
      usedChars: m.chars,
      freeQuota: s.freeQuotaChars,
      remainingFree: Math.max(0, s.freeQuotaChars - m.chars),
      ratio: m.chars / s.freeQuotaChars,
      billableChars: billable,
      estimatedCostUsd: this.costOf(billable, s),
      // reliable only for a metered provider (Google BYOK) with a configured price; never for on-device providers
      costReliable: a.provider === 'google-v2' && s.pricePerMillionUsd > 0,
      operations: m.operations,
      requests: m.requests,
      cachedRequests: m.cachedRequests,
      cachedChars: m.cachedChars,
      failedRequests: m.failedRequests,
      paidChars: m.paidChars,
      paidRequests: m.paidRequests,
      paidRequestsToday: state.day.paidRequests,
      level: this.levelOf(m.chars, s),
      hasKey: !!key,
      keyHint: key ? key.slice(-4) : '',
      ledgers: Object.values(state.ledgers),
      history: state.history,
      log: state.log,
    };
  }

  private log(state: UsageState, e: Omit<RequestLogEntry, 't'>, now: Date) {
    state.log.unshift({ t: now.getTime(), ...e });
  }

  isCommitted(state: UsageState, key: string | undefined): boolean {
    return !!key && state.committed.includes(key);
  }

  /**
   * A request that SUCCEEDED: its source characters count, exactly once. With an idempotency key already committed nothing is
   * added (a retry of a chunk that was already counted).
   */
  commit(state: UsageState, a: Active, chars: number, billableChars: number, key: string | undefined, now: Date): boolean {
    if (this.isCommitted(state, key)) return false;
    const m = this.ledger(state, a);
    m.chars += chars;
    m.requests += 1;
    if (billableChars > 0) {
      m.paidChars += billableChars;
      m.paidRequests += 1;
      state.day.paidRequests += 1;
    }
    m.firstAt ||= now.getTime();
    m.lastAt = now.getTime();
    if (key) state.committed.unshift(key);
    this.log(state, { chars, kind: 'success', provider: a.provider, paid: billableChars > 0 }, now);
    return true;
  }

  /** A finished translation job (several chunks = ONE operation). Idempotent per job id. */
  recordOperation(state: UsageState, a: Active, jobId: string): boolean {
    const key = `op:${jobId}`;
    if (state.committed.includes(key)) return false;
    this.ledger(state, a).operations += 1;
    state.committed.unshift(key);
    return true;
  }

  /** A cache hit is not new API usage. */
  recordCached(state: UsageState, a: Active, chars: number, now: Date) {
    const m = this.ledger(state, a);
    m.cachedRequests += 1;
    m.cachedChars += chars;
    this.log(state, { chars, kind: 'cached', provider: a.provider }, now);
  }

  /** A failed attempt: NOT counted in the characters (only the informational failure counter). */
  recordFailed(state: UsageState, a: Active, chars: number, now: Date) {
    this.ledger(state, a).failedRequests += 1;
    this.log(state, { chars, kind: 'failed', provider: a.provider }, now);
  }

  recordBlocked(state: UsageState, a: Active, chars: number, now: Date) {
    this.log(state, { chars, kind: 'blocked', provider: a.provider }, now);
  }
}
