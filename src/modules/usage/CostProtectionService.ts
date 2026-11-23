import { countChars, normalizeChunk, normalizeText } from './count';
import { UsageMeter, type Active } from './UsageMeter';
import { UsageRepository, ledgerKey } from './UsageRepository';

export interface ProtectedResult {
  text: string;
  cached: boolean;
  chars: number;
}

/** Sends one text to the provider. Injected so the service can be tested without a network. */
export type Sender = (text: string) => Promise<string>;

export interface ProtectContext extends Active {
  /** stable key of this chunk: a retry with the same key is counted once */
  idempotencyKey?: string;
  /** chunk of a long text: keep its line breaks */
  keepBreaks?: boolean;
}

/**
 * Wraps every provider request: normalise -> cache -> share identical in-flight requests -> send -> COUNT on success / note the failure.
 * There is no quota and no paid tier to enforce (see types.ts); this is bookkeeping and de-duplication.
 *
 * Accounting rules:
 *  - only SUCCESSFUL requests are counted, with the source characters that were sent, each exactly once (idempotency key);
 *  - a failed / cancelled request counts nothing (only the informational failure counter);
 *  - a cache hit is not a new request; identical texts in flight share one request.
 */
export class CostProtectionService {
  private chain: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, string>();
  private cacheLoaded = false;
  private inflight = new Map<string, Promise<ProtectedResult>>();

  constructor(
    private repo: UsageRepository,
    private meter: UsageMeter,
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

  /** cache key: en>vi keeps the plain text; any other direction is prefixed so a result is never reused across directions */
  private ck(text: string, pair?: string) {
    return !pair || pair === 'en>vi' ? text : `${pair}${text}`;
  }

  private async remember(key: string, out: string) {
    this.cache.delete(key);
    this.cache.set(key, out);
    while (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value as string);
    await this.repo.saveCache([...this.cache.entries()]).catch(() => {});
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
    const text = ctx.keepBreaks ? normalizeChunk(raw) : normalizeText(raw);
    if (!text) return { text: '', cached: true, chars: 0 };
    const chars = countChars(text);

    await this.loadCache();
    const hit = this.cache.get(this.ck(text, ctx.languagePair));
    if (hit !== undefined) {
      await this.countCached(ctx, chars);
      return { text: hit, cached: true, chars };
    }

    const flightKey = `${ledgerKey(ctx.provider)}|${ctx.languagePair ?? 'en>vi'}|${text}`; // avoid duplicate requests
    const pending = this.inflight.get(flightKey);
    if (pending) {
      const r = await pending;
      await this.countCached(ctx, chars);
      return { ...r, cached: true };
    }

    const p = this.execute(text, chars, send, ctx).finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, p);
    return p;
  }

  private async execute(text: string, chars: number, send: Sender, ctx: ProtectContext): Promise<ProtectedResult> {
    // already counted under this key (a retry of a chunk that succeeded before)
    const counted = await this.run(async () => this.meter.isCommitted(await this.repo.load(this.clock()), ctx.idempotencyKey));
    try {
      const out = await send(text);
      await this.run(async () => {
        const now = this.clock();
        const state = await this.repo.load(now);
        this.meter.commit(state, ctx, chars, ctx.idempotencyKey, now);
        await this.repo.save(state);
      });
      await this.remember(this.ck(text, ctx.languagePair), out);
      return { text: out, cached: counted, chars };
    } catch (e) {
      // failure / cancellation: nothing is counted
      await this.run(async () => {
        const now = this.clock();
        const state = await this.repo.load(now);
        this.meter.recordFailed(state, ctx, chars, now);
        await this.repo.save(state);
      }).catch(() => {});
      throw e;
    }
  }

  /** Records a successful use of an on-device provider: informational ledger. */
  async recordProcessed(a: Active, chars: number, key?: string): Promise<void> {
    await this.run(async () => {
      const now = this.clock();
      const state = await this.repo.load(now);
      this.meter.commit(state, a, chars, key, now);
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
