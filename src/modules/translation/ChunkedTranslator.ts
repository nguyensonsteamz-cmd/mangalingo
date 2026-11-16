/**
 * Long-text translation runner: split → translate chunks (sequentially or with limited concurrency) → merge in order.
 *  - every chunk is retried on its own (exponential backoff + jitter, honours Retry-After), never the whole job;
 *  - every chunk has a stable IDEMPOTENCY KEY (job id + index + hash of its text): a retry, or "retry failed chunks",
 *    reuses it so the usage counter can count a chunk exactly once;
 *  - cancellation (AbortSignal) stops scheduling and discards in-flight results; finished chunks keep their result;
 *  - progress is reported after every change; a partial result is returned with the list of failed chunks.
 * The provider call itself is injected (`ChunkTranslate`): the app passes the Google router message or the device translator.
 */
import { mergeChunks, splitIntoChunks, type Chunk } from './chunker';
import { PROVIDER_LIMITS, type ProviderId, type ProviderLimits } from './providers';

/** Thrown by a provider; the flags tell the runner what to do. Anything else is treated as retryable. */
export class TranslationError extends Error {
  constructor(
    message: string,
    public opts: { retryable?: boolean; fatal?: boolean; retryAfterMs?: number; code?: string; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export class TextTooLargeError extends Error {
  constructor(public chars: number, public limit: number) {
    super(`Văn bản dài ${chars.toLocaleString('en-US')} ký tự, vượt giới hạn an toàn ${limit.toLocaleString('en-US')} ký tự.`);
    this.name = 'TextTooLargeError';
  }
}

export interface ChunkContext {
  signal: AbortSignal;
  idempotencyKey: string;
  attempt: number;
  index: number;
  total: number;
  jobId: string;
}
export type ChunkTranslate = (source: string, ctx: ChunkContext) => Promise<string>;

export type JobStatus = 'running' | 'done' | 'partial' | 'cancelled' | 'failed';
export interface JobProgress {
  status: JobStatus;
  total: number;
  completed: number;
  failed: number;
  retrying: number;
  inFlight: number;
  charsTotal: number;
  charsDone: number;
}

export interface ChunkOutcome {
  index: number;
  chars: number;
  status: 'done' | 'failed' | 'skipped' | 'cancelled';
  translated?: string;
  attempts: number;
  error?: string;
  errorCode?: string;
  /** provider detail of the last failure (a quota block carries its decision) */
  errorDetail?: unknown;
  idempotencyKey: string;
}

export interface JobResult {
  jobId: string;
  /** all chunks merged in order; a chunk that failed keeps its ORIGINAL text (see failedIndexes) */
  text: string;
  complete: boolean;
  cancelled: boolean;
  chunks: Chunk[];
  outcomes: ChunkOutcome[];
  failedIndexes: number[];
}

export interface RunOptions {
  jobId?: string;
  provider?: ProviderId;
  limits?: Partial<ProviderLimits>;
  concurrency?: number;
  /** retries after the first attempt (default 2 → up to 3 attempts per chunk) */
  maxRetries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  signal?: AbortSignal;
  onProgress?: (p: JobProgress) => void;
  /** application-level safety limit for the whole input (default 500,000 characters) */
  maxTotalChars?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const DEFAULT_MAX_TOTAL = 500_000;

/** FNV-1a 32-bit hash (hex): enough to tell chunks of one job apart. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const newJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const idempotencyKeyOf = (jobId: string, index: number, source: string) => `${jobId}:${index}:${hashText(source)}`;

export const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

function limitsOf(o: RunOptions): ProviderLimits {
  const base = PROVIDER_LIMITS[o.provider ?? 'device'];
  const l = { ...base, ...(o.limits ?? {}) };
  // a UTF-8 code point is at most 4 bytes: this keeps every chunk under the byte limit as well
  const max = Math.max(1, Math.min(l.maxChars, Math.floor(l.maxBytes / 4)));
  return { ...l, maxChars: max, targetChars: Math.min(l.targetChars, max) };
}

export function planChunks(text: string, o: RunOptions = {}): Chunk[] {
  const limit = o.maxTotalChars ?? DEFAULT_MAX_TOTAL;
  const total = Array.from(text).length;
  if (total > limit) throw new TextTooLargeError(total, limit);
  const l = limitsOf(o);
  return splitIntoChunks(text, { target: l.targetChars, max: l.maxChars });
}

async function run(chunks: Chunk[], jobId: string, done: Map<number, string>, translate: ChunkTranslate, o: RunOptions): Promise<JobResult> {
  const l = limitsOf(o);
  const maxAttempts = (o.maxRetries ?? 2) + 1;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  const concurrency = Math.max(1, Math.floor(o.concurrency ?? l.concurrency));
  const aborted = () => !!o.signal?.aborted;

  const outcomes: ChunkOutcome[] = chunks.map((c) => ({
    index: c.index,
    chars: c.chars,
    status: done.has(c.index) ? 'done' : 'skipped',
    translated: done.get(c.index),
    attempts: 0,
    idempotencyKey: idempotencyKeyOf(jobId, c.index, c.source),
  }));
  const state = { retrying: 0, inFlight: 0, fatal: false };
  const charsTotal = chunks.reduce((n, c) => n + c.chars, 0);
  const snapshot = (status: JobStatus): JobProgress => ({
    status,
    total: chunks.length,
    completed: outcomes.filter((x) => x.status === 'done').length,
    failed: outcomes.filter((x) => x.status === 'failed').length,
    retrying: state.retrying,
    inFlight: state.inFlight,
    charsTotal,
    charsDone: outcomes.filter((x) => x.status === 'done').reduce((n, x) => n + x.chars, 0),
  });
  const emit = (status: JobStatus = 'running') => o.onProgress?.(snapshot(status));

  /** resolves true when the signal fires before `ms` have passed */
  const waitOrAbort = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (aborted()) return resolve(true);
      const onAbort = () => resolve(true);
      o.signal?.addEventListener('abort', onAbort, { once: true });
      sleep(ms).then(() => {
        o.signal?.removeEventListener('abort', onAbort);
        resolve(false);
      });
    });

  const abortPromise = new Promise<'abort'>((resolve) => {
    if (aborted()) return resolve('abort');
    o.signal?.addEventListener('abort', () => resolve('abort'), { once: true });
  });

  async function work(c: Chunk) {
    const out = outcomes[c.index];
    const signal = o.signal ?? new AbortController().signal;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (aborted()) {
        out.status = 'cancelled';
        return;
      }
      out.attempts = attempt;
      state.inFlight++;
      emit();
      try {
        const res = await Promise.race([translate(c.source, { signal, idempotencyKey: out.idempotencyKey, attempt, index: c.index, total: chunks.length, jobId }), abortPromise]);
        state.inFlight--;
        if (res === 'abort') {
          out.status = 'cancelled'; // the in-flight result (if it ever arrives) is discarded
          emit();
          return;
        }
        out.status = 'done';
        out.translated = res;
        out.error = undefined;
        emit();
        return;
      } catch (e) {
        state.inFlight--;
        if (isAbort(e) || aborted()) {
          out.status = 'cancelled';
          emit();
          return;
        }
        const te = e as TranslationError;
        out.error = String((e as Error)?.message ?? e);
        out.errorCode = te.opts?.code;
        out.errorDetail = te.opts?.detail;
        if (te.opts?.fatal) {
          state.fatal = true; // e.g. quota blocked / invalid key: retrying or continuing cannot help
          out.status = 'failed';
          emit();
          return;
        }
        if (te.opts?.retryable === false || attempt === maxAttempts) {
          out.status = 'failed';
          emit();
          return;
        }
        state.retrying++;
        emit();
        const base = Math.min(o.maxBackoffMs ?? 8000, (o.backoffMs ?? 400) * 2 ** (attempt - 1));
        const wait = te.opts?.retryAfterMs ?? base * (0.5 + random() / 2);
        const cancelled = await waitOrAbort(wait);
        state.retrying--;
        if (cancelled) {
          out.status = 'cancelled';
          emit();
          return;
        }
      }
    }
  }

