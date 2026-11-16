# Unified translation provider + registry

Code: `src/modules/mt/` (interface, registry, local model), `src/translation/mt-providers.ts` (the app's providers + selection),
`src/translation/chrome-mt.ts` + `src/translation/long-text.ts` (entry points used by every screen).

## The interface (`MtProvider`, `src/modules/mt/types.ts`)
| Member | Meaning |
|---|---|
| `id`, `kind` (`native` / `local-model` / `cloud-byok`), `label`, `modelId` | who translates; the exact checkpoint for models |
| `capabilities` | `pairs`, `platforms`, `local` (text never leaves the device), `metered`, `cancellable`, `streaming`, `needsDownload` — **providers do not all support the same things; callers check this** |
| `resources` | measured download / disk / peak RAM (models) |
| `limits` | chunk sizes in characters (API: 4,800 / 5,000; local model: 800 / 900 per call, ≤ 512 tokens) |
| `availability(pair)` | `available` · `downloadable` · `downloading` · `unavailable` · `unsupported` |
| `prepare(pair, onProgress)` | download / warm a model — only called after the user agreed |
| `translate({ text, pair, signal, timeoutMs, idempotencyKey, keepBreaks, onProgress })` → `{ text, providerId, modelId, pair, chars }` | the normalised request / response |
| `dispose()` | free memory |

Errors are `MtError` with a code: `unsupported-pair`, `unavailable`, `needs-download`, `timeout`, `aborted`, `blocked` (quota), `no-provider`, `provider-error`.

## Registered providers
| id | kind | pairs | platforms | notes |
|---|---|---|---|---|
| `google-v2` | cloud-byok | en→vi, vi→en | all | the user's own key; every request goes through the usage / cost guard (`usage:translate`) |
| `device-chrome` | native | en→vi, vi→en | Chrome extension | Chrome Translator API; model download is Chrome's own (needs a user gesture) |
| `device-mlkit` | native | en→vi, vi→en | Android | ML Kit; one translator per direction |
| `device-apple` | native | en→vi, vi→en | iPhone (iOS 18+) | Apple Translation; separate queue + session per direction (Swift: compiled only by CI) |
| `local-opus-mt` | local-model | en→vi, vi→en | Chrome, Android (iOS not offered, see deployment) | downloaded on demand; ONNX Runtime Web (WASM) in a worker |

## Selection rules (`ProviderRegistry.select`) — privacy / cost rules, not options
1. Only providers that support the **pair** on this **platform** are candidates.
2. `preferred = <id>`: exactly that provider. If it is unusable the request **fails with the reason**. The only fallback is *cloud → local* (text then stays on the device), never *local → cloud*.
3. `preferred = 'auto'`: **local providers only**, by priority (native first = today's behaviour, then a downloaded model). A cloud / metered provider is never chosen automatically.
4. A cloud-byok provider needs a valid key; the quota guard still decides every request (consent, limits). A blocked / fatal / aborted error never moves to another provider.
5. A model that LingoLens itself would download (`local-model`) is never downloaded implicitly: the call fails with `needs-download` and the UI shows the size + a button.
6. The response says which provider and model translated (`providerId`, `modelId`); the translation block shows the provider's name.

How the app uses it: `resolveDevice(pair)` (mt-providers.ts) is called once per job. Google (when the existing usage setting says so) keeps its dedicated quota-guarded path; everything on-device goes through the registry. The user preference `mt.prefs.preferred` (`auto` default | `local`) is stored in `chrome.storage.local` and set from Settings → Hạn mức dịch → *Mô hình dịch tải về*.

## Usage accounting per provider
* Google: unchanged ledger (`google-v2|<credential>`, UTC month, success-only, idempotent). The language pair is part of the cache key (en→vi keeps the old plain key so existing cache entries stay valid) and of the in-flight key.
* On-device (native and model): informational ledgers `device-chrome|local`, `device-apple|local`, `device-mlkit|local`, `device-local|local`. Never counted as Google, never billed.

## Router messages (service worker / in-page router)
`mtlocal:cached | start | status | translate | release | remove | cancel | verify` → `LocalHost` (offscreen document in the extension; in-page worker in the phone apps). Downloads are *start + poll status* (a service worker cannot hold a multi-minute call).
