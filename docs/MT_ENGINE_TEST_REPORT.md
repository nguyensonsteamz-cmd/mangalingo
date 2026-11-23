# MT engine – test report

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


Everything below was run on this Windows machine on 2026-11-16. "Real Chrome" = headless Chrome driven through the DevTools Protocol with the built extension loaded. **No real iPhone or Android device was used, no iOS simulator, no macOS.**

## Before → after
| Suite | Before the MT work | After | Command |
|---|---|---|---|
| Unit tests | 341 passed (20 files) | **392 passed (23 files)** | `npx vitest run` |
| TypeScript | clean | clean | `npx tsc --noEmit` |
| Chrome end-to-end (real Chrome, extension loaded) | 44 / 44 | **45 / 45** (+1 step: Settings → local-model card) | `node scripts/e2e.mjs` |
| Web Reader script | 18 / 18 | 18 / 18 | `node scripts/reader-test.mjs` |
| Local model in the **extension** (real Chrome, offscreen document + Worker + WASM; incl. SHA-256 verify, damaged-file repair, cancel) | – | **11 / 11** | `node scripts/mt-local-e2e.mjs` |
| **Real Android app in the emulator** (ML Kit en→vi / vi→en, OPUS-MT in the real WebView, lifecycle, memory) | – | **15 / 15** | `node scripts/android-emulator-test.mjs` |
| Local model in the **phone web bundle** (served over http, desktop headless Chrome, in-page router + Worker) | – | **6 / 6** | `node scripts/mt-local-mobile-test.mjs` |
| Android build | builds | **debug APK 100.3 MB, release APK (unsigned) 96.6 MB, AAB 42.5 MB** | `gradlew assembleDebug assembleRelease bundleRelease` |
| iPhone | not built | **not built** (no macOS); web bundle rebuilt; Swift changed but **not compiled** | – |
The 51 new unit tests: `mt-registry` 11, `mt-local` 22 (incl. the Google v2 request contract), `mt-lifecycle` 10, `mt-ui` 3, `machine-translation` +2, `translation-usage` +3.

## What the new tests prove
| Area | Tests |
|---|---|
| Registry | discovery per pair / platform; auto = local only, never cloud; explicit choice is exact (no silent switch); unsupported pair rejected before anything is sent; cloud → local fallback only, **local never falls back to cloud**; blocked / fatal / aborted errors are not retried elsewhere; timeout; abort; response names provider + pair |
| Local provider | needs-download before any translation, nothing downloaded by itself; progress; unsupported pair / runtime; sentence splitting ≤ 900 chars, lossless, paragraph breaks kept; each direction uses its own checkpoint; symbol-only segments are not sent to the model; cancel between sentences; model errors surface |
| Long text with the local model | chunks ≤ `device-local` limit, ordered, lossless, informational ledger (`device-local`, never Google); **cancel keeps finished chunks, resume sends only the unfinished chunks** (counted exactly) |
| Google BYOK vi→en | request direction; unsupported pair rejected; **cache is per direction**; SOURCE characters counted once, same monthly ledger; retry with the same idempotency key counted once |
| Router | `mtlocal:*` start / status / translate / remove; no host → "not available" without crash; unknown model id rejected |
| UI (jsdom) | model offered **with its size**, nothing downloaded until the click, then translation + provider name shown; already-downloaded model translates without a prompt; English text with no translator never goes to the cloud |
| Chrome Translator | vi→en with its own translator instance; same text in the two directions does not share a cache entry; provider label |
| Regression (the 341 earlier tests) | all still pass: chunking, usage (UTC month, idempotency, quota), Smart Setup, billing gate, glass-off, OCR, dictionary, reader bridge … |

