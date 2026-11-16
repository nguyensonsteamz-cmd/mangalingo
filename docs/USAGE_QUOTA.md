# Translation quota & cost protection

LingoLens translates **on the device by default** (Chrome Translator API, Apple Translation on iPhone, ML Kit on
Android). That path is free and is **never metered**.

The optional **Google Cloud Translation** provider (Settings → Hạn mức dịch → "Google Cloud") bills per character
beyond the free monthly quota. Everything in `src/modules/usage/` exists so that it cannot be used by accident.

## What is tracked (locally)

Characters submitted (Unicode code points of the normalised text, whitespace included, as Google bills), requests,
cache hits (never counted as usage), failed requests, estimated billable characters and cost, monthly totals and a
monthly history. Data lives in `chrome.storage.local` (`usage:*` keys) on the device.

> **These are locally tracked estimates. They are not Google Cloud Billing data.** Google's billing can be delayed,
> and local limits cannot guarantee that no charge will ever occur. Set a Budget & alert and API quotas in Google Cloud.

## Defaults (all configurable)

| Setting | Default |
|---|---|
| Provider | on-device (Google off) |
| Free monthly quota | 500,000 characters |
| Warning / critical / hard stop | 80 % / 95 % / 100 % |
| Price estimate | USD 20 per 1M characters |
| Paid translation | **off**, never switched on automatically |
| Max paid characters per month | 100,000 |
| Max estimated monthly cost | USD 2 |
| Max characters per request | 5,000 |
| Max paid requests per day | 200 |

Limits can never be 0 or unlimited: consent is never open-ended.

## Request protection

For every Google request: normalise → cache → count characters → free quota → paid authorisation → limits → cost
estimate → (confirmation) → **reserve** → send → record. The check and the reservation run inside one lock in the
background (extension) / in-app router, so simultaneous translations cannot pass the check together. Identical texts
in flight share one request. A failed request keeps its characters counted (the API may have processed them).

At 80 % a quiet note appears, at 95 % a prominent warning, at 100 % requests that could be billed are blocked with
**Stop translation / Allow paid translation**. Allowing shows the estimated extra characters and cost first and is
persisted; it can be withdrawn at any time and the limits above still apply.

## Monthly reset

The counters reset when the **calendar month** (local time) changes, detected on every access (not by a timer); the
finished month moves to the history. A restart never resets, and a clock / time-zone change that moves backwards
never resets or loses usage.

## API key security

* The key is entered by the user, stored only on the device and sent only to `translation.googleapis.com`.
  It is never in the source code, never exported (usage reports contain no key), never echoed in error messages.
* In Google Cloud Console → Credentials: restrict the key to **Cloud Translation API** and add application
  restrictions that fit where you use it.
* Service-account credentials are **not** used by this app and must never be put into it.
* Use Billing → Budgets & alerts and API Quotas: those are the real cost controls.

## Tests

`tests/usage.test.ts` (thresholds 79/80/95/99/100 %, concurrency, cache, failures, month rollover, consent, spend
limits, persistence, reset, Unicode counting) and `scripts/e2e.mjs` (Settings page).
