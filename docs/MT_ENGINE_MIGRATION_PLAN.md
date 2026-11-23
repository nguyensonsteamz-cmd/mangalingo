# MT engine migration plan (executed)

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


This was first written as a plan that stopped at "no benchmark evidence". It has since been executed; this file now records the plan **and its status**.

| # | Step | Status |
|---|---|---|
| 1 | Audit the repository and documents (`MT_ENGINE_AUDIT.md`) | **COMPLETE** |
| 2 | Check the environment: no Python (Windows Application Control blocks unsigned native Python extensions), Node + onnxruntime works, ≈ 237 GB free on D:, no phone available | **COMPLETE** (limits recorded) |
| 3 | Research candidates and licences from the model cards | **COMPLETE** (`MT_ENGINE_MODEL_SELECTION.md`) |
| 4 | Build the Benchmark Lab (`benchmarks/mt`: data prep, runners, metrics, adequacy proxy, scoring, selection, report) | **COMPLETE** |
| 5 | Run the benchmark | **PARTIAL**: OPUS-MT, M2M-100 418M, EnViT5 (reference) and the Chrome Translator baseline measured on the dev machine; MADLAD-400 3B and M2M-100 1.2B **BLOCKED**; no COMET, no human evaluation, no phone |
| 6 | Select the model | **COMPLETE**: OPUS-MT q8 as an optional local provider; Chrome Translator stays the default |
| 7 | Unified provider interface + registry (`src/modules/mt`) | **COMPLETE** (unit-tested) |
| 8 | Adapters for Chrome Translator / Apple / ML Kit / Google BYOK (wrapping the existing code) | **COMPLETE** for Chrome; Android builds; Apple Swift **uncompiled** |
| 9 | Local model provider (worker, host, offscreen / in-page, download with consent, remove, verify, cancel, repair) | **COMPLETE** in Chrome; **VERIFIED IN THE EMULATOR** on Android (no physical phone); **NOT OFFERED** on iPhone |
| 10 | VI→EN | **COMPLETE** in Chrome (Translator API + local model + Google contract); **verified in the Android emulator** (ML Kit + local model); Apple: Swift written, **BLOCKED** (not compiled) |
| 11 | Chunking / resume / retry / usage integration (`device-local` limits, per-direction cache, idempotency) | **COMPLETE** (tests) |
| 12 | UI: provider label, direction, "download the model (size)" prompt, Settings card | **COMPLETE** (Chrome e2e); phone UI by shared code |
| 13 | iOS scan screen onto the chunk runner | **NOT DONE by design** (Apple batch API kept; see deployment) |
| 14 | Regression + new tests, builds | see `MT_ENGINE_TEST_REPORT.md` |
| 15 | Documentation | this set of documents |

## Constraints respected
No commit, no push, no deployment; no provider default changed (`mt.prefs.preferred` defaults to `auto`); Google / BYOK, Chrome Translator, Apple Translation, ML Kit all kept; no backend and no shared key; usage history untouched; the model is downloaded only after an explicit click; no silent cloud fallback.

## What the plan could not do (and why)
* **COMET, sacreBLEU, PyTorch, CTranslate2, coremltools**: need native Python extensions, blocked by the machine's Application Control policy (not bypassed).
* **Real-device numbers (iPhone, Android)**: no devices. Phone memory / latency of the WASM runtime are unknown.
* **Core ML**: needs coremltools and macOS.
* **Human evaluation of fluency / the unverified category set**: no native-speaker reviewer.
