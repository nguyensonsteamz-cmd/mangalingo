# Long-text chunking + monthly usage – audit and plan (written before the changes)

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


## Audit of what exists (all three builds share one codebase)
| Area | Today |
|---|---|
| Translation entry | `machineTranslate(text)` in `src/translation/chrome-mt.ts` – the ONE path used by the sentence translation block, single words, vocabulary rows and the Web Reader. It routes to Google (through the router message `usage:translate`) or to the device translator (Chrome Translator API / Apple Translation / ML Kit via the `Translator` shim). |
| **Silent truncation** | `machineTranslate` does `prepareForMt(text).slice(0, 4000)`: longer text is **silently cut**. No chunking, no progress, no cancel, no per-chunk retry. |
| Providers | `google` (BYOK key; Cloud Translation Basic v2) and `device`. There is **no LingoLens-provided / shared key** and no backend. |
| Usage | `src/modules/usage` (meter, quota, consent, limits, cache). Counts characters **when a request is admitted (before sending) and keeps them on failure**; one counter per month; month boundary in **local** time; thresholds 80/95/100; one ledger (no provider / credential separation); no idempotency keys. |
| UI | `UsageSection` (Settings → Hạn mức dịch), `UsageNotice`/`UsageConsent`, `MachineTranslation` block. Shared React UI for Chrome / iPhone / Android. |
| Reusable | the usage service + lock, cache, router messages, React design system, Reader bridge, tests. |

## Provider limits (verified in the official docs while preparing this plan)
* **Cloud Translation Basic (v2)** – recommended ≤ **5,000 characters (code points) per request**; hard limit **100K bytes** per request; 6,000,000 chars/min per project; 300,000 requests/min.
* **Cloud Translation Advanced (v3)** – up to **30,000 code points** per request (not used: needs IAM, see Smart Setup).
* **Chrome Translator API** – **no documented maximum input length**; the docs advise chunking / streaming for long text.
* Apple Translation / ML Kit – no published per-call limit; conservative chunk size used (configurable).

## Decisions
1. **New module `src/modules/translation/`** – `chunker.ts` (lossless, boundary-aware splitting), `providers.ts` (limits per provider), `ChunkedTranslator.ts` (sequential / controlled concurrency, per-chunk retry with backoff + Retry-After, cancel, progress, ordered merge, retry-failed-only).
2. **No second translation engine**: `machineTranslate` becomes a thin wrapper over the chunked runner; the provider call stays the existing router message / device translator.
3. **Usage accounting changes** (spec): count **source characters of successfully processed chunks only**, exactly once, via **idempotency keys**; a request is *reserved* while in flight (so concurrent chunks cannot overshoot the quota) and the reservation is **released on failure / cancel** (nothing is counted). Separate ledgers per provider **and credential** (project id for Smart Setup keys). Month boundary **00:00 UTC**. Thresholds **80 / 90 / 100 %**. History kept; migration of the old state.
4. **Shared-key mode is not implemented**: the product is BYOK only (no shared key, no backend). Server-authoritative accounting would need a server; client counters are never presented as authoritative. Documented in `TRANSLATION_USAGE.md`.
5. **UI**: one compact `MonthlyUsageCard` (progress bar with threshold marks, remaining, %, operations, billing month, next UTC reset, cost estimate only for Google BYOK with a price) reused on Chrome, iPhone and Android; progress / cancel / retry-failed UI in the translation block.
6. Tests for every item in the brief; documentation: `TRANSLATION_USAGE.md`, `TRANSLATION_CHUNKING.md`, `TRANSLATION_PROVIDER_LIMITS.md`, `TRANSLATION_TEST_REPORT.md`.
7. No commit / push / deploy.
