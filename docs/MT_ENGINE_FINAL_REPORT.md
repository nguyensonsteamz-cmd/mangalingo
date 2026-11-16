# MT engine – final report (commit / push / CI pass)

## A. Executive summary
**READY WITH LIMITATIONS — not ready for a store release.**
* **Done and green:** code committed and pushed to `origin/master`; GitHub Actions green on Ubuntu (typecheck, 392 unit tests, production audit, extension build, Android debug / release / AAB) and macOS (typecheck, tests, **Swift compile**, unsigned IPA, **iOS simulator runtime probe**).
* **Chrome:** complete and verified in real Chrome (e2e 45/45, local model 11/11, reader 18/18).
* **Android:** verified in an **emulator** (15/15); builds; **unsigned**; no physical phone.
* **iPhone:** **COMPILE VERIFIED**, unsigned IPA built; the downloaded model **RUNTIME VERIFIED in the simulator** but deliberately not enabled; Apple Translation and the scan flow have **never run** (needs a physical iPhone).
* **Blockers (external):** physical iPhone + Android phone, Apple Developer / Android signing keys, a Google API key with billing, legal review of licences.

## B. Git
| | |
|---|---|
| Branch / remote | `master` → `origin` = github.com/nomaex-hash/mangalingo (no force push, no history rewrite) |
| Commits (this pass) | `ee70bfd` feat(translation): MT engine, long-text chunking, monthly usage v2, Smart Setup · `601e23c` / `8da6551` / `812d01e` CI probe (two had my Swift escape mistakes) · `0271f6d` fix · `a32d92d` probe SHA/persistence + MIME · `12fdde1` docs + optional signing config |
| Scope note | the first commit also contains the earlier uncommitted work the MT engine depends on (Smart Setup, usage v2, chunking, billing/account) — it was all authored in this project and the code is interdependent (`messages.ts`, router, usage). No secrets: scanned (only fake test keys). |
| Not committed | `.tmp/`, build output, IWSLT/ALT evaluation data, raw benchmark runs (git-ignored) |
| CI links | https://github.com/nomaex-hash/mangalingo/actions — run ids in `MT_ENGINE_CI_RESULTS.md` |

## C. Testing
| Test | Result | Environment | Evidence |
|---|---|---|---|
| TypeScript | PASS | Windows, Ubuntu CI, macOS CI | `tsc --noEmit` |
| Unit tests (392, 23 files) | PASS | Windows + both CI runners | vitest |
| Chrome e2e (45) | PASS | real headless Chrome, Windows | `scripts/e2e.mjs` |
| Web Reader (18) | PASS | real Chrome | `scripts/reader-test.mjs` |
| OPUS-MT in the extension (11: consent, download, verify SHA-256, damaged-file repair, cancel, responsive) | PASS | real Chrome | `scripts/mt-local-e2e.mjs` |
| OPUS-MT in the phone bundle (6) | PASS | desktop Chrome | `scripts/mt-local-mobile-test.mjs` |
| Android app (15: ML Kit en↔vi, OPUS-MT, lifecycle, memory, repair, restart) | PASS — **VERIFIED ON EMULATOR** (Android 15 x86_64, 3 GB) | emulator | `scripts/android-emulator-test.mjs`; PSS ≈ 1.08 GB with both models |
| Swift compile (Release iphoneos + Debug simulator) | PASS — **COMPILE VERIFIED** | macOS runner | CI 43883208282 / 43890461052 |
| iOS runtime probe (Worker, Cache API, WASM, model download, SHA-256, translate, persistence after relaunch) | PASS — **RUNTIME VERIFIED (SIMULATOR iOS 18.7)** | macOS runner | CI 43890461052, artifact `ios-simulator-probe` |
| Apple Translation en↔vi, iOS scan, iOS usage | **NOT RUN** (simulator: `unsupported`) | – | – |
| Google BYOK contract (mock transport) | PASS | unit | `tests/mt-local.test.ts` |
| Google BYOK **live** | **NOT RUN** | – | no key / billing; none created |
| Physical Android / iPhone | **NOT RUN** | – | no devices |

