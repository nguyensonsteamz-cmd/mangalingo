# MT engine – final report (finalization pass)

Date: 2026-11-16. **Overall status: PARTIAL — not ready for release as a whole** (see `MT_ENGINE_RELEASE_READINESS.md`). Chrome: ready. Android: verified in an emulator, unsigned, no physical phone. iPhone: **BLOCKED** (Swift never compiled, nothing iOS run). Google live API: not verified. **No git commit, no push, no release, no signing key created, no API key created.**

## 1. Completed in this pass
| Task | Result |
|---|---|
| Android environment inspected (SDK, JDK, Gradle, adb; AVD `ml35` Android 15 x86_64, 3 GB) | emulator booted and used |
| ML Kit en→vi and vi→en on the real app | ✅ availability → download → translation; both translators side by side; unknown pair rejected |
| OPUS-MT in the **real Android WebView** | ✅ download, en→vi, vi→en, chunk-level behaviour via shared runner, UI responsive (max gap 94 ms), background → foreground, restart persistence |
| Model lifecycle hardening | ✅ SHA-256 + size verification (hashes of the pinned files = the benchmarked files), free-space check, cancel, duplicate-download join, stale-revision cleanup, damaged-file detection + deletion + repair, intact-file load failure keeps the model, offline message |
| Real-Chrome lifecycle e2e | ✅ 11/11 (verify, corrupt → repair, cancel → restart) |
| Google BYOK | 🟡 request-contract tests (endpoint, method, body, directions, key only in the query, no key in any error, status mapping); **no live call** |
| Android release builds | 🟡 release APK (unsigned) 96.6 MB, AAB 42.5 MB build; **not signed** |
| iOS | ⛔ Swift reviewed by reading only; CI workflow improved (typecheck step); nothing compiled |
| Documentation | all MT docs updated; new `MT_ENGINE_RELEASE_READINESS.md` |

## 2. Android verification (emulator, x86_64, Android 15, 3 GB RAM) — 15/15
ML Kit: en→vi "Where is the nearest train station?" → "Ga tàu gần nhất ở đâu?"; vi→en works; the same words give correct output in each direction. OPUS-MT: absent before consent; downloads inside the page's Worker; warm sentence ≈ 0.75–0.93 s; **memory ≈ 1.0 GB** (app + WebView renderer PSS; 248 MB before the models); UI thread max gap 94 ms; SHA-256 ok; cancel halfway leaves nothing; damaged file detected and repaired; survives Home → return and force-stop → restart without re-download. **Emulator numbers are not phone numbers.** Not done: physical device, low-storage / offline download on a device, signing.

## 3. iOS verification — BLOCKED
No macOS / Xcode here, and the only runner (GitHub Actions) requires a push, which is forbidden. So: Swift for vi→en (`Translator.swift`, `WebContainer.swift`) **not compiled**; Apple Translation en→vi / vi→en, iOS scan, iOS usage **not run**; no IPA. The downloaded model is **not offered** on iPhone (custom `app://` scheme: Cache API / module Workers unverified; `.mjs` / `.wasm` MIME types not set) and no UI claims otherwise. Core ML not done (needs Python + macOS). Scan keeps Apple's batch translation by design. The CI workflow is ready for the next run (see readiness file for the first things to check, including the new `onnxruntime-node` / `sharp` dependencies of `@huggingface/transformers` under `npm ci`).

## 4. Google BYOK
Contract verified with a mock transport only. Live verification needs a user-provided API key with billing enabled (Smart Setup); none exists on this machine and none was created.

## 5. Tests and builds (this pass)
| | Result |
|---|---|
| Unit | **392 / 392** (23 files; 341 before the MT work) |
| `tsc --noEmit` | clean |
| Chrome e2e | **45 / 45** |
| Web Reader | 18 / 18 |
| Local model, real Chrome extension | **11 / 11** |
| Local model, phone web bundle in desktop Chrome | 6 / 6 |
| **Android emulator** | **15 / 15** |
| Builds | extension `dist/` 47.5 MB; debug APK 100.3 MB; release APK 96.6 MB (unsigned); AAB 42.5 MB; **IPA: not built** |

## 6. Performance (measured, with the right label)
Dev machine (laptop CPU, onnxruntime-node): OPUS-MT p50 0.56–0.63 s/sentence, peak RSS ≈ 600 MB (`TRANSLATION_BENCHMARK_LAB.md`). Android emulator (WebView WASM): warm sentence 0.75–0.93 s, ≈ 1.0 GB PSS with both models. Phones: **not measured**. No new thresholds were invented; the only target proposed (don't offer the model when RAM is below app + ≈ 0.8 GB) is an *engineering target*, not enforced.

## 7. Security findings
No key in logs / errors / exports (no `console` output in usage / smart-setup / translation / mt). No new permission. No remote code (ONNX Runtime WASM is bundled; only model data is downloaded, hash-verified). **Fixed in this pass:** Android WebView remote debugging is now enabled only for `debuggable` builds (needed by the emulator test; release builds unaffected). Residual: licence reading is not legal advice; Hugging Face is a third-party host.

## 8. Known limitations
OPUS-MT en→vi quality below Chrome Translator (technical / academic text especially); metrics are re-implementations + a proxy, no COMET, no human fluency review; WASM speed on real phones unknown; no pause / resume of downloads; chunking / resume on Android not separately driven in the emulator (same unit-tested JS runner).

## 9. Blocked, and what is needed
| Blocked | Needs |
|---|---|
| iOS compile + run, IPA | your permission to commit + push (to run the CI) or a Mac |
| Android on a real phone | a phone; a signing key for release |
| Google live check | an API key with billing, from Smart Setup |
| COMET, sacreBLEU, Core ML | not possible on this machine (Application Control policy / no macOS) — not bypassed |
| Licence sign-off | a legal review |

## 10. Files changed in this pass
**New:** `src/…` none beyond the earlier module; `tests/mt-lifecycle.test.ts`, `scripts/android-emulator-test.mjs`, `docs/MT_ENGINE_RELEASE_READINESS.md`.
**Modified:** `src/modules/mt/local/{engine,host,models,worker}.ts`, `src/shared/messages.ts`, `src/background/{router,index}.ts`, `src/offscreen/{main,protocol}.ts`, `src/translation/mt-providers.ts`, `src/options/LocalModelSection.tsx`, `src/ui/MachineTranslation.tsx`, `android/app/src/main/java/app/mangalingo/MainActivity.kt`, `scripts/mt-local-e2e.mjs`, `.github/workflows/ios.yml`, `tests/mt-local.test.ts`, and the docs `MT_ENGINE_{DEPLOYMENT,TEST_REPORT,PROVIDER_REGISTRY,MIGRATION_PLAN,FINAL_REPORT}.md`.
(The previous pass' files — registry, local provider, benchmark lab, VI→EN — are listed in git as uncommitted changes.)

## 11. Confirmation
No `git commit`, no `git push`, no publish, no upload, no release. Working tree only.
