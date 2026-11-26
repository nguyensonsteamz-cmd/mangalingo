/**
 * Long-text translation glue: the chunked runner (src/modules/translation) + the two providers the app has.
 *  - Google Translate (web): each chunk goes through the usage guard (`usage:translate`) with its IDEMPOTENCY KEY, so a retry is counted once;
 *    a block / CAPTCHA / rate limit is FATAL for the job (nothing more is sent), network errors are retried a bounded number of times.
 *  - on-device: the platform translator; its successful use is recorded in an informational (unmetered) ledger.
 * Everything the app does with long text goes through here: no silent truncation anywhere.
 */
import { countChars } from '@/modules/usage/count';
import { TranslationError, retryFailedChunks, translateLong, type ChunkTranslate, type JobResult, type ProviderId, type RunOptions } from '@/modules/translation';
import type { TranslateOutcome } from '@/modules/usage/types';

export interface LongTextDeps {
  /** is Google Translate (web) selected? */
  googleActive(): Promise<boolean>;
  /** one chunk through the usage guard */
  sendGoogle(text: string, o: { idempotencyKey: string; keepBreaks: boolean }): Promise<TranslateOutcome>;
  deviceTranslate(text: string): Promise<string>;
  /** Optional: picks the on-device provider for this job (platform translator or the downloaded model); overrides deviceProvider / deviceTranslate. */
  resolveDevice?(): Promise<{ provider: ProviderId; translate(text: string, o?: { signal?: AbortSignal }): Promise<string> }>;
  /** which on-device provider is this platform (for the informational ledger) */
  deviceProvider: ProviderId;
  /** informational ledger of the on-device provider */
  reportDevice?(provider: string, chars: number, idempotencyKey: string): Promise<unknown> | void;
  /** a finished job = one operation (idempotent per job id) */
  completeOperation?(jobId: string): Promise<unknown> | void;
}

export interface LongTextOptions extends RunOptions {
  /** direction (default en→vi) */
  pair?: import('@/modules/mt').LanguagePair;
  /** retry only the chunks of this earlier (partial) result */
  retryFrom?: JobResult;
}

/** How a provider error should be treated by the runner. */
export function classifyError(e: unknown): TranslationError {
  if (e instanceof TranslationError) return e;
  const err = e as { message?: string; code?: string; name?: string };
  const code = String(err?.code ?? '');
  const w = code.match(/^gweb-([A-Z_]+)$/);
  if (w) {
    // Google Translate web: a block / CAPTCHA / rate limit is FATAL for the job (nothing more is sent); only network errors and timeouts are retried
    const retryable = w[1] === 'NETWORK_ERROR' || w[1] === 'TIMEOUT';
    const fatal = ['RATE_LIMITED', 'ACCESS_BLOCKED', 'CAPTCHA_REQUIRED', 'UNREADABLE_REPLY', 'PAUSED', 'INVALID_LANGUAGE', 'CANCELLED'].includes(w[1]);
    return new TranslationError(String(err?.message ?? e), { retryable, fatal, code });
  }
  const message = String(err?.message ?? e);
  return new TranslationError(message, { retryable: true, code: code || 'network' }); // network / transport: try again
}

export async function translateLongText(text: string, deps: LongTextDeps, o: LongTextOptions = {}): Promise<JobResult> {
  const google = await deps.googleActive();
  const dev = google ? null : await deps.resolveDevice?.();
  const provider: ProviderId = google ? 'google-web' : dev?.provider ?? deps.deviceProvider;

  const translate: ChunkTranslate = async (src, ctx) => {
    try {
      if (google) {
        const r = await deps.sendGoogle(src, { idempotencyKey: ctx.idempotencyKey, keepBreaks: true });
        if (r.source === 'google') return r.text;
        // 'device': the provider was switched while the job ran → use the device translator for the rest
      }
      const out = dev ? await dev.translate(src, { signal: ctx.signal }) : await deps.deviceTranslate(src);
      void deps.reportDevice?.(provider, countChars(src), ctx.idempotencyKey);
      return out;
    } catch (e) {
      throw classifyError(e);
    }
  };

  const ro: RunOptions = { ...o, provider };
  const result = o.retryFrom ? await retryFailedChunks(o.retryFrom, translate, ro) : await translateLong(text, translate, ro);
  if (result.complete && result.chunks.length) await deps.completeOperation?.(result.jobId);
  return result;
}
