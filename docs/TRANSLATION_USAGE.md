# Monthly translation usage

Code: `src/modules/usage/` (meter, repository, quota, cost protection, service), UI `src/ui/MonthlyUsageCard.tsx` and Settings → Hạn mức dịch. Same logic and same card on Chrome, iPhone and Android (one shared codebase).

> Everything here is a **local estimate** kept on this device for requests made through LingoLens. It is not Google's billing meter. Usage of the same key elsewhere, or on other devices, is not visible.

## What is counted
* **Source characters** (code points of the text that was sent), never the translated output. Whitespace and punctuation count as they are in the request (after NFC normalisation and whitespace collapsing, which is what is actually sent).
* Only **successfully processed** requests, each chunk **exactly once** (idempotency key). A failed attempt, a failed retry or a cancelled request counts **nothing** (a separate informational "failed" counter exists).
* A cache hit is not new usage (separate "cached" counter). Identical requests in flight share one call.
* `operations` = finished translation jobs (a long text with many chunks = 1); `requests` = successful provider requests (= chunks).
* In flight, a request is **reserved** (inside one lock) so simultaneous chunks cannot pass the quota check together; a failure / cancel releases the reservation.

## Ledgers: providers and credentials are separate
One ledger per **provider + credential + month**: `google-v2|<project id or key hash>` and, informationally, `device-chrome|local`, `device-apple|local`, `device-mlkit|local`. Local (on-device) translation is **never** counted as Google usage, never charged, and never added into the Google figures.
* Smart Setup keys use the **project id** as credential (a replaced key in the same project keeps its ledger, like Google's per-project quota); a manually entered key uses `key-<first 8 hex of SHA-256>` (does not reveal the key).
* Changing to another credential starts a new ledger; the old one stays in the history.
* **BYOK only.** LingoLens provides no shared API key, so there is no shared-key mode and no server-authoritative counter (it would need a backend, which this project does not have). Counters on the device are never presented as authoritative.

## Monthly period
Billing month and the display reset follow **UTC**: the counters reset at **00:00:00 UTC on the 1st** of each month, the same instant in every time zone, detected on every access (never only by a timer). Finished ledgers move to the history and are never deleted. A restart does not reset; a clock moving backwards never resets or loses data. Old (v1, local-time) data is migrated into the Google ledger of the default credential.

## Warnings (configurable)
80 % approaching the quota · 90 % high usage · 100 % quota reached. At 100 % requests that could be billed are **blocked**: the user chooses *Dừng dịch* (switch to on-device translation), *Cho phép dịch có phí* (explicit consent, with an estimate, billing check and the configured limits), or changes the key. The provider is **never switched silently**.

## Estimated cost
Shown only for a metered provider (Google BYOK) with a configured price; never for on-device providers.

## Security
Keys live in secure storage (see `API-KEY-SECURITY.md`); the usage state, exports and credential ids never contain a key.
