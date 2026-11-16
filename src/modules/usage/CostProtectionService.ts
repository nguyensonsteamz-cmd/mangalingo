import { countChars, normalizeText } from './count';
import { QuotaManager } from './QuotaManager';
import { UsageMeter } from './UsageMeter';
import { UsageRepository } from './UsageRepository';
import type { BlockedDecision } from './types';

export type ProtectedResult =
  | { status: 'ok'; text: string; cached: boolean; chars: number; paid: boolean }
  | { status: 'blocked'; decision: BlockedDecision };

/** Sends one text to the paid API. Injected so the service can be tested without a network. */
export type Sender = (text: string) => Promise<string>;

/**
 * Guards every paid translation request:
 *   normalise -> cache -> count -> quota -> authorisation -> limits -> cost estimate -> RESERVE -> send -> record.
 *
 * The check and the reservation happen together inside one lock, so simultaneous translations cannot
 * pass the local quota check at the same time (the characters of an admitted request are counted before
 * it is sent). Identical texts in flight share one request. These are local estimates, not billing data.
 */
export class CostProtectionService {
  private chain: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, string>();
  private cacheLoaded = false;
  private inflight = new Map<string, Promise<ProtectedResult>>();

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

  private async remember(text: string, out: string) {
    this.cache.delete(text);
    this.cache.set(text, out);
    while (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value as string);
    await this.repo.saveCache([...this.cache.entries()]).catch(() => {});
  }

  private async countCached(chars: number) {
    await this.run(async () => {
      const now = this.clock();
      const state = await this.repo.load(now);
      this.meter.recordCached(state, chars, now);
      await this.repo.save(state);
    });
  }

  async translate(raw: string, send: Sender): Promise<ProtectedResult> {
    const text = normalizeText(raw); // 1. normalise
    if (!text) return { status: 'ok', text: '', cached: true, chars: 0, paid: false };
    const chars = countChars(text); // 3. count

    await this.loadCache(); // 2. cache
    const hit = this.cache.get(text);
    if (hit !== undefined) {
      await this.countCached(chars);
      return { status: 'ok', text: hit, cached: true, chars, paid: false };
    }

    const pending = this.inflight.get(text); // avoid duplicate requests
    if (pending) {
      const r = await pending;
      if (r.status === 'ok') {
        await this.countCached(chars);
        return { ...r, cached: true };
      }
      return r;
    }

    const p = this.execute(text, chars, send).finally(() => this.inflight.delete(text));
    this.inflight.set(text, p);
    return p;
  }

  private async execute(text: string, chars: number, send: Sender): Promise<ProtectedResult> {
    // 4-8, 10-11: check + reserve atomically
    const admitted = await this.run(async () => {
      const now = this.clock();
      const settings = await this.repo.loadSettings();
      const state = await this.repo.load(now);
      const d = this.quota.decide(state, settings, chars);
      if (d.action === 'block') {
        this.meter.recordBlocked(state, chars, now);
        await this.repo.save(state);
        return { blocked: d.decision, paid: false };
      }
      this.meter.reserve(state, chars, d.billableChars, now);
      await this.repo.save(state);
      return { blocked: null, paid: d.billableChars > 0 };
    });
    if (admitted.blocked) return { status: 'blocked', decision: admitted.blocked };

    try {
      const out = await send(text); // 9. send (outside the lock)
      await this.remember(text, out);
      return { status: 'ok', text: out, cached: false, chars, paid: admitted.paid };
    } catch (e) {
      // the request had been initiated: the characters stay counted (conservative); mark it failed
      await this.run(async () => {
        const now = this.clock();
        const state = await this.repo.load(now);
        this.meter.recordFailed(state, chars, now);
        await this.repo.save(state);
      }).catch(() => {});
      throw e;
    }
  }
}
