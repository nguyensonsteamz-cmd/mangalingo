# Migration report: Google Cloud Translation API → Google Translate web (unofficial)

*2026-11-20. Audit before the work: `docs/translation_provider_migration_audit.md`. Nothing was committed or pushed.*

## 1. Executive summary

**Final status: `BLOCKED`** (for the one criterion that matters most: real-provider verification). **Implemented and mock-verified; not verified against the real service.**

- Implemented: a key-less provider `google-web` shared by Chrome, Android and iOS, integrated into the existing MT Engine path (`usage:translate` → chunk runner → ledger), with timeout, cancellation, serialisation, spacing, bounded retry of network errors only, a persisted cooldown after a block, nine error states, and no evasion of any kind.
- **Google blocked the one live request** made from the test machine's network: HTTP 429, HTML page "We're sorry… your computer or network may be sending automated queries". Testing stopped there (1 request, no retry, no workaround). So **no real translation was obtained**; real-provider behaviour (response shape in production, CORS on phones, long text, reliability) is **not tested**.
- Not `READY`: the real provider has not been verified. Not `READY_WITH_LIMITATIONS`: there is no evidence yet that it works from any network.
- Google Cloud is **not** the default (the default remains on-device) and a key is **not** required for Google Translate web. Cloud BYOK + Smart Setup remain as an *optional advanced* provider; they are never used silently.

## 2. Before / after

| | Before | After |
|---|---|---|
| Google option | Google Cloud v2, needs project + billing + key (Smart Setup or pasted key) | **Google Dịch (web)**: nothing to configure; Cloud key is optional/advanced |
| Path | `googleActive()` (provider google + key) → `usage:translate` → quota guard → `googleTranslate()` | `googleMode()` = `google` / `google-web` / none → same `usage:translate` → guard (`metered:false` for web) → `GoogleWebGate` → `googleWebTranslate()` |
| Ledger | `google-v2` + credential, free quota, cost, paid limits | web: own ledger `google-web|web`, counts characters/requests/failures; no quota, no cost |
| Default | `device` | `device` (unchanged: nothing is sent anywhere until the user chooses Google) |

## 3. Provider implementation

`src/modules/usage/google-web.ts` (new):
- `GET https://translate.googleapis.com/translate_a/single?client=gtx&sl=…&tl=…&dt=t&q=…` directly from the device; no key, no custom headers, `credentials: 'omit'`, no proxy.
- `parseTranslation`: only the expected JSON is a success. HTML / CAPTCHA page / error page / empty / invalid JSON → error; a real sentence echoed back unchanged → `TRANSLATION_FAILED`; the source text is never silently returned as a translation.
- `classifyHttp`: 429+“Sorry” page or redirect to `/sorry/` → `CAPTCHA_REQUIRED`; other 429 → `RATE_LIMITED`; 401/403 → `ACCESS_BLOCKED`; 413/414 → `TEXT_TOO_LONG`; 408/5xx → `NETWORK_ERROR`; 400 → `TRANSLATION_FAILED`.
- `GoogleWebGate`: one request at a time; ≥ 1.2 s between starts; 15-minute cooldown (persisted in `chrome.storage.local` key `gweb:cooldown`) after `RATE_LIMITED`/`ACCESS_BLOCKED`/`CAPTCHA_REQUIRED`, during which **no network request is made**; one retry for `NETWORK_ERROR`/`TIMEOUT` only; never a retry for a block.
- Limits per request: 1,500 code points and 8,000 URL characters (GET). Chunker limits in `providers.ts`: target 1,200, max 1,500, 3,000 bytes, concurrency 1. **There is no documented Google quota; none is claimed.**
- Messages shown to users are Vietnamese, say the service "may be limiting automated requests" and do not imply Google supports the integration; no stack traces, no text or URL in any message.
- Integration: `UsageService.translateWeb`, `activateGoogleWeb`; `MtProvider` `google-web` (kind `cloud-web`); `googleMode()`; runner classification for `gweb-*` (block ⇒ **fatal for the job**, nothing more is sent).

## 4. Platforms

| | Implemented | Verified |
|---|---|---|
| Chrome extension | yes (manifest unchanged: `<all_urls>` host permission already covers it; no new permission; no CSP change) | builds; unit/integration with fake network; real Chrome E2E 50/50 (default mode, offline) |
| Android | yes, via the shared web bundle (`INTERNET` already declared) | web bundle builds; **no Gradle/device test**; CORS from the WebView **unknown** |
| iOS | yes, via the shared web bundle (HTTPS, no ATS exception) | web bundle builds; **not compiled** (no iOS toolchain here, CI billing blocked); CORS **unknown** |

No Kotlin/Swift file was changed.

## 5. Files changed (16 modified, 3 new in `src`/`tests`/`docs`; nothing committed)

New: `src/modules/usage/google-web.ts`, `tests/google-web.test.ts`, `docs/translation_provider_migration_audit.md`, this report.
Modified: `modules/mt/types.ts`, `modules/translation/providers.ts`, `modules/usage/{CostProtectionService,UsageMeter,UsageRepository,UsageSettings,index,types}.ts`, `translation/{chrome-mt,long-text,mt-providers}.ts`, `options/UsageSection.tsx`, `ui/MonthlyUsageCard.tsx`, `README.md`, `docs/PRIVACY.md`, `docs/TRANSLATION_PROVIDER_LIMITS.md`. Rebuilt (git-ignored): `dist/`, `android/app/src/main/assets/web/`, `ios/MangaLingo/web/`.

## 6. Google Cloud requirements removed