## Real-Chrome local-model run (`mt-local-e2e.mjs`)
* model absent before the user agrees → explicit download with progress → `cached = true`;
* en→vi sentence translated (≈ 0.35 s warm); vi→en downloaded and translated;
* deterministic (same text twice → same output);
* **the page stays responsive** while translating a 9-sentence text: longest event-loop gap 71–73 ms (the work happens in the Worker);
* `release` frees the worker, the model stays cached on disk and translates again.
The same flow passes in the phone bundle (`mt-local-mobile-test.mjs`): download in the page's Worker, en→vi, vi→en, responsive (max gap 72–74 ms), remove.

## Android emulator (Android 15, x86_64, 3 GB RAM) — what ran
ML Kit: model availability → download → translation both ways; both directions give different, correct-language output; unknown pair rejected. OPUS-MT in the real WebView: not present before consent; download + en→vi + vi→en; warm sentence ≈ 0.75–0.93 s; app + renderer PSS ≈ 1.0 GB with both models (248 MB before); UI thread max gap 94 ms; SHA-256 verify ok; cancel halfway → idle, nothing cached, re-download ok; damaged file → detected, model removed, re-download repairs; Home → return: still translates; force-stop → restart: model still cached. Emulator numbers are **not phone numbers**.

## Google Cloud Translation
Contract tests only (mock transport): official v2 endpoint, POST JSON, key only in the query string, `format: text`, directions en→vi and vi→en, unsupported pair rejected, key never in an error (network, HTTP 403 that echoes it, malformed body), 429 / 5xx / 4xx codes mapped. **No live call was made**: no API key / billing is configured on this machine and none was created.

## Bugs found while integrating (all fixed, re-tested)
1. The first registry version raised `needs-download` for the **platform** translator when it was `downloadable`, which broke Chrome's own "download inside a user gesture" flow (caught by the existing `machine-translation` test). Now only a model *we* download needs the explicit consent step.
2. An explicitly chosen provider that reported `unavailable` was still invoked; now it fails with the reason (`unavailable`) and is never called.
3. Translation cache and in-flight keys ignored the direction: the same text in vi→en could have been answered with the en→vi result. Keys now include the pair (en→vi keys unchanged, so existing cache entries stay valid).
4. Benchmark: the first M2M-100 vi→en run was contaminated by other CPU-heavy work (avg latency 33.9 s) and was re-run alone (avg 2.6 s).
5. `scripts/mt-local-mobile-test.mjs`: the test web server wrote headers before reading the file (crash on a 404).
6. Model lifecycle gaps found in review and fixed: no integrity check, no cancel, no free-space check, stale revisions kept, a damaged cached file looped on load errors (now verified against SHA-256 before deleting; an intact file that fails to load — e.g. out of memory — is kept).

## Not verified / limits (read these)
* **iPhone — BLOCKED**: `Translator.swift` / `WebContainer.swift` (vi→en queue + session) were **never compiled** (no macOS; CI needs a push, which is not allowed). The downloaded model is **not offered** on iPhone (custom `app://` scheme: Cache API / module Workers not verified; there is no way to test WKWebView here). Apple Translation (en→vi, vi→en), the iOS scan flow and iOS usage tracking were **not run**.
* **Android**: verified only in an x86_64 emulator, not on a physical ARM phone; release APK / AAB are unsigned. The 0.6 GB figure of the benchmark is onnxruntime-node on a laptop; the emulator WebView measured ≈ 1.0 GB.
* **Not tested**: low-storage behaviour on a real device (unit test only), offline download on a device, pause / resume of a download (not implemented).
* **Quality numbers** are chrF++ / BLEU re-implementations (not sacreBLEU), a LaBSE adequacy proxy (not COMET) and have **no human fluency evaluation**; the category and long-text references were written by the assistant and are unverified. The IWSLT sample may overlap training data of some models.
* **Google BYOK** was tested only with a fake server; no real Google Cloud call, no real billing.
* WASM-runtime latency was **not benchmarked** (only functional + responsiveness checks).
* The benchmark ran once per configuration (no repeated-run variance).
* No commit, no push, no deployment.
