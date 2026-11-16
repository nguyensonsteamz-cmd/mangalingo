import type { KV } from '@/storage/kv';
import { dayKey, firstOfMonth, monthKey } from './calendar';
import { DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from './UsageSettings';
import type { MonthlyUsage, UsageSettings, UsageState } from './types';

const STATE_KEY = 'usage:v1';
const SETTINGS_KEY = 'usage:settings:v1';
const KEY_KEY = 'usage:apikey:v1';
const CACHE_KEY = 'usage:cache:v1';
const MAX_LOG = 200;
const MAX_HISTORY = 60;
const MAX_CACHE = 300;

const emptyMonth = (month: string): MonthlyUsage => ({ month, chars: 0, requests: 0, cachedRequests: 0, cachedChars: 0, failedRequests: 0, paidChars: 0, paidRequests: 0 });

export function freshState(now: Date): UsageState {
  return { version: 1, month: monthKey(now), lastReset: firstOfMonth(now), monthly: emptyMonth(monthKey(now)), day: { date: dayKey(now), paidRequests: 0 }, history: [], log: [] };
}

/** Persistence of settings, counters, history, the API key and the translation cache (chrome.storage.local). */
export class UsageRepository {
  constructor(private kv: KV) {}

  async loadSettings(): Promise<UsageSettings> {
    return sanitizeUsageSettings(await this.kv.get<Partial<UsageSettings>>(SETTINGS_KEY), DEFAULT_USAGE_SETTINGS);
  }
  async saveSettings(s: UsageSettings): Promise<void> {
    await this.kv.set({ [SETTINGS_KEY]: s });
  }

  /**
   * Loads the counters and applies the calendar rollover: when the current month is LATER than the stored
   * one, the finished month moves to the history and the monthly counters start from zero. A clock or time
   * zone that moves backwards never resets anything, and a restart alone never does either.
   */
  async load(now: Date): Promise<UsageState> {
    const raw = await this.kv.get<UsageState>(STATE_KEY);
    if (!raw || raw.version !== 1 || !raw.monthly) return freshState(now);
    const state: UsageState = { ...raw, history: raw.history ?? [], log: raw.log ?? [] };
    const cur = monthKey(now);
    if (cur > state.month) {
      state.history = [...state.history, state.monthly].slice(-MAX_HISTORY);
      state.month = cur;
      state.lastReset = firstOfMonth(now);
      state.monthly = emptyMonth(cur);
    }
    const today = dayKey(now);
    if (!state.day || today > state.day.date) state.day = { date: today, paidRequests: 0 };
    return state;
  }
  async save(state: UsageState): Promise<void> {
    state.log = state.log.slice(0, MAX_LOG);
    await this.kv.set({ [STATE_KEY]: state });
  }

  /** Clears the history and the request log; the current month's counters stay. */
  async clearHistory(now: Date): Promise<void> {
    const s = await this.load(now);
    s.history = [];
    s.log = [];
    await this.save(s);
  }
  /** Resets ALL local usage data (counters, history, log, cache). Settings and the key stay. */
  async resetAll(now: Date): Promise<void> {
    await this.save(freshState(now));
    await this.kv.remove(CACHE_KEY);
  }

  async getKey(): Promise<string> {
    return (await this.kv.get<string>(KEY_KEY)) ?? '';
  }
  async setKey(key: string | null): Promise<void> {
    if (key) await this.kv.set({ [KEY_KEY]: key });
    else await this.kv.remove(KEY_KEY);
  }

  async loadCache(): Promise<[string, string][]> {
    const c = await this.kv.get<[string, string][]>(CACHE_KEY);
    return Array.isArray(c) ? c : [];
  }
  async saveCache(entries: [string, string][]): Promise<void> {
    await this.kv.set({ [CACHE_KEY]: entries.slice(-MAX_CACHE) });
  }

  /** Storage keys that make the dashboard re-read (live UI updates). */
  static keys = [STATE_KEY, SETTINGS_KEY, KEY_KEY];
}
