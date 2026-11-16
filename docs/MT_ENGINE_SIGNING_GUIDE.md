# Signing guide (nothing here was done for you: no key was created or committed)

Status of signing today: **UNSIGNED** for every artifact. No keystore, certificate or provisioning profile exists in the repository or was created.

## Android (APK / AAB)
`android/app/build.gradle.kts` signs the **release** build only when all four values are supplied from outside (environment variables or `-P` properties); otherwise it produces `app-release-unsigned.apk` / an unsigned AAB:
`LINGOLENS_KEYSTORE` (path to the .jks), `LINGOLENS_KEYSTORE_PASSWORD`, `LINGOLENS_KEY_ALIAS`, `LINGOLENS_KEY_PASSWORD`.
1. Create a keystore **once, yourself**, and keep it (and its passwords) outside the repository and backed up — losing it means you can never update the app under the same signature:
   `keytool -genkeypair -v -keystore lingolens-release.jks -alias lingolens -keyalg RSA -keysize 4096 -validity 10000`
2. Build: `LINGOLENS_KEYSTORE=/path/lingolens-release.jks LINGOLENS_KEYSTORE_PASSWORD=… LINGOLENS_KEY_ALIAS=lingolens LINGOLENS_KEY_PASSWORD=… ./gradlew assembleRelease bundleRelease` (in `android/`).
3. Verify: `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`.
4. For Google Play use the AAB and enrol in Play App Signing.
**This signing configuration was written but never exercised** (creating a key was outside what was allowed); the first signed build is the first test of it. For CI, store the keystore as a base64 repository secret and decode it in the job — do not run signed builds for pull requests from forks.

## iPhone (IPA)
The CI builds an **unsigned** IPA (`CODE_SIGNING_ALLOWED=NO`). Install it with Sideloadly using a (free) Apple ID, which re-signs it (valid 7 days). For TestFlight / App Store you need a paid Apple Developer account, a distribution certificate, a provisioning profile for `app.mangalingo.ios`, and an archive/export step with those; none exists here. Bundle id `app.mangalingo.ios`, deployment target iOS 16.0, version from `ios/project.yml`.

## Chrome Web Store
Upload the `dist/` ZIP from the Chrome Web Store developer dashboard (Google signs the package). Mention in the listing's privacy text that the optional OPUS-MT model is downloaded from huggingface.co only after the user clicks. For a stable extension id (needed for Smart Setup OAuth) provide `LINGOLENS_EXTENSION_PUBLIC_KEY` at build time.
