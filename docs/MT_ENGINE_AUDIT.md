# MT engine audit

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


> Part 1 (§1–§5) is the audit of the code **before** the migration (written first, no production change). Part 2 (§6) records what changed. The benchmark evidence that was missing at the first audit now exists: `TRANSLATION_BENCHMARK_LAB.md`.

## 1. What the "machine translation engine" is today
There is **no bundled neural translation model**. "Machine translation" is delegated to what each platform provides, plus one optional cloud provider:

| Provider | Where | Used how |
|---|---|---|
| Chrome built-in `Translator` API (en→vi) | `src/translation/chrome-mt.ts` (`getTranslator`, `mtAvailability`) | extension; model downloaded once by Chrome |
| Apple Translation (iOS 18+) | `ios/MangaLingo/Translator.swift`, bridge commands `translate`, `translateBatch`, `mtStatus`, `mtPrepare`; exposed to JS as a `Translator` shim (`src/mobile/ios.ts: installTranslatorShim`) | iPhone app |
| ML Kit Translate (en→vi) | `android/.../MainActivity.kt` (`mt` bridge), JS shim `src/mobile/native.ts: installAndroidTranslatorShim` | Android app |
| Google Cloud Translation Basic v2, **BYOK** | `src/modules/usage/google.ts`, router message `usage:translate`; key in secure storage (Smart Setup / manual) | all three, optional |
| Dictionary gloss ("ghép nghĩa") | `src/translation/dictionary-translator.ts` | not MT: a word-by-word dictionary view; used for analysis |

Language pair is **fixed English → Vietnamese** (`PAIR = { en, vi }` in `chrome-mt.ts`; the device translators are created for that pair only). **Vietnamese → English machine translation does not exist** in any provider path. `settings.reading.targetLanguage = 'en'` only switches the dictionary view to English definitions.

## 2. How a translation request moves
```
UI (MachineTranslation block, useMt, Web Reader bridge, OcrMeaning, Scan screen)
  → machineTranslate / machineTranslateLong            src/translation/chrome-mt.ts
      → translateLongText (chunk → retry → merge)       src/translation/long-text.ts + src/modules/translation/
          → provider function:
              Google  : send({type:'usage:translate'}) → router → UsageService → CostProtectionService → googleTranslate()
              device  : getTranslator().translate()     (Chrome Translator API, or the iOS / Android shim → native)
          → usage accounting (router: usage:operation / usage:device-processed)
```
Exception: the iPhone scan screen translates all speech bubbles with `translateBatch` (Apple Translation batch) directly (`src/mobile/Scan.tsx`), not through the chunked runner.

## 3. Cross-cutting pieces
| Concern | Where | Notes |
|---|---|---|
| Language detection | `src/language/detect.ts` | decides "English-like" for look-ups; no vi→en MT path |
| Pre-processing | `prepareForMt`, `prepareLong` (hyphenated words), `normalizeText` / `normalizeChunk` (usage module) | |
| Chunking, retry, cancel, progress, ordered merge | `src/modules/translation/` | provider-specific limits in `providers.ts`; idempotency keys; partial retry |
| Result normalisation | providers return plain text; the UI (`MachineTranslation`) shows it, partial results flagged | |
| Errors | `TranslationError` flags (retryable / fatal), `classifyError`, `UsageBlockedError`, `PartialTranslationError` | |
| Usage | `src/modules/usage/` | ledgers per provider + credential, UTC month, successes only, idempotency; on-device providers recorded in an informational ledger |
| Credentials | `SecretStore` (WebCrypto non-extractable / Keychain / Keystore); Smart Setup | |
| Settings | `translation mode: machine | dictionary` (`reading.translationMode`), usage settings `provider: device | google` | no generic provider registry yet |

## 4. Shared code across the three builds
One React / TypeScript codebase: the extension (service worker `src/background`, content script, side panel, options) and the phone apps (`src/mobile`, in WKWebView / Android WebView) share `src/modules/*`, `src/translation/*`, `src/ui/*`, `src/options/*`. Native differences are limited to bridges (Swift `WebContainer.swift`, Kotlin `MainActivity.Bridge`) and the on-device translators above.

## 5. Gaps relevant to adding an open-source model
1. **No provider abstraction**: providers are two hard-wired branches in `long-text.ts` (`googleActive()` ? Google : device). A registry + normalised interface is needed (plan: `MT_ENGINE_MIGRATION_PLAN.md`).
2. **Only en→vi.** A model that is evaluated for vi→en needs a new pair in the provider layer, the language-pair selector (none exists) and the UI would have to expose it — which this task forbids changing; so vi→en could only be used where an existing workflow already asks for it (none today).
3. **No tokenizer / model runtime** in the project; the extension CSP already allows `wasm-unsafe-eval`; no ONNX / CTranslate2 / Core ML dependency exists.
4. Extension **storage and memory** for a model (IndexedDB / OPFS quota, service-worker lifetime → an offscreen document would host inference).
5. Phone apps: **bundle size** (the IPA is ≈ 14 MB, the APK ≈ 97 MB because of ML Kit) and memory / thermal limits.

## 6. After the migration (what changed in the code)
| Before | After |
|---|---|
| two hard-wired branches in `long-text.ts` (`googleActive() ? Google : device`) | on-device choice goes through `ProviderRegistry` (`resolveDevice`); Google keeps its quota-guarded path |
| EN→VI only (`PAIR` constant, one Translator singleton) | per-pair translators; **VI→EN** for Chrome Translator, ML Kit, Apple Translation (Swift, uncompiled) and Google BYOK |
| no local model | optional **OPUS-MT q8** (Apache-2.0) downloaded on demand, ONNX Runtime Web in a Worker (offscreen document in the extension) |
| cache keyed by text only | cache / in-flight keys include the direction (en→vi keys unchanged) |
| translation block did not say who translated | shows the provider (and "Việt → Anh") |
| chunk limits: Google, 3 device ids | + `device-local` (1,500 / 1,800 characters; the model itself takes ≤ 900 per call) |

Nothing was removed: Chrome Translator, Apple Translation, ML Kit, Google BYOK, the usage manager, chunking / resume / retry are all still in place and covered by the existing tests (341 → 379 unit tests, see `MT_ENGINE_TEST_REPORT.md`).

## 7. Benchmark evidence
Built and run in this work (`benchmarks/mt/`, `TRANSLATION_BENCHMARK_LAB.md`); selection in `MT_ENGINE_MODEL_SELECTION.md`.
