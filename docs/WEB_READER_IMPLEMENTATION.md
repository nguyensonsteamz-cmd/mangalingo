# Web Reader – implementation status

What is done, how each part was verified, and what is **not** verified. (Nothing here claims more than was run.)

## Phases

| Phase | Result |
|---|---|
| 1 Audit | Done – see `WEB_READER_ARCHITECTURE.md`. |
| 2 Reader module | Done in code: address bar, go / back / forward / reload / stop / home, bookmarks, history, progress bar, error screen (offline, DNS, TLS, ATS…), HTTPS lock, `.URL` keyboard with a *Go* key, links and `target=_blank` stay inside (never Safari). |
| 3 Text interaction | Done in `src/reader/reader.js`: click-to-lookup, select-to-lookup, word / sentence / paragraph, context, coordinates, punctuation. |
| 4 Overlay | Done: popup near the selection (above / below / auto, 3 sizes, font size), close, save word, details (opens the Lookup screen of the app), "Dịch câu" / "Dịch đoạn", speak. |
| 5 Reuse the engine | Done: every Reader translation calls `machineTranslate()` → quota guard, cache, consent, limits. Dictionary, notebook, language checks are the app's own. |
| 6 Manga images | OCR **pick mode**: tap an image → pixels (or the app downloads the image with the page's cookies / referer) → Apple Vision → bubbles grouped like on the scan screen → numbered boxes over the image → tap a box → translation popup. |
| 7 UI | Dark SwiftUI design matching the app; toolbar: back, forward, bookmark, translate selection, OCR, library, settings; settings sheet (click / select / auto popup / position / size / font / language / OCR / home). |
| 8 Privacy | See architecture doc. |
| 9 Tests | See below. |

## Verification

| What | How | Result |
|---|---|---|
| `reader.js` behaviour | `npm run test:reader` – 18 tests in **real Chrome** with a mock `webkit` bridge: injection, click lookup, sentence context, punctuation (`demon.`, `"Run!"`, `It's`, `well-known`), links / buttons / inputs / textarea / contenteditable ignored, Vietnamese ignored, the site's own click handler still runs, select → word / sentence / paragraph, stale answers ignored, popup placement inside the viewport for 3 positions × 3 anchors × 3 sizes, settings toggles, auto-popup chip, toolbar *Translate*, scroll closes the popup, `document.body` untouched, OCR pick mode, same-origin pixels, cross-origin (no pixels → app downloads), boxes placed over the image, box tap → lookup. | 18 / 18 |
| Engine bridge | `tests/reader-bridge.test.ts` (10): word / sentence / paragraph payloads from the **real dictionary**, machine translation only when the dictionary has no Vietnamese, blocked / error cards, save to the notebook, OCR bubble grouping, and the **quota guard end to end** (Reader translations are counted, cached, blocked at the limit with nothing sent, allowed after consent). | 10 / 10 |
| Swift | Compiled by the iOS CI build (`xcodebuild`, GitHub Actions); the build also checks the app binary exists. | Compiles |
| Whole project | `npm test` (219), extension e2e. | Pass |

### NOT verified (be careful before relying on it)
* **No run on an iPhone or the iOS Simulator** – there was no Mac. The Swift code compiles, but the Reader's behaviour in `WKWebView` is untested on a device: the injected script in the `mlreader` content world, `callAsyncJavaScript` to the app page, the SwiftUI layout, keyboard handling, `fullScreenCover` over the app page, Apple Translation being asked from the page underneath.
* `reader.js` was tested in Chrome (Blink), not in WebKit. Touch selection (long-press handles, the iOS callout, `selectionchange` timing) can differ on iOS.
* **OCR on real manga is not validated.** Apple Vision and the bubble grouping have not been run on real chapters through the Reader; only the geometry / message flow is tested with synthetic images. Do not treat it as finished.
* Real websites: only local fixtures were used (article, forms, manga page). No real manga site, no site with its own reader canvas, infinite scroll, or heavy JavaScript has been tried.
* Memory use and WebView lifecycle (background / foreground, process termination) are implemented (`pauseAllMediaPlayback`, `teardown`, reload on termination) but not measured.
* The design screenshots in `demo-anh/4x-reader-*.png` are **mock-ups**: the popup and page are the real injected script in Chrome, the surrounding toolbar / sheets are drawn HTML approximating the SwiftUI design.

## Known limitations
* English → Vietnamese only.
* The script runs in the main frame only: text inside iframes is not reachable.
* Text drawn on canvas / images (some readers) can only be handled by the OCR mode; text inside closed shadow DOM is not reachable.
* Pinch-zoomed pages: the popup is positioned in layout (not visual-viewport) coordinates and can drift.
* `http://` (non-TLS) sites are blocked by iOS ATS by design.
* OCR boxes are anchored to the image when it was picked; a page that re-lays out afterwards can misalign them.
* Private browsing means site logins are not remembered between sessions.
* A Google Cloud translation from the Reader counts like any other (sentences and paragraphs cost characters; single words use the dictionary first).

## How to run the tests
```
npm run test:reader      # injected script, real Chrome
npm test                 # unit tests incl. tests/reader-bridge.test.ts
npm run build:ios-web    # regenerates ios/MangaLingo/WebReader/ReaderScript.swift from src/reader/reader.js
```
