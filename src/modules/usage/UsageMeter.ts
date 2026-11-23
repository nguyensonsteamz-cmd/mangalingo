import { firstOfNextMonth, resetInstant } from './calendar';
import { emptyLedger, ledgerKey } from './UsageRepository';
import type { MonthlyUsage, RequestLogEntry, UsageSettings, UsageSnapshot, UsageState } from './types';

export interface Active {
  provider: string;
  languagePair?: string;
}

/** Counting only: there is no quota, price or bill to estimate for the providers LingoLens uses. */
export class UsageMeter {
  ledger(state: UsageState, a: Active): MonthlyUsage {
    const k = ledgerKey(a.provider);
    return (state.ledgers[k] ??= emptyLedger(state.month, a.provider, a.languagePair));
  }

  snapshot(state: UsageState, s: UsageSettings, now: Date, a: Active): UsageSnapshot {
    const m = state.ledgers[ledgerKey(a.provider)] ?? emptyLedger(state.month, a.provider, a.languagePair);
    const nextReset = firstOfNextMonth(now);
    return {
      settings: s,
      provider: a.provider,
      languagePair: m.languagePair,
      month: state.month,
      lastReset: state.lastReset,
      nextReset,
      nextResetAt: resetInstant(nextReset),
      usedChars: m.chars,
      operations: m.operations,
      requests: m.requests,
      cachedRequests: m.cachedRequests,
      cachedChars: m.cachedChars,
      failedRequests: m.failedRequests,
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

  /** A request that SUCCEEDED: its source characters count, exactly once (an idempotency key already committed adds nothing). */
  commit(state: UsageState, a: Active, chars: number, key: string | undefined, now: Date): boolean {
    if (this.isCommitted(state, key)) return false;
    const m = this.ledger(state, a);
    m.chars += chars;
    m.requests += 1;
    m.firstAt ||= now.getTime();
    m.lastAt = now.getTime();
    if (key) state.committed.unshift(key);
    this.log(state, { chars, kind: 'success', provider: a.provider }, now);
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

  /** A cache hit is not a new request. */
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
}
