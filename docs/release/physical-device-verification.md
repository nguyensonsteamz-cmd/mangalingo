# Physical device verification

Date: 2026-11-16 · Git: `2f364ae` (working tree clean except `.gitignore`; **nothing committed or pushed in this phase**).

## Result
| Item | Status | Evidence |
|---|---|---|
| Android physical device | **BLOCKED** — no device | `adb devices` → empty list (`release-artifacts/logs/adb-devices.log`) |
| iPhone / iPad physical device | **BLOCKED** — no device, no macOS, no Apple signing | Windows host (`uname`: MINGW64_NT) |
| Android emulator (Android 15 x86_64) | PASS (earlier, 15/15) — **not** a physical-device result | `scripts/android-emulator-test.mjs`, `MT_ENGINE_TEST_REPORT.md` |
| iOS simulator probe (iOS 18.7) | PASS (earlier, CI) — **not** a physical-device result | CI run 43890461052 |
No row above may be read as "Physical Device Verification PASS". Every test case in `device-test-matrix.md` is **NOT TESTED**.

## What was done instead (evidence that does not need a phone)
* Rebuilt every artifact from the current tree (logs in `release-artifacts/logs/`): Android debug APK, release APK (unsigned), release AAB (unsigned), Chrome extension ZIP; the iOS IPA is the CI build of the same sources (`LingoLens.ipa`, run 43890461052).
* Inspected the APKs with `aapt2` / `apksigner` (below) and the IPA's `Info.plist`.
* Regression: `tsc` clean, **392 / 392** unit tests, no MT-engine file modified in this phase (see below).

## Artifact inspection
| Artifact | Facts |
|---|---|
| APK debug | `app.mangalingo`, versionCode 1 / versionName 0.1.0, compile / target SDK 35 (minSdk 26 per Gradle), **debuggable**, signed with the Android **debug** certificate (CN=Android Debug), ABIs arm64-v8a, armeabi-v7a, x86, x86_64 |
| APK release | same ids, **not debuggable**, **UNSIGNED** (`apksigner verify` → "Missing META-INF/MANIFEST.MF": cannot be installed on a device until signed) |
| AAB release | UNSIGNED |
| IPA | bundle `app.mangalingo.ios`, version 0.1.0 (build 1), MinimumOSVersion 16.0, `ITSAppUsesNonExemptEncryption=false`, **no `_CodeSignature`** (UNSIGNED), no entitlements file, no privacy-usage descriptions in Info.plist |

## Findings for the owner (not fixed here: they are configuration / policy, not MT engine)
1. **Android permissions that Google Play reviews:** `SYSTEM_ALERT_WINDOW` (the floating button) and `FOREGROUND_SERVICE_SPECIAL_USE` (a justification property is already declared). Prepare the Play Console declarations.
2. **Release APK is installable only after signing**; the debug APK installs as is (`adb install`) but must never be distributed.
3. **iOS: no entitlements and no privacy strings.** If a camera / photo-library feature is ever added, add the `NS…UsageDescription` keys first (not needed by the current Vision OCR / Shortcuts flow).
4. Version numbers are the initial 0.1.0 / 1; they were not changed. Each store upload needs a higher `versionCode` / `CFBundleVersion`.
5. `allowBackup=false`; no cleartext-traffic exception was found in the manifest.

## How to run the physical-device pass
Android: `device-test-matrix.md` + `docs/MT_ENGINE_ANDROID_DEVICE_TEST.md`; debug APK: `adb install -r release-artifacts/lingolens-0.1.0-debug.apk`; collect `adb logcat -d`, `adb shell dumpsys meminfo app.mangalingo`, crash dumps; `node scripts/android-emulator-test.mjs` also works against a USB phone (it uses the WebView DevTools socket).
iPhone: sign the IPA (see `ios-signing-guide.md`), install, run the matrix; `docs/MT_ENGINE_IOS_VERIFICATION.md` lists the model memory check.
