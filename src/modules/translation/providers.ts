/**
 * Per-provider request limits. The chunk size follows the REAL limit of each provider (they differ):
 *  - Cloud Translation Basic (v2): recommended ≤ 5,000 code points per request; hard limit 100K BYTES per request;
 *    6,000,000 characters / minute per project; 300,000 requests / minute  (docs.cloud.google.com/translate/quotas)
 *  - Cloud Translation Advanced (v3): up to 30,000 code points per request (needs IAM, not used by LingoLens)
 *  - Chrome Translator API: no documented maximum input length (the docs advise chunking / streaming)
 *  - Apple Translation / ML Kit: no published per-call limit → conservative size
 * Every value is configurable through the options of the runner; these are the defaults.
 */
export type ProviderId = 'google-v2' | 'google-web' | 'device-chrome' | 'device-apple' | 'device-mlkit' | 'device-local' | 'device';

export interface ProviderLimits {
  /** preferred chunk size (code points) */
  targetChars: number;
  /** never exceed (code points) */
  maxChars: number;
  /** hard request-size limit in UTF-8 bytes (a chunk is re-split when it would exceed it) */
  maxBytes: number;
  /** parallel requests (the quota guard still reserves / enforces the limit) */
  concurrency: number;
  /** is usage metered against a monthly quota? */
  metered: boolean;
  label: string;
}

export const PROVIDER_LIMITS: Record<ProviderId, ProviderLimits> = {
  'google-v2': { targetChars: 4800, maxChars: 5000, maxBytes: 90_000, concurrency: 2, metered: true, label: 'Google Cloud Translation (BYOK)' },
  // Google Translate web (unofficial, GET: the text travels in the URL): small chunks, ONE request at a time, never billed; there is NO documented quota
  'google-web': { targetChars: 1200, maxChars: 1500, maxBytes: 3000, concurrency: 1, metered: false, label: 'Google Dịch (web, không chính thức)' },
  'device-chrome': { targetChars: 4500, maxChars: 5000, maxBytes: 200_000, concurrency: 1, metered: false, label: 'Chrome Translator (trên thiết bị)' },
  'device-apple': { targetChars: 4500, maxChars: 5000, maxBytes: 200_000, concurrency: 1, metered: false, label: 'Apple Translation (trên thiết bị)' },
  'device-mlkit': { targetChars: 4500, maxChars: 5000, maxBytes: 200_000, concurrency: 1, metered: false, label: 'ML Kit (trên thiết bị)' },
  // downloaded OPUS-MT model: 512-token window, ~145 characters / second on a laptop CPU → small chunks so progress / cancel stay responsive
  'device-local': { targetChars: 1500, maxChars: 1800, maxBytes: 200_000, concurrency: 1, metered: false, label: 'Mô hình dịch tải về (OPUS-MT)' },
  device: { targetChars: 4500, maxChars: 5000, maxBytes: 200_000, concurrency: 1, metered: false, label: 'Dịch máy trên thiết bị' },
};

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
