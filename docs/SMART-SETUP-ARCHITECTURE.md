# Lingolens Smart Setup – architecture

BYOK (bring your own key): the user's own Google Cloud project and billing account pay for translation.
Lingolens has no shared key, no backend, and never sees the user's key. Smart Setup only automates the setup
of the **optional** Google Cloud Translation provider; on-device machine translation stays the default and works
without any Google connection.

## Phase 1 – audit (what exists)

| Area | Chrome extension | iPhone | Android |
|---|---|---|---|
| UI | React (`src/options`, `src/ui`) | same React UI inside `WKWebView` | same React UI inside `WebView` |
| Native layer | service worker (`src/background`) | SwiftUI + `WKScriptMessageHandlerWithReply "ml"` | Kotlin `Bridge` (`@JavascriptInterface`) |
| Translation | on-device `Translator` API, optional Google (usage module) | Apple Translation, optional Google | ML Kit, optional Google |
| Google provider + quota | `src/modules/usage` (meter, quota, consent, limits) – router message `usage:translate` | same code in the in-app router (`src/mobile/engine.ts`) | same |
| API key storage (before) | **plaintext** in `chrome.storage.local` (`usage:apikey:v1`) | plaintext in localStorage | plaintext in localStorage |
| OAuth | none | none | none |
| Backend / Lingolens account | none | none | none |
| Manifest | `host_permissions: <all_urls>`, no `identity` | – | `INTERNET` permission |

Reusable: usage module (meter, quota, cache, consent), the React settings shell and Liquid Glass components,
the router / message contract, the bridge patterns.

## Phase 2 – design

### Three separate things (never mixed)
| Concept | Used for | Where it lives |
|---|---|---|
| **Google OAuth** access token | only during setup: list / create projects, enable APIs, read billing state, create the API key | memory only; discarded and revoked at the end of setup; never persisted |
| **API key** (Cloud Translation Basic v2) | signs translation requests | OS secure storage (see below) |
| **Billing account** | pays for translation | the user's Google account; Lingolens only *reads* whether the project has billing and never links / creates one |

### Shared core (`src/modules/smart-setup/`)
* `errors.ts` – error codes (`GOOGLE_AUTH_FAILED`, `INSUFFICIENT_PERMISSIONS`, `PROJECT_NOT_FOUND`, `BILLING_NOT_ENABLED`, `TRANSLATION_API_DISABLED`, `API_KEY_GENERATION_FAILED`, `INVALID_API_KEY`, `API_KEY_RESTRICTED`, `QUOTA_EXCEEDED`, `BILLING_ACCOUNT_SUSPENDED`, `NETWORK_ERROR`) with cause, fix, console link, and a mapper from Google error responses.
* `google-cloud.ts` – REST client: Resource Manager v3, Service Usage v1, Cloud Billing v1, API Keys v2, Translation v2 (validation).
* `SmartSetupFlow.ts` – the step machine (intro → connect → project → billing → api → key → validate → done) with a persisted, **non-secret** state; any step can be retried on its own.
* `OAuthProvider` – per-platform sign-in (below). `SecretStore` – per-platform secure storage (below).

### Flow and what is automated
1. **Connect** – OAuth sign-in. Scope: `https://www.googleapis.com/auth/cloud-platform` (the narrowest scope that covers Resource Manager, Service Usage, API Keys and Billing reads) + `email` to show which account is connected. No Gmail / Drive / profile data.
2. **Project** – `projects:search` (list), `POST /v3/projects` (create, long-running operation, polled). The user can pick an existing project.
3. **Billing** – `GET /v1/projects/{id}/billingInfo`. If billing is not enabled the user is sent to the Console page (`billing/linkedaccount?project=ID`) and confirms; **never automated** (it can start paid service).
4. **APIs** – Service Usage: read the state of `translate.googleapis.com` and `apikeys.googleapis.com`, enable what is missing (`:enable`, polled).
5. **Key** – API Keys API `POST …/keys` with `displayName: "Lingolens-Translation"` and `restrictions.apiTargets = [translate.googleapis.com]`, then `GET …/keyString`. An existing Lingolens key can be reused or replaced (the old one deleted on request).
6. **Validate** – one real `POST /language/translate/v2` with the new key. Only a successful translation marks the setup complete. Failures are mapped to the error codes above.
7. **Save & activate** – the key goes to the secure store (never shown again, only its last 4 characters), the usage provider switches to `google`, the OAuth token is revoked and dropped.

Not automated on purpose: billing linking; choosing / changing quotas; Cloud Translation **Advanced (v3)** – it needs IAM (OAuth user credentials or a service account), not an API key, so the flow is v2 only and never switches to v3 by itself.

### Platform specifics
| | OAuth | Secret storage |
|---|---|---|
| Chrome | `chrome.identity.getAuthToken` with an **extension-type OAuth client** (no secret exists for this client type; Chrome keeps the token, we revoke it) | AES-GCM with a **non-extractable** WebCrypto key kept in IndexedDB; only ciphertext in `chrome.storage.local` |
| iPhone | `ASWebAuthenticationSession`, Authorization Code + **PKCE**, **iOS-type** client (no secret), token exchange from the app | **Keychain** (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) |
| Android | system browser (`ACTION_VIEW`, never an embedded WebView), Authorization Code + **PKCE**, **Android-type** client, custom-scheme redirect, token exchange from the app | **Android Keystore** AES-GCM key; ciphertext in app-private SharedPreferences |

The JS UI reaches the native parts through the existing bridges (`ml` handler on iOS, `MangaLingoNative` on Android); the
Chrome parts run in the extension pages.

### Developer prerequisites (cannot be automated – reported honestly)
* OAuth **client IDs are public identifiers, not secrets**, but they must exist: create one OAuth client per platform in a Google Cloud project owned by the app developer, and configure the consent screen. `cloud-platform` is a sensitive scope: until the consent screen is verified Google allows up to 100 test users.
* The developer's project must have the **Cloud Resource Manager, Service Usage, API Keys and Cloud Billing APIs enabled** (admin calls made with a user's token are attributed to the OAuth client's project; these admin APIs are free). Lingolens never pays for translation.
* Client IDs are injected at build time (`LINGOLENS_OAUTH_CHROME_CLIENT_ID`, `LINGOLENS_OAUTH_IOS_CLIENT_ID`, `LINGOLENS_OAUTH_ANDROID_CLIENT_ID`). Without them Smart Setup says "chưa cấu hình" and the existing manual key entry keeps working.
* No client secret is used or stored anywhere.

### Cross-device sync
There is no Lingolens account or backend, so nothing is synchronised. By design credentials are per device (never copied); the choice of translation mode is stored per device.

## Security rules
* No key in source, manifest, or config files; client IDs only (public).
* The API key never leaves the device except in requests to `translation.googleapis.com`; never sent to a Lingolens server (none exists).
* The key is restricted to the Translation API at creation; we recommend adding an application restriction in the Console.
* Usage numbers stay labelled as local estimates (see `USAGE_QUOTA.md`).
