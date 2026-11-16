import { firstOfNextMonth } from './calendar';
import type { RequestLogEntry, UsageSettings, UsageSnapshot, UsageState, WarningLevel } from './types';

/** Counting and estimates. Everything here is a LOCAL estimate, not Google Cloud Billing data. */
export class UsageMeter {
  /** Warning level from the share of the free quota used. 79 % -> ok, 80 % -> notice, 95 % -> critical, 100 % -> blocked. */
  levelOf(usedChars: number, s: UsageSettings): WarningLevel {
    const ratio = usedChars / s.freeQuotaChars;
    // compare with a tiny epsilon so 0.8 * 500000 (floating point) lands exactly on the threshold
    const at = (r: number) => usedChars >= Math.round(s.freeQuotaChars * r) && ratio + 1e-12 >= r;
    if (at(s.hardStopRatio)) return 'blocked';
    if (at(s.criticalRatio)) return 'critical';
    if (at(s.warnRatio)) return 'notice';
    return 'ok';
  }

  costOf(billableChars: number, s: UsageSettings): number {
    return (billableChars / 1_000_000) * s.pricePerMillionUsd;
  }

  snapshot(state: UsageState, s: UsageSettings, key: string, now: Date): UsageSnapshot {
    const m = state.monthly;
    const billable = Math.max(0, m.chars - s.freeQuotaChars);
    return {
      settings: s,
      month: state.month,
      lastReset: state.lastReset,
      nextReset: firstOfNextMonth(now),
      usedChars: m.chars,
      freeQuota: s.freeQuotaChars,
      remainingFree: Math.max(0, s.freeQuotaChars - m.chars),
      ratio: m.chars / s.freeQuotaChars,
      billableChars: billable,
      estimatedCostUsd: this.costOf(billable, s),
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
      history: state.history,
      log: state.log,
    };
  }

  private log(state: UsageState, e: Omit<RequestLogEntry, 't'>, now: Date) {
    state.log.unshift({ t: now.getTime(), ...e });
  }

  /** Reservation: the characters count as submitted the moment the request is admitted (before it is sent). */
  reserve(state: UsageState, chars: number, billableChars: number, now: Date) {
    state.monthly.chars += chars;
    state.monthly.requests += 1;
    if (billableChars > 0) {
      state.monthly.paidChars += billableChars;
      state.monthly.paidRequests += 1;
      state.day.paidRequests += 1;
    }
    this.log(state, { chars, kind: 'billed', paid: billableChars > 0 }, now);
  }

  /** A cache hit is not new API usage. */
  recordCached(state: UsageState, chars: number, now: Date) {
    state.monthly.cachedRequests += 1;
    state.monthly.cachedChars += chars;
    this.log(state, { chars, kind: 'cached' }, now);
  }

  /** The request failed after it was initiated: the characters stay counted (the API may have processed them). */
  recordFailed(state: UsageState, chars: number, now: Date) {
    state.monthly.failedRequests += 1;
    this.log(state, { chars, kind: 'failed' }, now);
  }

  recordBlocked(state: UsageState, chars: number, now: Date) {
    this.log(state, { chars, kind: 'blocked' }, now);
  }
}
