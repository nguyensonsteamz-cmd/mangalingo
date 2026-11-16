# Deployment of the MT engine — per platform

Status words: **COMPLETE** implemented and verified here · **PARTIAL** implemented, not fully verified · **BLOCKED** cannot be done / verified in this environment · **NOT IMPLEMENTED**.

## What ships
* The ONNX Runtime Web **runtime** (`ort-wasm-simd-threaded.{mjs,wasm}`, 11 MB, single-thread, no WebGPU) is bundled in every build (`dist/vendor/ort/`, `…/web/vendor/ort/`). No remote code is ever executed.
* The **model is not bundled**. It is downloaded on demand from Hugging Face after the user presses a button that shows the size (≈ 102 MB per direction). Checkpoints are pinned by commit hash in `src/modules/mt/local/models.ts`.
* `onnxruntime-web` is aliased to its WASM-only build (`scripts/vite-shared.mjs`), so the 21 MB WebGPU wasm is not needed.

## Chrome extension — COMPLETE (verified in real Chrome)
* The model runs in the existing **offscreen document** (the service worker cannot run ONNX Runtime Web) inside a module Worker; the background forwards `mtlocal:*` messages (`callOffscreen`).
* Manifest: no new permission (`offscreen`, `<all_urls>` and `wasm-unsafe-eval` already existed). Extension size is now 47.5 MB; the runtime adds ≈ 11.5 MB (ort wasm 10.9 MB + worker 0.5 MB).
* Chrome Translator and Google BYOK are untouched; the local model is used when (a) the user prefers it, or (b) the platform translator cannot do the pair and the user already downloaded the model.
* Verified: `scripts/mt-local-e2e.mjs` (8 steps) and the 45-step `scripts/e2e.mjs`.

## Android — VERIFIED IN THE EMULATOR (no physical phone)
Tested on the Android 15 x86_64 emulator (`ml35`, 3 GB RAM, Google APIs image) with the debug APK, driving the real app's WebView through its DevTools socket (`scripts/android-emulator-test.mjs`, **15/15**). The debug build enables WebView remote debugging only when the app is `debuggable` (never in the release build).
* **ML Kit**: both directions (one `Translator` per pair, `MainActivity.mt(id, "op:pair", text)`). Verified in the emulator: availability → model download → en→vi ("Ga tàu gần nhất ở đâu?") and vi→en, both directions side by side, unknown pair rejected without a crash. Builds: debug APK 100.3 MB, release APK (unsigned) 96.6 MB, AAB 42.5 MB.
* **Local model (OPUS-MT) in the real Android WebView (emulator)**: download inside the page's Worker, en→vi, vi→en, SHA-256 verification, cancel + restart, damaged-file detection + repair, background → foreground, app restart (files persist, no re-download), UI thread responsive (max gap 94 ms). Memory with both models loaded: **≈ 1.0 GB** (app process + WebView renderer PSS; 248 MB before the models) on a 3 GB emulator. **Emulator ≠ phone**: x86_64 CPU, host-dependent speed (a 6-sentence text took ≈ 33–42 s while a single warm sentence took ≈ 0.75–0.93 s). A real mid-range ARM phone may differ in both directions; the ≈ 1 GB figure is the number to compare with a device's RAM.
* No change to APK size beyond the runtime; the model is not in the APK.

## iPhone — PARTIAL (nothing was compiled or run on iOS)
* **Apple Translation**: en→vi unchanged. vi→en added in `Translator.swift` (a second `TranslationQueue` + hidden `TranslationBridge` session, bridge commands accept `"pair": "vi>en"`). **BLOCKED: this Swift code was NOT compiled** (no macOS / Xcode here; the only runner is the GitHub Actions macOS job, which needs a push — not allowed). It was reviewed line by line instead (all call sites of the renamed `status`, the `State(initialValue:)` init, the two bridges). The CI workflow now also runs `npm run typecheck` before the unit tests; the next CI run is the first real compile + `xcodebuild` + executable check. The iPhone web bundle was rebuilt, no IPA was built.
* **Downloaded model: not offered on iPhone.** The app page runs from the custom scheme `app://local/…` where the Cache API and module Workers are not guaranteed, so the model could not be kept between launches or may not start. It needs a real-device test before enabling (`LocalModelProvider.capabilities.platforms` excludes `ios`; the Settings card is hidden).
* **Core ML** — NOT IMPLEMENTED: converting OPUS-MT needs `coremltools` (Python), which cannot run here (Windows Application Control blocks unsigned native Python extensions) and Core ML cannot be built without macOS.
* The scan screen still translates the speech bubbles with Apple's **batch** request (one session, one model load for all bubbles). It was deliberately **not** moved onto the chunk runner: bubbles are far below any limit, and per-chunk requests would be slower. A bubble above 4,800 characters is not realistic OCR output.
* To enable it later: `BundleSchemeHandler` (WebContainer.swift) takes MIME types from `UTType`, which may not know `.mjs` / `.wasm`; it needs explicit `text/javascript` / `application/wasm` entries. **Not changed**, because the model is not offered on iOS yet.

## Model lifecycle (hardening)
| Case | Behaviour | Verified |
|---|---|---|
| Download | only after a click that shows the size; one download per model at a time (a second call joins the first) | unit + Chrome + Android |
| Free space | refuses to start when free storage < 2× the download (no partial data) | unit |
| Offline | friendly error ("cần kết nối mạng một lần"); a downloaded model keeps working offline (local files) | unit (error); offline translation by design — not separately emulated |
| Integrity | SHA-256 + size of every file checked right after download and on demand (`mtlocal:verify`); a mismatch deletes the files | unit + Chrome + Android |
| Cancel | stops the download, nothing kept, can restart | unit + Chrome + Android |
| Damaged cached file | detected → deleted → "download again"; re-download repairs | Chrome + Android |
| Load failure with intact files (e.g. out of memory) | files kept (no forced 100 MB re-download) | unit |
| Versioning | revisions pinned by commit hash; files of an older pinned revision are deleted when the new one downloads | unit |
| Removal | Settings → Gỡ; the worker is released first; a model in use is only removed by the user's click | unit + Chrome |
| Pause / resume | **not implemented** (cancel + restart) | – |

## Install / enable
1. Build: `npm run build` (extension), `npm run build:mobile` (Android assets), `npm run build:ios-web` (iPhone web bundle).
2. Settings → Hạn mức dịch → *Mô hình dịch tải về*: choose a direction, press **Tải về**; optionally switch on *Ưu tiên dùng mô hình này* (off by default).
3. To remove: **Gỡ** (deletes the cached files; the worker is released).

## Rollback
Nothing replaced an existing provider. To remove the feature entirely: delete `src/modules/mt/local`, the `mtlocal:*` messages, the Settings card and the two `vendor/ort` copy steps; the registry keeps working with the native + Google providers.

## Release builds
Chrome: `npm run build` → `dist/` (47.5 MB). Android: unsigned release APK and AAB build (`gradlew assembleRelease bundleRelease`); **not signed** (no keystore was created or faked). iPhone: only via the CI workflow (below). Versions: `package.json` 0.1.0 = Gradle `versionName` 0.1.0 (unchanged).

## Not done
No deployment, no commit, no push, no store release. The model host (Hugging Face) is a third party: if the files move or the service is unreachable the download fails with a visible error and nothing else is affected.
