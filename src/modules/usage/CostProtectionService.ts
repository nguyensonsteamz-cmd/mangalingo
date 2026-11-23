import { countChars, normalizeChunk, normalizeText } from './count';
import { QuotaManager } from './QuotaManager';
import { UsageMeter, type Active } from './UsageMeter';
import { UsageRepository, ledgerKey } from './UsageRepository';
import type { BlockedDecision } from './types';

export type ProtectedResult =
  | { status: 'ok'; text: string; cached: boolean; chars: number; paid: boolean }
  | { status: 'blocked'; decision: BlockedDecision };

/** Sends one text to the paid API. Injected so the service can be tested without a network. */
export type Sender = (text: string) => Promise<string>;

export interface ProtectContext extends Active {
  /** stable key of this chunk: a retry with the same key is counted once */
  idempotencyKey?: string;
  /** chunk of a long text: keep its line breaks */
  keepBreaks?: boolean;
  /** false = no billing and no quota exist for this provider (Google web): nothing is checked against the free quota or the paid limits */
  metered?: boolean;
}

/**
 * Guards every paid translation request:
 *   normalise -> cache -> count -> quota -> authorisation -> limits -> RESERVE -> send -> COMMIT on success / RELEASE on failure.
 *
 * Accounting rules:
 *  - only SUCCESSFUL requests are counted, with the source characters that were sent, each exactly once (idempotency key);
 *  - while a request is in flight its characters are RESERVED (inside one lock) so simultaneous requests cannot pass the
 *    local quota check together; a failed / cancelled request releases the reservation and counts nothing;
 *  - a cache hit is not new usage; identical texts in flight share one request.
 * These are local estimates, not Google's billing meter.
 */
export class CostProtectionService {
  private chain: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, string>();
  private cacheLoaded = false;
  private inflight = new Map<string, Promise<ProtectedResult>>();
  /** requests in flight: reservation token -> ledger + characters */
  private pending = new Map<symbol, { ledger: string; chars: number }>();

  constructor(
    private repo: UsageRepository,
    private meter: UsageMeter,
    private quota: QuotaManager,
    private clock: () => Date = () => new Date(),
  ) {}

  /** Runs `fn` after every earlier locked operation has finished (a simple async mutex). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  private async loadCache() {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    for (const [k, v] of await this.repo.loadCache()) this.cache.set(k, v);
  }

  clearCache() {
    this.cache.clear();
    this.cacheLoaded = true;
  }

  /** cache key: en>vi keeps the plain text (existing cache entries stay valid); any other direction is prefixed so a result is never reused across directions */
  private ck(text: string, pair?: string) {
    return !pair || pair === 'en>vi' ? text : `${pair}${text}`;
  }

  private async remember(key: string, out: string) {
    this.cache.delete(key);
    this.cache.set(key, out);
    while (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value as string);
    await this.repo.saveCache([...this.cache.entries()]).catch(() => {});
  }

  private pendingFor(ledger: string): number {
    let n = 0;
    for (const p of this.pending.values()) if (p.ledger === ledger) n += p.chars;
    return n;
  }

  private async countCached(a: Active, chars: number) {
    await this.run(async () => {
      const now = this.clock();
      const state = await this.repo.load(now);
      this.meter.recordCached(state, a, chars, now);
      await this.repo.save(state);
    });
  }

  async translate(raw: string, send: Sender, ctx: ProtectContext): Promise<ProtectedResult> {
    const text = ctx.keepBreaks ? normalizeChunk(raw) : normalizeText(raw); // 1. normalise
    if (!text) return { status: 'ok', text: '', cached: true, chars: 0, paid: false };
    const chars = countChars(text); // 3. count

    await this.loadCache(); // 2. cache
    const hit = this.cache.get(this.ck(text, ctx.languagePair));
    if (hit !== undefined) {
      await this.countCached(ctx, chars);
      return { status: 'ok', text: hit, cached: true, chars, paid: false };
    }

    const flightKey = `${ledgerKey(ctx.provider, ctx.credentialId)}|${ctx.languagePair ?? 'en>vi'}|${text}`; // avoid duplicate requests
    const pending = this.inflight.get(flightKey);
    if (pending) {
      const r = await pending;
      if (r.status === 'ok') {
        await this.countCached(ctx, chars);
        return { ...r, cached: true };
      }
      return r;
    }

    const p = this.execute(text, chars, send, ctx).finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, p);
    return p;
  }

  private async execute(text: string, chars: number, send: Sender, ctx: ProtectContext): Promise<ProtectedResult> {
    const lk = ledgerKey(ctx.provider, ctx.credentialId);
    // 4-8: check + reserve atomically
    const admitted = await this.run(async () => {
      const now = this.clock();
      const settings = await this.repo.loadSettings();
      const state = await this.repo.load(now);
      // already counted under this key (a retry): nothing new to reserve or to enforce
      if (this.meter.isCommitted(state, ctx.idempotencyKey)) return { blocked: null, paid: false, token: Symbol('r'), billable: 0, counted: true } as const;
      if (ctx.metered === false) {
        const token = Symbol('r');
        this.pending.set(token, { ledger: lk, chars });
        return { blocked: null, paid: false, token, billable: 0, counted: false } as const;
      }
      const d = this.quota.decide(state, state.ledgers[lk], settings, chars, this.pendingFor(lk));
      if (d.action === 'block') {
        this.meter.recordBlocked(state, ctx, chars, now);
        await this.repo.save(state);
        return { blocked: d.decision, paid: false, token: Symbol('b'), billable: 0, counted: false } as const;
      }
      const token = Symbol('r');
      this.pending.set(token, { ledger: lk, chars });
      return { blocked: null, paid: d.billableChars > 0, token, billable: d.billableChars, counted: false } as const;
    });
    if (admitted.blocked) return { status: 'blocked', decision: admitted.blocked };

    try {
      const out = await send(text); // 9. send (outside the lock)
      // 10-11: success → COMMIT (once)
      await this.run(async () => {
        this.pending.delete(admitted.token);
        const now = this.clock();
        const state = await this.repo.load(now);
        this.meter.commit(state, ctx, chars, admitted.billable, ctx.idempotencyKey, now);
        await this.repo.save(state);
      });
      await this.remember(this.ck(text, ctx.languagePair), out);
      return { status: 'ok', text: out, cached: admitted.counted, chars, paid: admitted.paid };
    } catch (e) {
      // failure / cancellation → RELEASE the reservation; nothing is counted
      await this.run(async () => {
        this.pending.delete(admitted.token);
        const now = this.clock();
        const state = await this.repo.load(now);
        this.meter.recordFailed(state, ctx, chars, now);
        await this.repo.save(state);
      }).catch(() => {});
      throw e;
    }
  }

  /** Records a successful use of a provider that is not metered (on-device): informational ledger, no quota. */
  async recordProcessed(a: Active, chars: number, key?: string): Promise<void> {
    await this.run(async () => {
      const now = this.clock();
      const state = await this.repo.load(now);
      this.meter.commit(state, a, chars, 0, key, now);
      await this.repo.save(state);
    });
  }

  /** One finished translation job = one operation (idempotent per job id). */
  async recordOperation(a: Active, jobId: string): Promise<void> {
    await this.run(async () => {
      const state = await this.repo.load(this.clock());
      if (this.meter.recordOperation(state, a, jobId)) await this.repo.save(state);
    });
  }
}
