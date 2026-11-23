import type { KV } from '@/storage/kv';
import type { SecretStore } from '@/modules/smart-setup/secrets';
import { dayKey, firstOfMonth, monthKey } from './calendar';
import { DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from './UsageSettings';
import type { MonthlyUsage, UsageSettings, UsageState } from './types';

const STATE_KEY = 'usage:v1';
const SETTINGS_KEY = 'usage:settings:v1';
const KEY_KEY = 'usage:apikey:v1'; // LEGACY plaintext location: only read to migrate, then removed
const SECRET_NAME = 'translate-api-key';
const CACHE_KEY = 'usage:cache:v1';
const CREDENTIAL_KEY = 'usage:credential:v1';
const MAX_LOG = 200;
const MAX_HISTORY = 240;
const MAX_CACHE = 300;
export const MAX_COMMITTED = 3000;

export const GOOGLE_PROVIDER = 'google-v2';
export const DEFAULT_CREDENTIAL = 'default';
/** Google Translate web (unofficial): no credential, never metered or billed; its ledger only counts what was translated */
export const WEB_PROVIDER = 'google-web';
export const WEB_CREDENTIAL = 'web';

export const ledgerKey = (provider: string, credentialId: string) => `${provider}|${credentialId}`;

export function emptyLedger(month: string, provider: string, credentialId: string, languagePair = 'en>vi'): MonthlyUsage {
  return {
    month, provider, credentialId, mode: 'byok', chars: 0, operations: 0, requests: 0, cachedRequests: 0, cachedChars: 0, failedRequests: 0,
    paidChars: 0, paidRequests: 0, languagePair, firstAt: 0, lastAt: 0,
  };
}

export function freshState(now: Date): UsageState {
  const month = monthKey(now);
  return { version: 2, month, lastReset: firstOfMonth(now), ledgers: {}, day: { date: dayKey(now), paidRequests: 0 }, history: [], log: [], committed: [] };
}

/** Old (v1) state: one counter for the month. Its numbers become the Google ledger of the default credential. */
function migrate(raw: Record<string, unknown>, now: Date): UsageState {
  const s = freshState(now);
  const old = raw as { month?: string; lastReset?: string; monthly?: Partial<MonthlyUsage>; history?: Partial<MonthlyUsage>[]; log?: UsageState['log']; day?: UsageState['day'] };
  const conv = (m: Partial<MonthlyUsage>, month: string): MonthlyUsage => ({ ...emptyLedger(month, GOOGLE_PROVIDER, DEFAULT_CREDENTIAL), ...m, month, operations: m.operations ?? m.requests ?? 0, provider: GOOGLE_PROVIDER, credentialId: DEFAULT_CREDENTIAL, mode: 'byok' });
  s.month = old.month ?? s.month;
  s.lastReset = old.lastReset ?? s.lastReset;
  if (old.monthly) s.ledgers[ledgerKey(GOOGLE_PROVIDER, DEFAULT_CREDENTIAL)] = conv(old.monthly, s.month);
  s.history = (old.history ?? []).map((h) => conv(h, h.month ?? s.month));
  s.log = (old.log ?? []).map((e) => ({ ...e, kind: (e.kind as string) === 'billed' ? 'success' : e.kind })) as UsageState['log'];
  s.day = old.day ?? s.day;
  return s;
}

/** Persistence of settings, counters, history, the API key and the translation cache (chrome.storage.local). */
export class UsageRepository {
  private keyCache: string | null | undefined;

  constructor(
    private kv: KV,
    private secrets?: SecretStore,
  ) {}

  async loadSettings(): Promise<UsageSettings> {
    return sanitizeUsageSettings(await this.kv.get<Partial<UsageSettings>>(SETTINGS_KEY), DEFAULT_USAGE_SETTINGS);
  }
  async saveSettings(s: UsageSettings): Promise<void> {
    await this.kv.set({ [SETTINGS_KEY]: s });
  }

  /**
   * Loads the counters and applies the calendar rollover: when the current UTC month is LATER than the stored one, every
   * finished ledger moves to the history (never deleted) and the new month starts from zero. A clock or time zone that moves
   * backwards never resets anything, and a restart alone never does either.
   */
  async load(now: Date): Promise<UsageState> {
    const raw = await this.kv.get<Record<string, unknown>>(STATE_KEY);
    if (!raw || typeof raw !== 'object') return freshState(now);
    let state: UsageState;
    if (raw.version === 2) {
      const r = raw as unknown as UsageState;
      state = { ...r, ledgers: r.ledgers ?? {}, history: r.history ?? [], log: r.log ?? [], committed: r.committed ?? [] };
    } else if (raw.version === 1) {
      state = migrate(raw, now);
    } else return freshState(now);

    const cur = monthKey(now);
    if (cur > state.month) {
      state.history = [...state.history, ...Object.values(state.ledgers)].slice(-MAX_HISTORY);
      state.month = cur;
      state.lastReset = firstOfMonth(now);
      state.ledgers = {};
    }
    const today = dayKey(now);
    if (!state.day || today > state.day.date) state.day = { date: today, paidRequests: 0 };
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
  /** Resets ALL local usage data (counters, history, log, cache, idempotency keys). Settings and the key stay. */
  async resetAll(now: Date): Promise<void> {
    await this.save(freshState(now));
    await this.kv.remove(CACHE_KEY);
  }

  /** Identifies the API credential for the ledger (Smart Setup project id, or a hash of a manual key). Not a secret. */
  async getCredentialId(): Promise<string> {
    return (await this.kv.get<string>(CREDENTIAL_KEY)) ?? DEFAULT_CREDENTIAL;
  }
  async setCredentialId(id: string): Promise<void> {
    await this.kv.set({ [CREDENTIAL_KEY]: id });
  }

  /**
   * The API key. With a secure store (Keychain / Keystore / non-extractable WebCrypto) the key lives only there;
   * a key left in plaintext by an earlier version is moved into it and the plaintext copy is deleted.
   */
  async getKey(): Promise<string> {
    if (this.keyCache !== undefined && this.keyCache !== null) return this.keyCache;
    if (!this.secrets) return (await this.kv.get<string>(KEY_KEY)) ?? '';
    let key = await this.secrets.get(SECRET_NAME);
    if (!key) {
      const legacy = await this.kv.get<string>(KEY_KEY);
      if (legacy) {
        await this.secrets.set(SECRET_NAME, legacy);
        await this.kv.remove(KEY_KEY);
        key = legacy;
      }
    }
    this.keyCache = key ?? '';
    return this.keyCache;
  }
  async setKey(key: string | null): Promise<void> {
    this.keyCache = key ?? '';
    if (!this.secrets) {
      if (key) await this.kv.set({ [KEY_KEY]: key });
      else await this.kv.remove(KEY_KEY);
      return;
    }
    if (key) await this.secrets.set(SECRET_NAME, key);
    else await this.secrets.remove(SECRET_NAME);
    await this.kv.remove(KEY_KEY); // never leave a plaintext copy behind
  }

  async loadCache(): Promise<[string, string][]> {
    const c = await this.kv.get<[string, string][]>(CACHE_KEY);
    return Array.isArray(c) ? c : [];
  }
  async saveCache(entries: [string, string][]): Promise<void> {
    await this.kv.set({ [CACHE_KEY]: entries.slice(-MAX_CACHE) });
  }

  /** Storage keys that make the dashboard re-read (live UI updates). */
  static keys = [STATE_KEY, SETTINGS_KEY, KEY_KEY, CREDENTIAL_KEY];
}
