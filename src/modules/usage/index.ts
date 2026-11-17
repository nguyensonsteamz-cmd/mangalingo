/**
 * Translation usage meter, free-quota tracking and cost protection for the optional Google Cloud
 * Translation provider. On-device translation (the default) is never metered.
 *
 * IMPORTANT: every number here is a LOCAL ESTIMATE kept on this device. It is not Google Cloud Billing
 * data, billing can be delayed, and local limits cannot guarantee that no charge will ever occur.
 */
import type { KV } from '@/storage/kv';
import type { SecretStore } from '@/modules/smart-setup/secrets';
import { MessageError } from '@/shared/messages';
import { CostProtectionService } from './CostProtectionService';
import { QuotaManager } from './QuotaManager';
import { UsageMeter } from './UsageMeter';
import { DEFAULT_CREDENTIAL, GOOGLE_PROVIDER, UsageRepository } from './UsageRepository';
import { sanitizeUsageSettings } from './UsageSettings';
import { UsageWarningManager } from './UsageWarningManager';
import { googleTranslate, type FetchLike } from './google';
import { GoogleCloudClient, type FetchFn } from '@/modules/smart-setup/google-cloud';
import type { TranslateOptions, TranslateOutcome, UsageSettings, UsageSnapshot } from './types';

export * from './types';
export { countChars, normalizeText } from './count';
export { DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from './UsageSettings';
export { UsageMeter } from './UsageMeter';
export { UsageRepository } from './UsageRepository';
export { QuotaManager } from './QuotaManager';
export { CostProtectionService } from './CostProtectionService';
export { UsageWarningManager } from './UsageWarningManager';

export { USAGE_DISCLAIMER } from './disclaimer';
import { USAGE_DISCLAIMER } from './disclaimer';

export interface UsageServiceOptions {
  clock?: () => Date;
  fetchImpl?: FetchLike;
  /** Secure storage for the API key (Keychain / Keystore / non-extractable WebCrypto). Without it the key is kept in plain storage (tests only). */
  secrets?: SecretStore;
}

/** First 8 hex characters of SHA-256 of the key: identifies the credential without revealing it. */
async function credentialHash(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return 'key-' + [...new Uint8Array(d)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Facade used by the background / in-app router. */
export class UsageService {
  readonly repo: UsageRepository;
  readonly meter = new UsageMeter();
  readonly quota: QuotaManager;
  readonly protection: CostProtectionService;
  readonly warnings = new UsageWarningManager();
  private clock: () => Date;
  private fetchImpl?: FetchLike;

  constructor(kv: KV, opts: UsageServiceOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.fetchImpl = opts.fetchImpl;
    this.repo = new UsageRepository(kv, opts.secrets);
    this.quota = new QuotaManager(this.meter);
    this.protection = new CostProtectionService(this.repo, this.meter, this.quota, this.clock);
  }

  /** The ledger being displayed / charged: Google (BYOK) with the current credential. */
  private async active() {
    return { provider: GOOGLE_PROVIDER, credentialId: await this.repo.getCredentialId() };
  }

  async snapshot(): Promise<UsageSnapshot> {
    // under the lock: never reads a half-written reservation
    return this.protection.run(async () => {
      const now = this.clock();
      const [state, settings, key, active] = await Promise.all([this.repo.load(now), this.repo.loadSettings(), this.repo.getKey(), this.active()]);
      const snap = this.meter.snapshot(state, settings, key, now, active);
      this.warnings.evaluate(snap);
      return snap;
    });
  }

  /**
   * The account-wide figure read from Google (Cloud Monitoring, every platform using this account's project): it replaces the
   * local estimate as the base of this month's ledger. Ignored for another month or another credential.
   */
  async setAccountUsage(chars: number, month: string, credentialId?: string): Promise<UsageSnapshot> {
    await this.protection.run(async () => {
      const now = this.clock();
      const state = await this.repo.load(now);
      const active = await this.active();
      if (month === state.month && (!credentialId || credentialId === active.credentialId || active.credentialId === 'default')) {
        const m = this.meter.ledger(state, active);
        m.accountChars = Math.max(0, Math.round(chars));
        m.accountLocalAt = m.chars;
        m.accountAt = now.getTime();
        await this.repo.save(state);
      }
    });
    return this.snapshot();
  }

  /** Translation entry point. Device mode (default) tells the caller to use the on-device translator. */
  async translate(text: string, opts: TranslateOptions = {}): Promise<TranslateOutcome> {
    const settings = await this.repo.loadSettings();
    const key = await this.repo.getKey();
    if (settings.provider !== 'google' || !key) return { source: 'device' };
    const active = { ...(await this.active()), languagePair: opts.languagePair ?? 'en>vi' };
    const r = await this.protection.translate(text, (t) => googleTranslate(t, key, this.fetchImpl, active.languagePair), { ...active, idempotencyKey: opts.idempotencyKey, keepBreaks: opts.keepBreaks });
    if (r.status === 'blocked') return { source: 'blocked', decision: r.decision };
    return { source: 'google', text: r.text, cached: r.cached, chars: r.chars, paid: r.paid };
  }

  async getSettings(): Promise<UsageSettings> {
    return this.repo.loadSettings();
  }

  async updateSettings(patch: Partial<UsageSettings>): Promise<UsageSettings> {
    return this.protection.run(async () => {
      const cur = await this.repo.loadSettings();
      const next = sanitizeUsageSettings({ ...cur, ...patch }, cur);
      await this.repo.saveSettings(next);
      return next;
    });
  }

  /** Smart Setup finished: save the validated key and switch to Google translation. */
  async activateGoogle(key: string, credentialId?: string): Promise<void> {
    await this.setApiKey(key, credentialId);
    await this.updateSettings({ provider: 'google' });
  }

  /** Disconnect: forget the key and go back to on-device translation. */
  async deactivateGoogle(): Promise<void> {
    await this.repo.setKey(null);
    await this.updateSettings({ provider: 'device' });
  }

  /** Health check of the saved key: one 5-character translation of "Hello". The key never leaves this service. */
  async validateSaved(): Promise<{ ok: boolean; code?: string; detail?: string }> {
    const key = await this.repo.getKey();
    if (!key) return { ok: false, code: 'INVALID_API_KEY', detail: 'Chưa có khoá API.' };
    try {
      await new GoogleCloudClient({ fetchImpl: this.fetchImpl as unknown as FetchFn | undefined }).validateKey(key);
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; detail?: string };
      return { ok: false, code: err.code ?? 'NETWORK_ERROR', detail: err.detail };
    }
  }

  async currentKey(): Promise<string> {
    return this.repo.getKey();
  }

  /**
   * Saves (or removes) the key. The usage ledger is tied to the CREDENTIAL: Smart Setup passes the project id (a replaced key in the
   * same project keeps its ledger, like Google's per-project quota); a manually entered key gets a short hash of itself.
   */
  async setApiKey(key: string | null, credentialId?: string): Promise<void> {
    const k = key?.trim() ?? '';
    if (k && (k.length < 20 || /\s/.test(k))) throw new MessageError('Khoá API không hợp lệ.', 'bad-key');
    await this.repo.setKey(k || null);
    if (k) await this.repo.setCredentialId(credentialId || (await credentialHash(k)));
    else await this.repo.setCredentialId(DEFAULT_CREDENTIAL);
  }

  /** A finished translation job (any number of chunks) = one operation. Idempotent per job id. */
  async completeOperation(jobId: string): Promise<void> {
    await this.protection.recordOperation(await this.active(), jobId);
  }

  /** On-device providers are not metered: their successful use is recorded in a separate, informational ledger. */
  async recordDeviceProcessed(provider: string, chars: number, idempotencyKey?: string): Promise<void> {
    await this.protection.recordProcessed({ provider, credentialId: 'local' }, chars, idempotencyKey);
  }

  /** The user's explicit consent (or its withdrawal). The limits keep applying while it is on. */
  async setPaidAuthorized(on: boolean): Promise<UsageSettings> {
    return this.updateSettings({ paidEnabled: on });
  }

  async clearHistory(): Promise<void> {
    await this.protection.run(() => this.repo.clearHistory(this.clock()));
  }

  async resetAll(): Promise<void> {
    await this.protection.run(async () => {
      await this.repo.resetAll(this.clock());
      this.protection.clearCache();
    });
  }

  /** A report of the locally tracked usage (never contains the API key). */
  async exportReport(format: 'json' | 'csv' = 'json'): Promise<string> {
    const snap = await this.snapshot();
    const rows = [...snap.history, ...snap.ledgers];
    if (format === 'csv') {
      return [
        'month,provider,credential,mode,language_pair,characters,operations,requests,cached_requests,cached_characters,failed_requests,paid_characters,paid_requests',
        ...rows.map((r) => [r.month, r.provider, r.credentialId, r.mode, r.languagePair, r.chars, r.operations, r.requests, r.cachedRequests, r.cachedChars, r.failedRequests, r.paidChars, r.paidRequests].join(',')),
      ].join('\n');
    }
    return JSON.stringify(
      {
        generatedAt: this.clock().toISOString(),
        note: USAGE_DISCLAIMER,
        settings: snap.settings,
        provider: snap.provider,
        credential: snap.credentialId,
        mode: snap.mode,
        currentMonth: { month: snap.month, operations: snap.operations, usedChars: snap.usedChars, freeQuota: snap.freeQuota, remainingFree: snap.remainingFree, billableChars: snap.billableChars, estimatedCostUsd: snap.estimatedCostUsd, requests: snap.requests, cachedRequests: snap.cachedRequests, failedRequests: snap.failedRequests, lastReset: snap.lastReset, nextReset: snap.nextReset },
        ledgers: snap.ledgers,
        history: snap.history,
        recentRequests: snap.log,
      },
      null,
      2,
    );
  }
}
