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

---

## Cập nhật 2026-11-23: Google Cloud và OPUS-MT đã được gỡ hẳn

Theo yêu cầu "bỏ mô hình OPUS và Google, Google Dịch thay thế cho Google":

- **OPUS-MT (mô hình tải về)** đã xoá: `src/modules/mt/local`, giao diện tải mô hình, router/offscreen, thư viện `@huggingface/transformers`, runtime ONNX, job `simulator-probe` của iOS (chỉ kiểm tra mô hình đó), các test và script liên quan. Bản build extension giảm từ 47,6 MB còn 36,3 MB.
- **Google Cloud Translation** đã xoá: client `google.ts`, Smart Setup (OAuth, Cloud Console, tạo khoá), lưu khoá, hạn mức miễn phí / tính phí / chặn khi vượt hạn mức, màn Billing và Tài khoản, cổng **đăng nhập Google bắt buộc** (AuthGate), quyền `identity` và khối `oauth2` của manifest.
- Còn lại **hai nguồn dịch**: trên máy (Chrome Translator / Apple Translation / ML Kit, mặc định) và Google Dịch (web, không chính thức). Cài đặt → **Nguồn dịch** chỉ còn lựa chọn này và bộ đếm cục bộ.
- Dữ liệu cũ được dọn: khoá API, id credential, bản ghi đăng nhập, mục bí mật của khoá cũ bị xoá khi service khởi động; provider cũ `google` được đọc thành "trên máy" (không bao giờ gửi văn bản đi bất ngờ).
- Khi Google Dịch (web) bị chặn, ứng dụng **không tự chuyển** sang nguồn khác: hiện lỗi rõ ràng, người dùng tự chọn lại "Trên máy".

### Kiểm tra sau khi gỡ (2026-11-23)

| Hạng mục | Kết quả |
|---|---|
| `tsc --noEmit` | sạch |
| `vitest run` | **310 pass / 24 file** (các test của Cloud, Smart Setup, đăng nhập, hạn mức, OPUS-MT được xoá hoặc viết lại cho Google Dịch web) |
| `npm run build`, `build:mobile`, `build:ios-web` | OK; bundle không còn `translation.googleapis.com`, `opus`, `onnx`; manifest không còn `identity` |
| `npm run e2e` (Chrome thật) | **46–48/48 tuỳ lần chạy**; chỉ các bước dùng chuột thật / chụp tab (kéo popup, kéo viền bong bóng, chụp `captureVisibleTab`, "Tắt bong bóng") thay đổi giữa các lần, hai bước đó không liên quan đến phần dịch; các bước về Nguồn dịch, cổng đăng nhập đã gỡ, manifest đều pass. Trước khi gỡ: 50/50. **Chưa phân biệt được flaky hay hồi quy** |
| Android Gradle, iOS Xcode | **chưa chạy** (không có toolchain; chờ CI) |

### Còn sót (cố ý, chưa xoá)

- Mã native chỉ còn là code chết: `android/.../GoogleAuth.kt`, `SecretVault.kt`, intent-filter `oauth2redirect` + biến `LINGOLENS_OAUTH_ANDROID_CLIENT_ID` trong `build.gradle.kts`, `ios/MangaLingo/Setup/*`, các hàm cầu nối `secret*`/`oauth*` trong `src/mobile/native.ts`. Không xoá vì không thể biên dịch Android/iOS trên máy này; nên gỡ sau khi CI biên dịch được.
- Các loại `cloud-byok` / `local-model` trong `src/modules/mt` là phần tổng quát của registry (còn dùng trong test), không còn provider nào dùng.
- Tài liệu lịch sử `MT_ENGINE_*`, `TRANSLATION_*` được gắn banner "đã gỡ", không viết lại.

### Mặc định = Google Dịch (web) (2026-11-23, theo yêu cầu của chủ dự án)

- `DEFAULT_USAGE_SETTINGS.provider` là `google-web` trên Chrome, Android và iOS. Cài mới gửi văn bản dịch tới Google ngay từ lần dịch đầu; `docs/PRIVACY.md` và trang *Nguồn dịch* nói rõ điều này.
- Người đã chọn "Trên máy" giữ nguyên lựa chọn. Provider `google` (Cloud) cũ được đọc thành `google-web`.
- Hệ quả cần biết: khi Google chặn (như đã gặp trên mạng thử nghiệm), một bản cài mới **không dịch được** cho tới khi người dùng chọn "Trên máy": ứng dụng không tự chuyển nguồn. Nếu muốn tự động dùng bộ dịch trên máy khi Google bị chặn, đó là một thay đổi riêng (cần quyết định vì nó thay đổi chuyện văn bản có rời máy hay không).
- Bộ test và e2e ghim "Trên máy" khi chạy để không gửi request thật tới Google; chỉ bước "Nguồn dịch" kiểm tra mặc định.
