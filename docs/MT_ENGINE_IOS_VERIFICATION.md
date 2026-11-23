# iOS verification

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


Legend: COMPILE VERIFIED = built by `xcodebuild` on a GitHub macOS runner · RUNTIME VERIFIED (SIMULATOR) = ran in the iOS Simulator on that runner · NOT RUN · BLOCKED. **No physical iPhone was available. Nothing below is "VERIFIED ON PHYSICAL DEVICE".**

| Item | State | Evidence |
|---|---|---|
| Swift: `Translator.swift` (vi→en queue + session), `WebContainer.swift` (pair routing, MIME types, probe), Setup/ (Keychain, Google OAuth) | **COMPILE VERIFIED** — Release, `-sdk iphoneos`, unsigned; **and** Debug, `-sdk iphonesimulator` | CI "iOS app (.ipa)" runs 43883208282 (first compile of the new Swift), 43890461052 (final): `** BUILD SUCCEEDED **` |
| An earlier push of mine broke the Swift (a shell escape ate backslashes in a string, then an interpolation) | caught by CI in 1 run, fixed, re-run green | runs 43886895123 (failed) → 43889720688 / 43890461052 (green) |
| TypeScript typecheck + 392 unit tests on macOS | **PASS** | same runs |
| IPA | built, **UNSIGNED**, 17.2 MB, executable `Payload/MangaLingo.app/MangaLingo` present (arm64, 1.28 MB), `web/vendor/ort/*` included; copied to `ios-build/LingoLens.ipa` | CI artifact `LingoLens-ipa` |
| Apple Translation en→vi / vi→en | **COMPILE VERIFIED only.** In the simulator `LanguageAvailability` answers `unsupported` for both pairs (Apple's Translation framework needs a device) → translation itself is **NOT RUN** | probe `apple-translation-status-*` |
| iOS scan flow, usage tracking on iOS | **NOT RUN** (needs OCR images + device); unchanged by design (Apple batch API) | – |
| **OPUS-MT in the iOS WebView on the `app://` scheme** (iOS 18.7 simulator, WKWebView) | **RUNTIME VERIFIED (SIMULATOR)**: secure context, Cache API, IndexedDB, WebCrypto, module Worker, WebAssembly all available; ORT WASM compiles; the pinned model downloads (≈ 4.8–6.5 s), loads, passes **SHA-256** on both files and translates ("Trạm xe lửa ở đâu?", 0.27–0.44 s); after **terminating and relaunching** the app the six cached files persist and the model reloads in 1.4 s without a download | CI job "iOS simulator runtime probe", run 43890461052 (`probe.log` artifact `ios-simulator-probe`) |
| Same on a physical iPhone (memory limits / jetsam of the WebContent process, thermal, background) | **NOT RUN / BLOCKED** (no device) | – |
| `.wasm` served as `application/octet-stream` by the old scheme handler | found by the probe; **fixed** (explicit `text/javascript` / `application/wasm`) | probe `mime` line, commit a32d92d |

## Decision on OPUS-MT for iPhone
Technically feasible in the simulator, but **not enabled in the app**: a real iPhone's WebContent process has a hard memory limit that was never measured (Android's WebView needed ≈ 1.0 GB with both models), and enabling it without a device test could kill the page. It stays off (`LocalModelProvider.capabilities.platforms` = chrome, android; the Settings card is hidden on iOS) so Apple Translation remains the only on-device provider there.
To enable after a device test: add `'ios'` to that list; run the probe on the phone (Safari Web Inspector → open `app://local/ios-probe.html` via the `-lingolensProbe` launch argument in Xcode, or reuse the CI log); check memory in Xcode's Memory gauge with both models loaded; make sure a jetsam kill reloads the page (`webViewWebContentProcessDidTerminate` already reloads).

## How to repeat
Push → workflow "iOS app (.ipa)" → jobs `build` (IPA) and `simulator-probe` (evidence). The probe is inert in normal runs (`-lingolensProbe` is only passed by CI).