  // controlled concurrency: `concurrency` workers pull the next pending chunk
  const pending = chunks.filter((c) => !done.has(c.index));
  let next = 0;
  emit();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (next < pending.length && !state.fatal && !aborted()) await work(pending[next++]);
    }),
  );
  for (const out of outcomes) if (out.status === 'skipped' && aborted()) out.status = 'cancelled';

  const failedIndexes = outcomes.filter((x) => x.status !== 'done').map((x) => x.index);
  const cancelled = aborted();
  const complete = failedIndexes.length === 0;
  const result: JobResult = {
    jobId,
    text: mergeChunks(chunks, outcomes.map((x) => (x.status === 'done' ? x.translated : null))),
    complete,
    cancelled,
    chunks,
    outcomes,
    failedIndexes,
  };
  emit(complete ? 'done' : cancelled ? 'cancelled' : outcomes.some((x) => x.status === 'done') ? 'partial' : 'failed');
  return result;
}

/** Translates `text` of any length. Empty / whitespace-only text is returned as is. */
export async function translateLong(text: string, translate: ChunkTranslate, o: RunOptions = {}): Promise<JobResult> {
  const chunks = planChunks(text, o);
  const jobId = o.jobId ?? newJobId();
  if (!chunks.length) return { jobId, text, complete: true, cancelled: false, chunks, outcomes: [], failedIndexes: [] };
  return run(chunks, jobId, new Map(), translate, o);
}

/** Re-runs ONLY the chunks that did not finish. They keep their idempotency keys, so a chunk is never counted twice. */
export async function retryFailedChunks(prev: JobResult, translate: ChunkTranslate, o: RunOptions = {}): Promise<JobResult> {
  const done = new Map<number, string>();
  for (const x of prev.outcomes) if (x.status === 'done' && x.translated !== undefined) done.set(x.index, x.translated);
  return run(prev.chunks, prev.jobId, done, translate, { ...o, jobId: prev.jobId });
}
