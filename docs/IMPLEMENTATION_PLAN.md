# LingoLens – Implementation Plan

Status legend: `TODO` · `DONE` · `PARTIAL` · `BLOCKED`. The final status of every phase is recorded in
[TESTING.md](TESTING.md) and the delivery report in [README.md](../README.md).

## Phase 0 – Audit (DONE)
- Working directory `d:\extension` was empty → new project, `git init`.
- Toolchain: Node 24.18, npm 11.16, Chrome 157 (Windows 11).
- Data sources checked for licences before packaging (see [DICTIONARY.md](DICTIONARY.md)):
  - WordNet 3.1 (`wordnet-db`) – WordNet License (permissive, notice required).
  - CMU Pronouncing Dictionary (`cmu-pronouncing-dictionary`) – BSD-style / ISC wrapper.
  - Tesseract `eng` LSTM traineddata (`@tesseract.js-data/eng`, 4.0.0_best_int) – Apache-2.0.
  - **No open-licensed, large English→Vietnamese dataset is available as a package.** A hand-authored
    *Starter* dataset is shipped and clearly labelled; a JSON/CSV import pipeline lets users add larger
    datasets they are licensed to use.

## Key technical decisions
| Decision | Reason |
|---|---|
| Tailwind **3.4** (not 4) | v4 relies on `@property`, which is ignored inside Shadow DOM. |
| rem → px PostCSS transform | Host pages often change `html { font-size }`; px keeps the in-page UI stable. |
| Two Vite builds (ESM pages/worker + IIFE content script) | MV3 static content scripts cannot be ES modules. |
| OCR in an **offscreen document** | Pages cannot spawn workers from `chrome-extension://` URLs; the service worker cannot use DOM/canvas. |
| Image acquisition: canvas → background fetch → `captureVisibleTab` crop | Manga CDNs rarely send CORS headers; capture works for any pixels on screen. |
| Dictionary/translation run in the **service worker** | One cache for all tabs; shards are fetched lazily from the package. |
| WordNet split into lazily loaded shards | ~30 MB of raw data must not be parsed on every lookup. |
| No AI / no network APIs | Requirement: local-first Dictionary Mode. |

## Phases – final status (v0.1.0)

| Phase | Status | Notes |
|---|---|---|
| 1. Architecture & build | DONE | Two-pass Vite build, MV3 manifest, generated icons, data pipeline |
| 2. DOM reader | DONE | Click + selection, editable/interactive detection, hit-tested word picking |
| 3. Manga OCR | DONE (English horizontal) / PARTIAL (vertical, SFX, other languages) | Registry ready; data not bundled |
| 4. Dictionary engine | DONE | Vietnamese coverage PARTIAL: 946 curated Starter entries + user import |
| 5. Translation & language | DONE (Dictionary Mode) | Natural translation BLOCKED without an MT model (out of scope) |
| 6. Floating popup | DONE | Word / Phrase / Sentence / Paragraph / OCR / unsupported-language views |
| 7. Reading sidebar | DONE | Panel width is controlled by Chrome (content-width setting instead) |
| 8. Settings center | DONE | Validated, live-applied, per-section and global reset |
| 9. Vocabulary storage | DONE | JSON/CSV export/import, quota handling |
| 10. Design system | DONE | Tokens, components, icons, dark/light, reduced motion |
| 11. Privacy & security | DONE | Closed shadow root, trusted-input OCR, no cookies, no external requests (verified) |
| 12. Testing | DONE | 140 unit/integration + 39 E2E in Chrome 157 – see TESTING.md |
| 13. Documentation & delivery | DONE | dist/ loadable via Load unpacked |

Typecheck, tests and builds were run repeatedly during development (results of the final run are in
TESTING.md). Defects found by tests were fixed in the code. Four test expectations were corrected because the
expectation itself was wrong: a misspelling recovered by a valid morphological rule ("destroied" → destroy),
"No way!" being exclamatory rather than a fragment, images over 12 MP being intentionally downscaled, and
contrast-stretch percentile parameters in a unit test.