## D. Build artifacts
| Artifact | Size | Status | Where |
|---|---|---|---|
| Chrome extension `dist/` | 47.5 MB | built (CI artifact `lingolens-extension`) | `dist/` |
| Android debug APK | 100.3 MB | built, debug-signed by Gradle | `android/app/build/outputs/apk/debug/` |
| Android release APK | 96.6 MB | **UNSIGNED** | `…/apk/release/app-release-unsigned.apk` |
| Android AAB | 42.5 MB | **UNSIGNED** | `…/bundle/release/app-release.aab` |
| iOS IPA | 17.2 MB | **UNSIGNED** (Sideloadly re-signs) | `ios-build/LingoLens.ipa` (verified: contains `MangaLingo` executable) |
Release APK has `debuggable=false` (checked with aapt2); debug has it.

## E. Platform verification
Chrome: real browser, all suites above. Android emulator: 15/15. Android physical: NOT RUN (`MT_ENGINE_ANDROID_DEVICE_TEST.md`). iOS compile: verified. iOS simulator: probe verified (model works). iOS physical: NOT RUN (`MT_ENGINE_IOS_VERIFICATION.md`).

## F. Security / licence
* `npm audit --omit=dev`: **0 vulnerabilities** (CI-gated). Full `npm audit`: high issues only in **dev-only** `sharp` (via transformers), `postcss`, `@vitest/mocker`; not shipped; fix needs major upgrades (not done).
* Hardening: `@huggingface/transformers` moved to devDependencies (build-time bundling only) so macOS/Android installs of the shipped app carry no node-native runtime.
* Bundled runtime licences (closure of transformers.js + ORT-web): Apache-2.0, MIT, BSD-3-Clause, ISC, BlueOak-1.0.0 — all permissive; notices shipped (`licenses/`). Model: OPUS-MT Apache-2.0 per model cards; training data = OPUS corpora with mixed terms; ONNX conversions carry no own licence text → **commercial use is plausible but unproven; needs legal review**. EnViT5 / NLLB / VinAI stay excluded.
* Keys: no key in logs / errors / exports; no secrets committed; no workflow uses secrets; Android remote debugging only in debuggable builds.

## G. Remaining blockers
| Blocker | Cause / evidence | Needs | Blocks release? |
|---|---|---|---|
| Apple Translation + scan unverified | simulator reports `unsupported`; no iPhone | install the IPA on an iPhone (iOS 18+) and run the checklist | yes for iOS |
| Android physical device | none connected | checklist in `MT_ENGINE_ANDROID_DEVICE_TEST.md` | yes for Android |
| Signing | no keystore / Apple credentials; signing config never exercised (creating a key was refused by the tool policy) | `MT_ENGINE_SIGNING_GUIDE.md` | yes for stores |
| Google live | no API key / billing | Smart Setup with a real key | recommended |
| Licence sign-off | model-card reading only | legal review | yes for commercial release |
| COMET / human quality review | Python blocked by Application Control; no reviewer | – | no (documented limitation) |

## H. Recommendation
* Release **preparation** can start (Chrome first). **Signing** needs your keys. **Commercial release** only after legal review and the device passes.
* **Do not enable OPUS-MT by default** anywhere: it is weaker than Chrome Translator (en→vi chrF++ 44.5 vs 55.6). Keep it opt-in.
* **Keep OPUS-MT disabled on iPhone** until a memory test on a real phone (simulator evidence is positive).
* Android: offer the model only after a phone pass; consider hiding it on ≤ 3 GB devices (engineering target, not enforced).

## Files
Code and tests: see `git show --stat ee70bfd`. This pass additionally: `.github/workflows/{ci,ios}.yml`, `scripts/assets/ios-probe.html`, `scripts/build-mobile.mjs`, `ios/MangaLingo/WebContainer.swift`, `android/app/build.gradle.kts`, `package.json`/lock (transformers → dev), docs `MT_ENGINE_{CI_RESULTS,IOS_VERIFICATION,SIGNING_GUIDE,ANDROID_DEVICE_TEST,FINAL_REPORT,RELEASE_READINESS}.md`.
No release, no tag, no publish, no store upload, no force push.