- Removed as a requirement: project, billing, key for the Google option (UI, README, error text, provider selection).
- **Kept on purpose:** `google.ts`, Smart Setup, key vaults, quota/paid-consent logic: they serve the optional Cloud provider and removing them is large, risky and was not needed to meet the goal. They are demoted in `UsageSection` ("Google Cloud (khoá riêng)", "tuỳ chọn, có thể tính phí"). Generic key infrastructure is untouched. If you want Smart Setup deleted entirely, that is a separate change.

## 7. Usage limits

- Cloud limits (free quota, paid consent, cost cap, per-day paid requests) apply to the Cloud ledger only and are unchanged.
- Google web: no quota or billing exists, so none is enforced or displayed; the UI shows characters translated, successful and failed requests, labelled "ước tính trên máy này". LingoLens protects itself and the user's network with the gate (serial, spacing, cooldown) rather than a fake quota. Application-level limits that protect LingoLens (chunk maximum, job maximum 500,000 characters) still apply.

## 8. Privacy

See the new section in `docs/PRIVACY.md`: text goes device → `translate.googleapis.com` only after the user chooses the option; no LingoLens server; no logging of text; cache/ledger local; Google may keep requests under its own policy; no third-party dependency was added.

## 9. Unit tests (mock network)

`tests/google-web.test.ts`: 32 tests: parsing (success, HTML, CAPTCHA, invalid JSON, echo), HTTP classification, request shape (GET, no headers/credentials/key), Unicode/Vietnamese/Chinese/URLs/numbers/HTML-like/newlines, language validation, empty/too-long input, timeout, cancellation, no URL/text in errors, gate (serial, spacing, bounded retry, no retry on block, cooldown, persistence, broken store).

## 10. Integration tests (mock network)

Same file: `UsageService` with web mode (no key; own ledger; not blocked by Cloud quota; idempotent retries counted once; block → `gweb-CAPTCHA_REQUIRED`, counted as failure not characters, then zero requests; device default untouched) and the real chunk runner end to end (short text, 20 paragraphs in order with no gap/duplicate, bounded retry of one network error, mid-job block stops the job with a partial result, cancellation, error classification).

## 11. Regression

| Check | Result (2026-11-20) |
|---|---|
| Baseline before changes | `tsc` clean; vitest 431 passed / 30 files |
| After | `tsc` clean; **vitest 463 passed / 31 files** (431 existing + 32 new), 0 failed |
| `npm run build` (extension) | OK |
| `npm run build:mobile`, `build:ios-web` | OK |
| `npm run e2e` (real headless Chrome with the new build) | **50/50 passed**, including "No request left the machine" in default mode |
| Android Gradle / iOS Xcode | **not run** (no toolchain here; CI blocked by billing) |

## 12. Live translation: `BLOCKED`

| Date (UTC) | Platform | Requests | Pair | Outcome |
|---|---|---|---|---|
| 2026-11-20 13:24 | this Windows machine, `curl` to the same endpoint and URL shape the provider uses, with an `Origin` header to read CORS | **1** | en→vi, "Good morning" | **HTTP 429**, HTML "Sorry… automated queries"; no translation, no CORS header |

Testing stopped immediately. No retry, no other endpoint, no workaround. This matches the earlier benchmark (CAPTCHA page on `/m` from the same network). One failed request says nothing about other networks, and one success would not prove reliability either.

## 13. Long text

Chunking, order, partial failure, cancellation and bounded retry are **tested with mock** (section 10). Long-text support against the real provider is **not verified**.

## 14. Platform build results

Extension and both web bundles build. Android APK and iOS app were **not rebuilt** (see section 4 and 11). The existing `LingoLens-android-0.1.0.apk` does not contain this change.

## 15. Known limitations

- Not verified live anywhere; may be blocked from many networks (it is from the test network).
- Mobile CORS unknown; if the endpoint sends no CORS headers the phone apps get `NETWORK_ERROR` (fix would be a native HTTP bridge, not implemented).
- No in-flight abort through the message router (cancellation acts between chunks).
- Pairs: en→vi and vi→en only in the UI (client also accepts zh).
- The endpoint is unofficial and undocumented: the response format can change without notice (parser fails closed with `TRANSLATION_FAILED`).

## 16. Google blocking risks and policy

Observed twice from this machine. `translate.google.com/robots.txt` disallows `/m?` and `/translate_a`; Google's Terms forbid automated access against robots.txt. The product owner chose this migration and carries that risk; the implementation deliberately does nothing to hide or evade. Behaviour when blocked: stop, 15-minute cooldown, clear message, no retries, no silent switch to Google Cloud or to another cloud provider.

**Recommended next steps** (none is applied silently): (1) test the in-app feature from another network by hand (section 18); (2) keep **on-device** translation as the default and fallback; (3) for dependable Google quality use the already-present **official Cloud BYOK** (optional, paid beyond the free tier); (4) if the real answer works on phones, verify CORS on a device before shipping mobile.

## 17. Rollback

Nothing is committed. `git checkout -- src tests README.md docs` and delete `src/modules/usage/google-web.ts`, `tests/google-web.test.ts` (or `git stash -u`) restore the previous behaviour; then `npm run build` / `build:mobile`. Per user: choose **Trên máy** in *Cài đặt → Hạn mức dịch*; the stored `provider` value `google-web` is also sanitised back to the default by older builds.

## 18. How to test the app

```powershell
cd D:\extension
npx tsc --noEmit -p tsconfig.json
npx vitest run                      # 463 tests, mock network
npm run build                       # then load dist\ in chrome://extensions (Developer mode)
npm run e2e                         # real Chrome, default mode
```
In the extension: *Options → Hạn mức dịch → Dịch bằng → Google Dịch (web)*, then translate a sentence. Expected: either a Vietnamese translation (then the provider works from your network) or the message "Google Dịch tạm thời không dùng được…" (blocked: wait, do not retry repeatedly). Statistics appear under "Mức dùng tháng này".
