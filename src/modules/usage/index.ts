/**
 * Translation usage meter, free-quota tracking and cost protection for the optional Google Cloud
 * Translation provider. On-device translation (the default) is never metered.
 *
 * IMPORTANT: every number here is a LOCAL ESTIMATE kept on this device. It is not Google Cloud Billing
 * data, billing can be delayed, and local limits cannot guarantee that no charge will ever occur.
 */
import type { KV } from '@/storage/kv';
import { MessageError } from '@/shared/messages';
import { CostProtectionService } from './CostProtectionService';
import { QuotaManager } from './QuotaManager';
import { UsageMeter } from './UsageMeter';
import { UsageRepository } from './UsageRepository';
import { sanitizeUsageSettings } from './UsageSettings';
import { UsageWarningManager } from './UsageWarningManager';
import { googleTranslate, type FetchLike } from './google';
import type { TranslateOutcome, UsageSettings, UsageSnapshot } from './types';

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
    this.repo = new UsageRepository(kv);
    this.quota = new QuotaManager(this.meter);
    this.protection = new CostProtectionService(this.repo, this.meter, this.quota, this.clock);
  }

  async snapshot(): Promise<UsageSnapshot> {
    // under the lock: never reads a half-written reservation
    return this.protection.run(async () => {
      const now = this.clock();
      const [state, settings, key] = await Promise.all([this.repo.load(now), this.repo.loadSettings(), this.repo.getKey()]);
      const snap = this.meter.snapshot(state, settings, key, now);
      this.warnings.evaluate(snap);
      return snap;
    });
  }

  /** Translation entry point. Device mode (default) tells the caller to use the on-device translator. */
  async translate(text: string): Promise<TranslateOutcome> {
    const settings = await this.repo.loadSettings();
    const key = await this.repo.getKey();
    if (settings.provider !== 'google' || !key) return { source: 'device' };
    const r = await this.protection.translate(text, (t) => googleTranslate(t, key, this.fetchImpl));
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

  async setApiKey(key: string | null): Promise<void> {
    const k = key?.trim() ?? '';
    if (k && (k.length < 20 || /\s/.test(k))) throw new MessageError('Khoá API không hợp lệ.', 'bad-key');
    await this.repo.setKey(k || null);
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
    if (format === 'csv') {
      const rows = [...snap.history, { month: snap.month, chars: snap.usedChars, requests: snap.requests, cachedRequests: snap.cachedRequests, cachedChars: snap.cachedChars, failedRequests: snap.failedRequests, paidChars: snap.paidChars, paidRequests: snap.paidRequests }];
      return ['month,characters,requests,cached_requests,cached_characters,failed_requests,paid_characters,paid_requests', ...rows.map((r) => [r.month, r.chars, r.requests, r.cachedRequests, r.cachedChars, r.failedRequests, r.paidChars, r.paidRequests].join(','))].join('\n');
    }
    return JSON.stringify(
      {
        generatedAt: this.clock().toISOString(),
        note: USAGE_DISCLAIMER,
        settings: snap.settings,
        currentMonth: { month: snap.month, usedChars: snap.usedChars, freeQuota: snap.freeQuota, remainingFree: snap.remainingFree, billableChars: snap.billableChars, estimatedCostUsd: snap.estimatedCostUsd, requests: snap.requests, cachedRequests: snap.cachedRequests, failedRequests: snap.failedRequests, lastReset: snap.lastReset, nextReset: snap.nextReset },
        history: snap.history,
        recentRequests: snap.log,
      },
      null,
      2,
    );
  }
}
