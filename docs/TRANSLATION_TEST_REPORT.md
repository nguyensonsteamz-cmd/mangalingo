# Long-text chunking + monthly usage – test report

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


What ran (all automated, on this machine):

| Suite | Count | Result |
|---|---|---|
| `tests/chunking.test.ts` | 25 | pass |
| `tests/translation-usage.test.ts` | 32 | pass |
| `tests/usage.test.ts` (rules updated to the new spec) | 45 | pass |
| `tests/lookup-fulltext.test.ts` | 3 | pass |
| whole unit suite (`npm test`) | 341 | pass |
| Chrome end-to-end (`scripts/e2e.mjs`) | 44 | pass |
| Web Reader script (`scripts/reader-test.mjs`) | 18 | pass (a flaky width check was fixed: it measured during the popup's 160 ms entry animation) |
| Android build (`gradlew`) | – | builds |
| UI run on the phone bundle with a fake Google (`.tmp/longtext-demo.mjs`, screenshots `demo-anh/80…84`) | 44,123-character text, 10 chunks | progress 4/10 → cancel → resume sends only the rest → 1 operation; one chunk forced to fail → partial → retry → counted once |

## Coverage of the brief
| Requirement | Evidence |
|---|---|
| Splitting at sentence boundaries; paragraph preference | `chunking.test.ts` |
| Very long input (400,000 chars) | split in < 3 s, lossless |
| Unicode / Vietnamese (NFC and NFD), emoji ZWJ | never cut inside a letter / sequence; counted per code point |
| Whitespace / punctuation counting | `translation-usage.test.ts` ("Hello, world!" = 13) |
| Lossless, ordered | round-trip incl. 60 random inputs; out-of-order completion keeps order |
| Partial failures, retries, backoff, Retry-After | per-chunk, same idempotency key; fatal vs retryable |
| Cancellation | before start, in flight, during retry wait; finished chunks kept |
| Duplicate prevention | identical concurrent requests → 1 call; same idempotency key counted once even without cache |
| Retry never double counts | flaky chunk succeeding on try 3 counted once; "retry failed" total = sum of chunks |
| Failed requests not counted | failure → 0 characters, reservation released |
| Concurrency | 30 simultaneous requests cannot overshoot the quota; mixed success / failure total = sum of successes |
| Providers / credentials separate | device ledger vs Google ledger; project A vs B; same project keeps the ledger |
| Monthly rollover (UTC) | exact instant 00:00:00Z; time-zone independence; December → January; history kept; v1 migration |
| Warning thresholds | 79 / 80 / 89 / 90 / 99 / 100 % |
| Shared key vs BYOK | **BYOK only** (see below) |

## Not done / not verified
* **Shared-key mode**: not implemented. LingoLens has no shared key and no backend; server-authoritative accounting is impossible without one. Documented in `TRANSLATION_USAGE.md`.
* **Real Google, real devices**: all provider calls in tests are fakes; nothing was run against Google Cloud, on an iPhone or on an Android phone. iPhone: the shared JS is what changed here; no new Swift.
* **Local model chunking by tokens**: no local model is integrated (see the MT engine task).
* The iOS scan screen translates speech bubbles with Apple's batch API (each bubble far below 4,500 characters); it was not moved onto the chunked runner.
