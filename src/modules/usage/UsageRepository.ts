import type { KV } from '@/storage/kv';
import { firstOfMonth, monthKey } from './calendar';
import { DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from './UsageSettings';
import type { MonthlyUsage, UsageSettings, UsageState } from './types';

const STATE_KEY = 'usage:v1';
const SETTINGS_KEY = 'usage:settings:v1';
const CACHE_KEY = 'usage:cache:v1';
/** storage keys of the retired Google Cloud (BYOK / Smart Setup) feature: removed so no credential or sign-in record stays behind */
const RETIRED_KEYS = ['usage:apikey:v1', 'usage:credential:v1', 'auth:v1', 'secret:translate-api-key'];
const MAX_LOG = 200;
const MAX_HISTORY = 240;
const MAX_CACHE = 300;
export const MAX_COMMITTED = 3000;

export const WEB_PROVIDER = 'google-web';

export const ledgerKey = (provider: string) => provider;

export function emptyLedger(month: string, provider: string, languagePair = 'en>vi'): MonthlyUsage {
  return { month, provider, chars: 0, operations: 0, requests: 0, cachedRequests: 0, cachedChars: 0, failedRequests: 0, languagePair, firstAt: 0, lastAt: 0 };
}

export function freshState(now: Date): UsageState {
  const month = monthKey(now);
  return { version: 2, month, lastReset: firstOfMonth(now), ledgers: {}, history: [], log: [], committed: [] };
}

/** Persistence of settings, counters, history and the translation cache (chrome.storage.local). */
export class UsageRepository {
  private cleaned = false;
  constructor(private kv: KV) {}

  /** Deletes what the retired Google Cloud feature may have left (API key, credential id, sign-in record). Runs once per start. */
  private async purgeRetired(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    await this.kv.remove(RETIRED_KEYS).catch(() => {});
  }

  async loadSettings(): Promise<UsageSettings> {
    await this.purgeRetired();
    return sanitizeUsageSettings(await this.kv.get<Partial<UsageSettings>>(SETTINGS_KEY), DEFAULT_USAGE_SETTINGS);
  }
  async saveSettings(s: UsageSettings): Promise<void> {
    await this.kv.set({ [SETTINGS_KEY]: { provider: s.provider } });
  }

  /**
   * Loads the counters and applies the calendar rollover: when the current UTC month is LATER than the stored one, every
   * finished ledger moves to the history (never deleted) and the new month starts from zero.
   */
  async load(now: Date): Promise<UsageState> {
    const raw = await this.kv.get<Record<string, unknown>>(STATE_KEY);
    if (!raw || typeof raw !== 'object' || raw.version !== 2) return freshState(now);
    const r = raw as unknown as UsageState;
    const state: UsageState = { ...r, ledgers: r.ledgers ?? {}, history: r.history ?? [], log: r.log ?? [], committed: r.committed ?? [] };
    const cur = monthKey(now);
    if (cur > state.month) {
      state.history = [...state.history, ...Object.values(state.ledgers)].slice(-MAX_HISTORY);
      state.month = cur;
      state.lastReset = firstOfMonth(now);
      state.ledgers = {};
    }
    return state;
  }
  async save(state: UsageState): Promise<void> {
    state.log = state.log.slice(0, MAX_LOG);
    state.committed = state.committed.slice(0, MAX_COMMITTED);
    await this.kv.set({ [STATE_KEY]: state });
  }

  /** Clears the history and the request log; this month's counters stay. */
  async clearHistory(now: Date): Promise<void> {
    const s = await this.load(now);
    s.history = [];
    s.log = [];
    await this.save(s);
  }
  /** Resets ALL local usage data (counters, history, log, cache, idempotency keys). Settings stay. */
  async resetAll(now: Date): Promise<void> {
    await this.save(freshState(now));
    await this.kv.remove(CACHE_KEY);
  }

  async loadCache(): Promise<[string, string][]> {
    const c = await this.kv.get<[string, string][]>(CACHE_KEY);
    return Array.isArray(c) ? c : [];
  }
  async saveCache(entries: [string, string][]): Promise<void> {
    await this.kv.set({ [CACHE_KEY]: entries.slice(-MAX_CACHE) });
  }
}
