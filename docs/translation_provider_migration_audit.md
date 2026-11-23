# Translation provider migration audit: Google Cloud Translation → Google Translate web (unofficial)

*2026-11-20, before any change. Repository `D:\extension`, HEAD `d229e93`, working tree clean. Baseline: `tsc --noEmit` clean, `vitest run` 431 passed in 30 files.*

## 1. Current architecture

- **MT Engine** (`src/modules/mt`): `MtProvider` interface (`types.ts`), `ProviderRegistry` (`registry.ts`: selection rules, timeout, cancellation, restricted fallback), local OPUS-MT model provider (off in the product).
- **App providers** (`src/translation/mt-providers.ts`): `nativeProvider` (Chrome Translator / Apple Translation / ML Kit), `googleProvider` (**Google Cloud v2, BYOK**), `localProvider`.
- **Routing**: callers (`chrome-mt.ts`, `long-text.ts`) ask `googleActive()` (usage settings `provider==='google'` **and** a stored key). If true, every chunk goes through the message `usage:translate` → `UsageService.translate` → `CostProtectionService` (normalise, cache, idempotency, quota check, reserve, send, commit/release) → `googleTranslate()` in `src/modules/usage/google.ts` (POST to `translation.googleapis.com/language/translate/v2?key=…`). Otherwise the on-device translator is used. Default provider is `device`.
- **Chunking** (`src/modules/translation`): `chunker.ts`, `ChunkedTranslator.ts` (per-chunk retry with backoff, fatal errors stop the job, ordered merge, partial results flagged, cancellation), per-provider limits in `providers.ts` (`google-v2`: 4,800/5,000 chars, 2 concurrent).
- **Usage** (`src/modules/usage`): ledger per provider + credential, free quota 500,000 chars, warnings, hard stop, explicit paid consent and paid limits (chars/cost/requests per day), cost estimate at $20 / 1M chars, Cloud Monitoring account sync. All numbers are local estimates of **Google Cloud billing**.
- **Smart Setup** (`src/modules/smart-setup`, `src/options/SmartSetupSection.tsx`, `BillingSection`, `AccountSection`): OAuth, project selection, enabling billing/API, creating a key (Google Cloud onboarding).

## 2. Google Cloud dependencies found

| Area | Files |
|---|---|
| Client | `src/modules/usage/google.ts` |
| Key storage / validation | `usage/UsageRepository.ts`, `smart-setup/secrets.ts`, `smart-setup/google-cloud.ts`, `UsageService.validateSaved`; native vaults `android/.../SecretVault.kt`, `ios/.../Setup/KeychainStore.swift` |
| Quota / cost | `QuotaManager`, `CostProtectionService`, `UsageMeter`, `UsageSettings`, `UsageWarningManager` |
| Provider selection | `translation/chrome-mt.ts` (`googleActive`), `mt-providers.ts`, `long-text.ts`, `modules/translation/providers.ts` |
| UI | `options/UsageSection.tsx`, `SmartSetupSection.tsx`, `BillingSection.tsx`, `AccountSection.tsx`, `ui/UsageNotice.tsx`, `ui/MonthlyUsageCard.tsx`, `mobile/App.tsx`, `sidepanel/SidePanel.tsx` |
| Docs | `docs/API-KEY-SECURITY.md`, `SMART-SETUP-*.md`, `USAGE_QUOTA.md`, `MT_ENGINE_*.md`, `TRANSLATION_PROVIDER_LIMITS.md` |
| Tests | `usage.test.ts`, `account-usage.test.ts`, `smart-setup.test.ts`, `translation-usage.test.ts`, `mt-*.test.ts*` |

Coupling: the Cloud provider is **tightly coupled to the usage/cost guard** (the only path that reaches the network) and loosely to Smart Setup (which only produces the key). The other providers (native, local) do not depend on it.

## 3. Platform differences

| | Chrome extension | Android | iOS |
|---|---|---|---|
| Where the TS runs | service worker (`background/router.ts`) | same web bundle in a WebView (in-app router) | same web bundle in a WKWebView |
| Network | `fetch`, `host_permissions: <all_urls>`, no `connect-src` CSP | `fetch` from the WebView; `INTERNET` permission present | `fetch` from the WKWebView, HTTPS only (no ATS exception needed) |
| CORS | not applicable (host permission) | **applies** (page origin ≠ Google) | **applies** |
| Native code involved in Google Cloud translation | none | key vault only | key vault only |

## 4. Risks

1. **Google blocks the endpoint.** Observed in this project (benchmark: CAPTCHA page on `/m`; migration: HTTP 429 "Sorry…" on `translate_a/single` from the same network). Must be handled as a first-class state.
2. **Policy.** `translate.google.com/robots.txt` disallows `/m?` and `/translate_a`; Google's Terms forbid automated access against robots.txt. The product owner accepts this risk by choosing this migration; the code must not evade anything.
3. **Mobile CORS.** Unknown whether `translate.googleapis.com/translate_a/single` sends CORS headers (the only live answer was a 429 page without them). If it does not, the WebView call fails as `NETWORK_ERROR` on Android/iOS.
4. **Accounting.** Reusing the Cloud quota guard would show a wrong "free quota", block at 500,000 chars, or show a cost: needs an unmetered ledger.
5. **Cancellation.** Messages to the router carry no abort signal; an in-flight request cannot be aborted (same as the Cloud provider); cancellation works between chunks.
6. **Removing Smart Setup** is large and risky (OAuth, billing, tests) and Cloud BYOK remains a valid *optional* official route.

## 5. Replacement architecture (chosen)

- One shared TypeScript client (`src/modules/usage/google-web.ts`) used by all three platforms; **no native adapters, no new dependency**. A maintained library was not adopted: the Python `deep-translator` is research-only and the JS packages that wrap the same endpoint add dependency risk for a ~150-line GET + JSON parse.
- New `MtProvider` `google-web` (kind `cloud-web`, unmetered), selectable only when the user chooses *Google Dịch (web)*; same `usage:translate` path, so cache, idempotency, chunk runner and the informational ledger are reused; `CostProtectionService` gets `metered:false` for it.
- `GoogleWebGate`: one request at a time, ≥ 1.2 s spacing, timeout, one bounded retry for network errors only, 15-minute persisted cooldown after 429/403/CAPTCHA.
- Error codes `NETWORK_ERROR, TIMEOUT, RATE_LIMITED, ACCESS_BLOCKED, CAPTCHA_REQUIRED, INVALID_LANGUAGE, TEXT_TOO_LONG, TRANSLATION_FAILED, CANCELLED` mapped to message codes `gweb-<CODE>` and to the runner's fatal/retryable policy.
- Google Cloud BYOK and Smart Setup stay as an **optional advanced** provider (demoted in the UI); the default stays on-device; Cloud is never used silently.
- Out of scope / not changed: native Kotlin/Swift, OCR, dictionary, local OPUS-MT, CI workflows.
