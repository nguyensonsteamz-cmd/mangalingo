# Release readiness report — physical device verification & signing preparation

Date 2026-11-16 · base commit `2f364ae` · artifacts: `release-artifacts/` (git-ignored; `MANIFEST.md` has size, SHA-256, signing and installation status of each).
Statuses: PASS (done, evidence) · FAIL · BLOCKED (missing condition) · NOT TESTED · NOT APPLICABLE.

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | Android build readiness | **PASS** | debug APK, release APK, AAB build from the tree (Gradle log); also green on Ubuntu CI |
| 2 | Android installation readiness | **PARTIAL** | debug APK installed and ran on the emulator; release is unsigned so it cannot be installed anywhere; **no physical device** (`adb devices` empty) |
| 3 | Android physical device verification | **BLOCKED** | no device. Emulator PASS 15/15 is not a substitute |
| 4 | Android signing readiness | **BLOCKED** | no keystore (not created by rule); signing hook written, never exercised; guide in `android-signing-guide.md` |
| 5 | iOS build readiness | **PASS (CI)** | Swift compile + unsigned IPA on macOS runner; **not buildable on this Windows host** |
| 6 | iOS installation readiness | **BLOCKED** | IPA unsigned; needs Sideloadly / Apple signing and a device |
| 7 | iOS physical device verification | **BLOCKED** | no iPhone. Simulator probe PASS ≠ device PASS; Apple Translation `unsupported` in the simulator |
| 8 | iOS signing readiness | **BLOCKED** | no Apple Developer account / certificate / profile; no entitlements file; `iOS signing guide` lists decisions needed |
| 9 | MT engine regression | **PASS** | `tsc` clean, 392 / 392 unit tests this phase; earlier Chrome e2e 45/45, model e2e 11/11, emulator 15/15, CI green (Ubuntu + macOS). **No MT-engine file was modified in this phase** (`git status`: only `.gitignore` + new docs) |
| 10 | Overall | **READY WITH LIMITATIONS — NOT READY FOR STORE RELEASE** | build and CI are healthy; everything that needs a phone, a signing identity or a Google key is still open |

## MT-engine protection
Files touched in this phase: `.gitignore` (adds `release-artifacts/`), `docs/release/*`. Nothing under `src/`, `android/`, `ios/`, `scripts/`, `tests/`, `package*.json` or the workflows. CI baseline unaffected (nothing pushed).

## Findings carried to the owner
1. Play-review-sensitive permissions: `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE_SPECIAL_USE`.
2. iOS has no entitlements / privacy strings (fine today, needed if camera / photos are added).
3. Version 0.1.0 / build 1 must be raised per upload.
4. OPUS-MT stays opt-in; on iPhone stays disabled until a device memory test; licences need legal review (`MT_ENGINE_MODEL_SELECTION.md`).
5. Google BYOK never run live (no key).

## Remaining actions (owner)
| Action | Unblocks |
|---|---|
| Connect an Android phone (USB debugging) — then run the matrix; I can run `adb install` + logcat + the DevTools script | rows 2, 3 |
| Provide an iPhone (iOS 18+) and install the IPA with Sideloadly (or give macOS/Xcode access) | rows 6, 7 |
| Create the Android upload keystore and supply it via env / CI secrets; confirm Application ID `app.mangalingo` | row 4 |
| Apple Developer Program membership; confirm bundle id `app.mangalingo.ios`, team, distribution method | row 8 |
| An API key with billing (Smart Setup) for the live Google check | Google live |
| Agree pass thresholds (memory, startup) for devices | performance verdicts |
| Legal review of the OPUS-MT licence reading | commercial release |
| Tell me if you want these docs / `.gitignore` committed (not done) | – |
