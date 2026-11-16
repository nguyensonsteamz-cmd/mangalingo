# Android signing guide

Status: **Signing Readiness = BLOCKED / NOT VERIFIED.** No keystore exists; none was created (rule: no production or fake signing key); the Gradle signing hook was written but has **never produced a signed build**. Extends `docs/MT_ENGINE_SIGNING_GUIDE.md`.

## Facts verified in this repo
| Item | Value | How verified |
|---|---|---|
| Application ID | `app.mangalingo` | aapt2 on the APK |
| versionCode / versionName | 1 / 0.1.0 (also `package.json` 0.1.0) | aapt2, build.gradle.kts |
| compile / target / min SDK | 35 / 35 / 26 | build.gradle.kts, aapt2 |
| AGP / Kotlin / Gradle / JDK | 8.7.3 / 2.0.21 / 8.9 / 17 | build files, `java -version` |
| Release signing | `build.gradle.kts` signs **only if** `LINGOLENS_KEYSTORE`, `LINGOLENS_KEYSTORE_PASSWORD`, `LINGOLENS_KEY_ALIAS`, `LINGOLENS_KEY_PASSWORD` are provided (env or `-P`), else UNSIGNED | code reading; CI builds unsigned |
| Debug APK | signed with the Android debug certificate (CN=Android Debug): installable, **never distribute** | apksigner |
| Release APK / AAB | unsigned, not debuggable | apksigner / aapt2 |
| Sensitive permissions for review | SYSTEM_ALERT_WINDOW, FOREGROUND_SERVICE_SPECIAL_USE (+ justification property present), POST_NOTIFICATIONS | manifest |
| Backup | `allowBackup=false` | manifest |

## What the owner must do
1. **Create the upload keystore yourself** (never in the repo, back it up in two places):
   `keytool -genkeypair -v -keystore lingolens-upload.jks -alias lingolens -keyalg RSA -keysize 4096 -validity 10000`
2. Enrol in **Play App Signing** (Google holds the app-signing key; you hold only the upload key — a lost upload key can be reset, a lost app-signing key cannot).
3. Build the signed AAB locally: set the four variables in your shell (not in a file that is committed) and run `cd android && ./gradlew bundleRelease`; verify with `apksigner verify --print-certs` (APK) / `jarsigner -verify` (AAB).
4. For CI: base64 the keystore into the repository secret `ANDROID_KEYSTORE_B64`, passwords into secrets, decode to a temp file in the job, export the four variables, build, **delete the file**; never run on pull requests from forks; never `echo` secrets.
5. Before each upload raise `versionCode` in `android/app/build.gradle.kts` (and `versionName`) — not done here on purpose.
6. Play Console: data-safety form (the app sends text to Google only when the user enables the BYOK provider; the optional model is downloaded from huggingface.co), overlay-permission and special-use foreground-service declarations, content rating, target audience.
7. First signed build = first test of the signing hook: record the result in `release-readiness-report.md`.

## Do not
Commit the keystore or passwords; reuse the debug key; change the Application ID after the first Play upload.
