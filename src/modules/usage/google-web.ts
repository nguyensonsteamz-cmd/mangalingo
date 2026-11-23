/**
 * Google Translate (web, UNOFFICIAL) client. No API key, no Google Cloud project, no billing.
 *
 * Reads the public web endpoint `translate.googleapis.com/translate_a/single?client=gtx` directly from the device (no LingoLens
 * server in between). It is NOT an API Google supports: Google can change, rate-limit or block it at any time, and in this
 * project's own tests it answered with its anti-automation page (HTTP 429 "Sorry…") from the test machine.
 *
 * Rules of this module (they are not optional):
 *  - no evasion of any kind: no CAPTCHA solving, no proxy / IP rotation, no spoofed browser identity, no custom headers;
 *  - one request at a time, a minimum interval between requests, a timeout, cancellation;
 *  - retry ONLY transient network errors, never a block, a CAPTCHA or a rate limit: those start a cooldown (no network use)
 *    until it ends;
 *  - a body that is not the expected translation JSON (HTML, CAPTCHA page, error page) is an error, never a "translation";
 *  - the text and the URL are never put in an error message or a log.
 */

export type GoogleWebErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'ACCESS_BLOCKED'
  | 'CAPTCHA_REQUIRED'
  | 'INVALID_LANGUAGE'
  | 'TEXT_TOO_LONG'
  | 'TRANSLATION_FAILED'
  | 'CANCELLED';

/** Codes after which NOTHING more is sent for a while. */
export const BLOCKING_CODES: readonly GoogleWebErrorCode[] = ['RATE_LIMITED', 'ACCESS_BLOCKED', 'CAPTCHA_REQUIRED'];

/** Messages for the user (Vietnamese UI): accurate, no stack traces, no claim that Google supports this. */
export const GOOGLE_WEB_MESSAGES: Record<GoogleWebErrorCode, string> = {
  NETWORK_ERROR: 'Không kết nối được tới Google Dịch. Kiểm tra mạng rồi thử lại.',
  TIMEOUT: 'Google Dịch phản hồi quá chậm. Hãy thử lại sau.',
  RATE_LIMITED: 'Google Dịch đang giới hạn số yêu cầu. Hãy đợi một lúc rồi thử lại.',
  ACCESS_BLOCKED: 'Google Dịch tạm thời không dùng được: dịch vụ có thể đang chặn các yêu cầu tự động. Hãy đợi rồi thử lại sau, hoặc chuyển sang dịch trên thiết bị.',
  CAPTCHA_REQUIRED: 'Google Dịch tạm thời không dùng được: dịch vụ có thể đang giới hạn các yêu cầu tự động. Hãy đợi rồi thử lại sau, hoặc chuyển sang dịch trên thiết bị.',
  INVALID_LANGUAGE: 'Cặp ngôn ngữ này không được hỗ trợ.',
  TEXT_TOO_LONG: 'Đoạn văn bản quá dài cho một yêu cầu.',
  TRANSLATION_FAILED: 'Google Dịch trả về kết quả không hợp lệ.',
  CANCELLED: 'Đã hủy.',
};

export class GoogleWebError extends Error {
  constructor(
    public code: GoogleWebErrorCode,
    public extra: { status?: number; cooldownUntil?: number } = {},
  ) {
    super(GOOGLE_WEB_MESSAGES[code]);
    this.name = 'GoogleWebError';
  }
  /** only a transient network failure may be tried again */
  get retryable() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
  get blocking() {
    return BLOCKING_CODES.includes(this.code);
  }
}

export const GOOGLE_WEB_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
/** hard limits of one request (code points / encoded URL length): the endpoint is a GET, so the text travels in the URL */
export const GOOGLE_WEB_MAX_CHARS = 1500;
export const GOOGLE_WEB_MAX_URL = 8000;

const LANGS: Record<string, string> = { en: 'en', vi: 'vi', zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW' };
/** 'en', 'EN', 'zh-cn' → the codes the endpoint uses; anything else is INVALID_LANGUAGE */
export function normalizeLang(l: string): string {
  const v = LANGS[String(l ?? '').trim().toLowerCase()];
  if (!v) throw new GoogleWebError('INVALID_LANGUAGE');
  return v;
}

export interface WebFetchResponse {
  status: number;
  url?: string;
  text(): Promise<string>;
}
/** `fetch` restricted to what is needed: GET, an abort signal, NO custom headers. */
export type WebFetch = (url: string, init: { method: 'GET'; signal?: AbortSignal; credentials?: 'omit' }) => Promise<WebFetchResponse>;

const CAPTCHA_PAGE = /unusual traffic|automated queries|\/sorry\/|captcha|recaptcha|Sorry\.\.\./i;

/** The text of a successful answer: `[[["translated","source",…],…],…]`. Anything else is an error. */
export function parseTranslation(body: string, source: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<')) throw new GoogleWebError(CAPTCHA_PAGE.test(body) ? 'CAPTCHA_REQUIRED' : 'TRANSLATION_FAILED');
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new GoogleWebError('TRANSLATION_FAILED');
  }
  const segs = Array.isArray(data) ? (data as unknown[])[0] : null;
  if (!Array.isArray(segs) || !segs.length) throw new GoogleWebError('TRANSLATION_FAILED');
  let out = '';
  for (const s of segs) {
    if (!Array.isArray(s) || typeof s[0] !== 'string') throw new GoogleWebError('TRANSLATION_FAILED');
    out += s[0];
  }
  if (!out.trim()) throw new GoogleWebError('TRANSLATION_FAILED');
  // the source handed back as a "translation" of a real sentence is a failure, not a success
  if (out.trim() === source.trim() && source.length >= 20 && /\s/.test(source.trim())) throw new GoogleWebError('TRANSLATION_FAILED');
  return out;
}

