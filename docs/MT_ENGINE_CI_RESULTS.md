# CI results (GitHub Actions, repository nomaex-hash/mangalingo, branch master)

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


| Run | Commit | Workflow / job | Result |
|---|---|---|---|
| 43883206890 | ee70bfd | CI (extension + Android) | **PASS** — typecheck, 392 unit tests, `npm audit --omit=dev` = 0 vulnerabilities, extension build + bundle checks, Android debug / release (unsigned) / AAB, release has no remote-debugging flag |
| 43883208282 | ee70bfd | iOS app (.ipa) / build | **PASS** — typecheck, tests, web build, xcodegen, `xcodebuild` Release iphoneos `BUILD SUCCEEDED`, IPA packaged |
| 43884626922 / 43884627010 | 601e23c | CI / iOS (first probe job) | CI PASS; simulator probe **FAIL** — the probe page never loaded (my Swift string-interpolation escape was wrong, so the app opened `app://local/(page)`) |
| 43886895123 | 8da6551 | iOS app / build | **FAIL** — Swift syntax errors (backslashes lost in a string literal) — caught by `xcodebuild` |
| 43889720688 | 812d01e…0271f6d | iOS app | build **PASS**, simulator probe **PASS** (fix of the above) |
| 43890461052 | a32d92d | iOS app | build **PASS**, simulator probe **PASS** incl. SHA-256 verification and persistence after relaunch |
| 43893968854 | 12fdde1 | CI (extension + Android) | **PASS** (incl. the optional signing config; no keystore, so unsigned) |
| 43894092541 | 0a1a08c | CI (extension + Android) | **PASS** (docs; the iOS workflow is path-filtered and did not run — its last run is 43890461052, PASS) |

Honest note: two pushes to `master` contained my own Swift mistakes (runs above). The first only affected the probe job; `812d01e`/`8da6551` broke the iOS compile for ~one run; the literal-`(page)` bug affected the **app's start page** in those commits and was fixed in `0271f6d` before any IPA from those commits was built or used. No force push, no history rewrite.

## What CI does not cover (kept out on purpose)
Chrome end-to-end (needs a real Chrome with the Translator API model and network), the Android emulator suite, the Chrome local-model e2e — run locally (see test report). No live Google call (no secret was configured; the workflows use no secrets). No release / tag / publish.

## Native-dependency hardening on macOS
`@huggingface/transformers` (which pulls `onnxruntime-node` and `sharp`, with install scripts) was moved from `dependencies` to `devDependencies`: it is only bundled by Vite at build time; the shipped artifacts do not contain node modules. `npm audit --omit=dev` → 0 vulnerabilities; `npm audit` (all) still reports high issues in **dev-only** `sharp` (via transformers), `postcss`, `@vitest/mocker` — not shipped, no safe non-breaking fix (the fix is a major upgrade of transformers). `npm ci` succeeded on both Ubuntu and macOS runners (284 packages in 6 s on macOS).
