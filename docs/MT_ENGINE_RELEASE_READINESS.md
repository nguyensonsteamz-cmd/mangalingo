# MT engine — release readiness

**Verdict: NOT READY FOR RELEASE as a whole.** Chrome is ready (verified in real Chrome). Android is verified in an emulator but needs a physical-phone pass and a signing key. iPhone is **BLOCKED**: its new Swift code has never been compiled and nothing iOS-side was run. Google live API is unverified. This file lists exactly what is left; nothing here was invented or ticked without a run.

Legend: ✅ verified by a run in this work · 🟡 partly verified · ⛔ blocked / not done.

## Chrome extension
| Item | State | Evidence |
|---|---|---|
| Production build | ✅ | `npm run build` → `dist/` 47.5 MB |
| Unit tests / typecheck | ✅ | 392 passed; `tsc` clean |
| End-to-end in real Chrome | ✅ | 45 / 45 |
| Web Reader | ✅ | 18 / 18 |
| Chrome Translator en→vi, vi→en; Google BYOK path; provider selection; chunking / resume / cancel / usage | ✅ | unit + e2e |
| OPUS-MT: download with consent + size, progress, SHA-256 verify, cancel, damaged-file repair, remove, UI not blocked | ✅ | `mt-local-e2e.mjs` 11 / 11 |
| Permissions | ✅ no new permission (offscreen, `<all_urls>`, `wasm-unsafe-eval` already present) | manifest |
| Third-party notices | ✅ `licenses/OPUS-MT-NOTICE.txt`, `transformers.js-LICENSE.txt` | build output |
| Manual before store upload | ⛔ | legal review of the OPUS-MT licence reading; store listing / privacy text must mention the optional model download from huggingface.co |

## Android
| Item | State | Evidence |
|---|---|---|
| Debug APK | ✅ 100.3 MB | gradle |
| Release APK / AAB | 🟡 build OK, **unsigned** (96.6 MB / 42.5 MB) | gradle; no keystore exists, none was faked |
| ML Kit en→vi, vi→en (download, translation, errors) | ✅ emulator | `android-emulator-test.mjs` |
| OPUS-MT en→vi, vi→en in the real WebView; verify; cancel; repair; background → foreground; restart persistence; UI responsive | ✅ emulator | 15 / 15 |
| Memory | 🟡 ≈ 1.0 GB PSS with both models on a 3 GB x86_64 emulator | **needs a real ARM phone**; engineering target to decide: do not offer the model on devices with less RAM than the app + ≈ 0.8 GB (not enforced in code yet) |
| Long-text chunking / resume / cancel on device | 🟡 same JS as the unit-tested runner; not driven separately in the emulator | – |
| Physical-device test, low-storage, offline download | ⛔ | no phone |
| Manual before release | ⛔ | create a signing key and sign; test on ≥ 1 real phone (mid-range ARM) |

## iPhone
| Item | State | Evidence |
|---|---|---|
| Web bundle rebuilt | ✅ | `ios/MangaLingo/web` |
| Swift for vi→en (second `TranslationQueue` + session) | ⛔ **never compiled** | reviewed by reading; no macOS here, CI needs a push |
| Apple Translation en→vi / vi→en, scan, usage | ⛔ not run | – |
| OPUS-MT on iPhone | ⛔ **deliberately not offered** | `app://` scheme: Cache API / Workers unverified; UI hidden |
| IPA | ⛔ not built | – |
| CI workflow | ✅ ready: typecheck → unit tests → web build → xcodegen → `xcodebuild` (fails the job on a compile error) → executable check → IPA | `.github/workflows/ios.yml` |
| Manual | ⛔ | after you allow commit + push: run the workflow, read the compile log, install the IPA with Sideloadly, test en→vi, vi→en, scan; then decide on enabling the model (needs explicit `.mjs` / `.wasm` MIME types in `BundleSchemeHandler` and a device test) |
Risk to check in that CI run: `npm ci` now installs `@huggingface/transformers` (it pulls `onnxruntime-node`, `sharp`); if the macOS job fails there, move the package to an `optionalDependencies`/build-only group.

## Google BYOK
| Item | State |
|---|---|
| Request contract (endpoint, method, body, key only in the query, directions), error mapping, key never in errors, quota guard, cache / idempotency per direction | ✅ mock tests |
| Live call, real quota errors, billing | ⛔ not run: no API key or billing is configured here, and none was created (Smart Setup is the user's flow) |

## Model, licence, security
| Item | State |
|---|---|
| Pinned checkpoints + SHA-256 of both files (hashes equal the files benchmarked) | ✅ |
| Licence reading (Apache-2.0 cards; NLLB / VinAI / EnViT5 excluded) | 🟡 engineering reading, **not legal advice** |
| API key: sealed in secure storage, never in logs / errors / usage exports (no `console` output in usage, smart-setup, translation, mt) | ✅ |
| No shared key, no backend, no silent cloud fallback | ✅ (registry tests) |
| Android: WebView remote debugging only in debuggable builds | ✅ code; release build unaffected |
| Versions | ✅ `package.json` 0.1.0 = Gradle 0.1.0 (not changed) |

## Known limits (unchanged)
OPUS-MT en→vi is clearly weaker than Chrome Translator (technical / academic text); it is opt-in / fallback and the UI says so. Quality metrics are re-implementations + a proxy; no COMET, no human fluency review; IWSLT sample may overlap training data of some models. WASM-runtime speed on real phones unknown. No pause / resume of downloads (cancel + restart).

## Exact commands to finish
```
# Chrome
npm run build                                  # dist/
# Android (sign with YOUR key afterwards)
npm run build:mobile && cd android && ./gradlew assembleRelease bundleRelease
# iPhone: after commit + push, run the "iOS app (.ipa)" workflow
# Tests
npx vitest run; node scripts/e2e.mjs; node scripts/mt-local-e2e.mjs
node scripts/android-emulator-test.mjs         # emulator + debug APK started
```