/** HTTP status / final URL → error. `null` = no error (2xx). */
export function classifyHttp(status: number, finalUrl: string | undefined, body: string): GoogleWebError | null {
  if (finalUrl && /\/sorry\//.test(finalUrl)) return new GoogleWebError('CAPTCHA_REQUIRED', { status });
  if (status >= 200 && status < 300) return null;
  if (status === 429) return new GoogleWebError(CAPTCHA_PAGE.test(body) ? 'CAPTCHA_REQUIRED' : 'RATE_LIMITED', { status });
  if (status === 403 || status === 401) return new GoogleWebError('ACCESS_BLOCKED', { status });
  if (status === 400) return new GoogleWebError('TRANSLATION_FAILED', { status });
  if (status === 413 || status === 414) return new GoogleWebError('TEXT_TOO_LONG', { status });
  if (status === 408 || status >= 500) return new GoogleWebError('NETWORK_ERROR', { status });
  return new GoogleWebError('TRANSLATION_FAILED', { status });
}

export interface WebTranslateOptions {
  fetchImpl?: WebFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** One request: validates, sends, classifies. No retry, no waiting: see GoogleWebGate for that. */
export async function googleWebTranslate(text: string, pair: string, o: WebTranslateOptions = {}): Promise<string> {
  const [s, t] = String(pair).split('>');
  const sl = normalizeLang(s);
  const tl = normalizeLang(t);
  if (sl === tl) throw new GoogleWebError('INVALID_LANGUAGE');
  if (!text.trim()) throw new GoogleWebError('TRANSLATION_FAILED');
  if ([...text].length > GOOGLE_WEB_MAX_CHARS) throw new GoogleWebError('TEXT_TOO_LONG');
  const url = `${GOOGLE_WEB_ENDPOINT}?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  if (url.length > GOOGLE_WEB_MAX_URL) throw new GoogleWebError('TEXT_TOO_LONG');
  if (o.signal?.aborted) throw new GoogleWebError('CANCELLED');

  const f = o.fetchImpl ?? (fetch as unknown as WebFetch);
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, o.timeoutMs ?? 15_000);
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let res: WebFetchResponse;
    let body: string;
    try {
      res = await f(url, { method: 'GET', signal: ctl.signal, credentials: 'omit' });
      body = await res.text();
    } catch {
      // never echo the error: its message can contain the URL (= the user's text)
      throw new GoogleWebError(timedOut ? 'TIMEOUT' : o.signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR');
    }
    const err = classifyHttp(res.status, res.url, body);
    if (err) throw err;
    return parseTranslation(body, text);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

export interface GateOptions {
  /** minimum time between the START of two requests (ms) */
  minIntervalMs?: number;
  /** how long nothing is sent after RATE_LIMITED / ACCESS_BLOCKED / CAPTCHA_REQUIRED (ms) */
  cooldownMs?: number;
  /** transient network errors are retried this many times (default 1), with a pause; blocks are never retried */
  maxNetworkRetries?: number;
  retryPauseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** survives a suspended service worker / app restart */
  store?: { get(): Promise<number | undefined>; set(until: number): Promise<void> };
}

/** Serialises requests (one at a time), spaces them, retries transient errors only, and enforces the cooldown after a block. */
export class GoogleWebGate {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private until = 0;
  private loaded = false;
  private o: Required<Omit<GateOptions, 'store'>> & Pick<GateOptions, 'store'>;

  constructor(o: GateOptions = {}) {
    this.o = {
      minIntervalMs: o.minIntervalMs ?? 1200,
      cooldownMs: o.cooldownMs ?? 15 * 60_000,
      maxNetworkRetries: o.maxNetworkRetries ?? 1,
      retryPauseMs: o.retryPauseMs ?? 2000,
      now: o.now ?? Date.now,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      store: o.store,
    };
  }

  /** ms left of the cooldown (0 = free) */
  async cooldownLeft(): Promise<number> {
    if (!this.loaded) {
      this.loaded = true;
      this.until = Math.max(this.until, (await this.o.store?.get().catch(() => undefined)) ?? 0);
    }
    return Math.max(0, this.until - this.o.now());
  }

  run(text: string, pair: string, o: WebTranslateOptions = {}): Promise<string> {
    const next = this.chain.then(() => this.one(text, pair, o));
    this.chain = next.catch(() => {});
    return next;
  }

  private async one(text: string, pair: string, o: WebTranslateOptions): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      if (o.signal?.aborted) throw new GoogleWebError('CANCELLED');
      // during the cooldown NOTHING is sent
      if ((await this.cooldownLeft()) > 0) throw new GoogleWebError('ACCESS_BLOCKED', { cooldownUntil: this.until });
      const wait = this.lastStart + this.o.minIntervalMs - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      if (o.signal?.aborted) throw new GoogleWebError('CANCELLED');
      this.lastStart = this.o.now();
      try {
        return await googleWebTranslate(text, pair, o);
      } catch (e) {
        const err = e instanceof GoogleWebError ? e : new GoogleWebError('NETWORK_ERROR');
        if (err.blocking) {
          this.until = this.o.now() + this.o.cooldownMs;
          err.extra.cooldownUntil = this.until;
          await this.o.store?.set(this.until).catch(() => {});
          throw err;
        }
        if (err.retryable && attempt < this.o.maxNetworkRetries) {
          await this.o.sleep(this.o.retryPauseMs);
          continue;
        }
        throw err;
      }
    }
  }
}
