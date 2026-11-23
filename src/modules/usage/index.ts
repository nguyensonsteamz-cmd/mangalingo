/**
 * Translation usage bookkeeping for the two providers LingoLens uses: on-device translation (free, local) and Google
 * Translate web (the default: unofficial, no key, no billing). Every number is a LOCAL counter kept on this device: neither provider
 * has a quota or bill that LingoLens could measure or enforce. Google Cloud Translation (API key, billing, quota) was removed.
 */
import type { KV } from '@/storage/kv';
import { MessageError } from '@/shared/messages';
import { CostProtectionService } from './CostProtectionService';
import { UsageMeter } from './UsageMeter';
import { WEB_PROVIDER, UsageRepository } from './UsageRepository';
import { sanitizeUsageSettings } from './UsageSettings';
import { GoogleWebError, GoogleWebGate, type GateOptions, type WebFetch } from './google-web';
import type { TranslateOptions, TranslateOutcome, UsageSettings, UsageSnapshot } from './types';

export * from './types';
export { countChars, normalizeText } from './count';
export { DEFAULT_USAGE_SETTINGS, sanitizeUsageSettings } from './UsageSettings';
export { UsageMeter } from './UsageMeter';
export { UsageRepository } from './UsageRepository';
export { CostProtectionService } from './CostProtectionService';
export { USAGE_DISCLAIMER } from './disclaimer';
import { USAGE_DISCLAIMER } from './disclaimer';

export interface UsageServiceOptions {
  clock?: () => Date;
  /** network for Google Translate web (tests inject a fake; default = fetch) */
  webFetch?: WebFetch;
  /** pacing / cooldown of Google Translate web (tests shorten it) */
  webGate?: GateOptions;
}

/** Facade used by the background / in-app router. */
export class UsageService {
  readonly repo: UsageRepository;
  readonly meter = new UsageMeter();
  readonly protection: CostProtectionService;
  private clock: () => Date;
  private webFetch?: WebFetch;
  readonly webGate: GoogleWebGate;

  constructor(kv: KV, opts: UsageServiceOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.webFetch = opts.webFetch;
    this.webGate = new GoogleWebGate({ ...opts.webGate, store: opts.webGate?.store ?? { get: () => kv.get<number>('gweb:cooldown'), set: (n) => kv.set({ 'gweb:cooldown': n }) } });
    this.repo = new UsageRepository(kv);
    this.protection = new CostProtectionService(this.repo, this.meter, this.clock);
  }

  /** The ledger being displayed: Google Translate web, or the informational on-device one. */
  private async active() {
    const s = await this.repo.loadSettings();
    return { provider: s.provider === 'google-web' ? WEB_PROVIDER : 'device' };
  }

  async snapshot(): Promise<UsageSnapshot> {
    // under the lock: never reads a half-written update
    return this.protection.run(async () => {
      const now = this.clock();
      const [state, settings, active] = await Promise.all([this.repo.load(now), this.repo.loadSettings(), this.active()]);
      return this.meter.snapshot(state, settings, now, active);
    });
  }

  /**
   * Translation entry point. Device mode tells the caller to use the on-device translator. Google Translate web goes
   * through the guard (cache, idempotency, in-flight sharing, counters) and the gate (one request at a time, spacing, cooldown
   * after a block). Errors keep their code (message code 'gweb-<CODE>').
   */
  async translate(text: string, opts: TranslateOptions = {}): Promise<TranslateOutcome> {
    const settings = await this.repo.loadSettings();
    if (settings.provider !== 'google-web') return { source: 'device' };
    const active = { provider: WEB_PROVIDER, languagePair: opts.languagePair ?? 'en>vi' };
    try {
      const r = await this.protection.translate(text, (t) => this.webGate.run(t, active.languagePair, { fetchImpl: this.webFetch }), { ...active, idempotencyKey: opts.idempotencyKey, keepBreaks: opts.keepBreaks });
      return { source: 'google', text: r.text, cached: r.cached, chars: r.chars };
    } catch (e) {
      if (e instanceof GoogleWebError) throw new MessageError(e.message, 'gweb-' + e.code);
      throw e;
    }
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

  /** Google Translate web: no key, no setup. Opt-in (text is sent to Google); never switched on automatically. */
  async activateGoogleWeb(): Promise<void> {
    await this.updateSettings({ provider: 'google-web' });
  }

  /** A finished translation job (any number of chunks) = one operation. Idempotent per job id. */
  async completeOperation(jobId: string): Promise<void> {
    await this.protection.recordOperation(await this.active(), jobId);
  }

  /** On-device providers: their successful use is recorded in a separate, informational ledger. */
  async recordDeviceProcessed(provider: string, chars: number, idempotencyKey?: string): Promise<void> {
    await this.protection.recordProcessed({ provider }, chars, idempotencyKey);
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

  /** A report of the locally tracked usage. */
  async exportReport(format: 'json' | 'csv' = 'json'): Promise<string> {
    const snap = await this.snapshot();
    const rows = [...snap.history, ...snap.ledgers];
    if (format === 'csv') {
      return [
        'month,provider,language_pair,characters,operations,requests,cached_requests,cached_characters,failed_requests',
        ...rows.map((r) => [r.month, r.provider, r.languagePair, r.chars, r.operations, r.requests, r.cachedRequests, r.cachedChars, r.failedRequests].join(',')),
      ].join('\n');
    }
    return JSON.stringify(
      {
        generatedAt: this.clock().toISOString(),
        note: USAGE_DISCLAIMER,
        settings: snap.settings,
        provider: snap.provider,
        currentMonth: { month: snap.month, operations: snap.operations, usedChars: snap.usedChars, requests: snap.requests, cachedRequests: snap.cachedRequests, failedRequests: snap.failedRequests, lastReset: snap.lastReset, nextReset: snap.nextReset },
        ledgers: snap.ledgers,
        history: snap.history,
        recentRequests: snap.log,
      },
      null,
      2,
    );
  }
}
