# Provider limits used by the chunker

Verified in the official documentation while preparing the long-text work (docs.cloud.google.com/translate/quotas, developer.chrome.com/docs/ai/translator-api).

| Provider | Documented limit | Used by LingoLens |
|---|---|---|
| **Cloud Translation Basic (v2)** – BYOK | Recommended **≤ 5,000 characters (code points)** per request; hard limit **100K bytes** per request (over it: `400 INVALID_ARGUMENT`); 6,000,000 characters / minute per project; 300,000 requests / minute; daily quota unlimited by default | target **4,800**, max **5,000** code points, byte ceiling 90,000; 2 concurrent requests |
| Cloud Translation Advanced (v3) | up to **30,000 code points** per request | not used (needs IAM, see Smart Setup) |
| **Chrome Translator API** (on device) | **no documented maximum** input length; docs advise chunking / streaming for long text and note long inputs queue later calls | target 4,500, max 5,000; 1 request at a time |
| Apple Translation (on device) | no published per-call limit | target 4,500, max 5,000 (conservative); 1 at a time |
| ML Kit Translate (on device) | no published per-call limit | target 4,500, max 5,000 (conservative); 1 at a time |

All limits are defaults in `src/modules/translation/providers.ts` and can be overridden per job (`limits`). The device sizes are **conservative choices, not documented limits**: if a provider is found to need smaller chunks, change the value there.

## Rate limits
Google's 6M characters / minute per project is far above what one user generates; 429 answers are still handled (retry with backoff, `Retry-After`).

## Not done / open
* A multi-segment request (several `q` values per call) is not used; one chunk = one request.
* Tokenizer-based limits (for a future local model) are not implemented: no local model is integrated yet.
