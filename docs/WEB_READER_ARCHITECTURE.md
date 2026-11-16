# Web Reader – architecture

The Web Reader is an in-app browser for the iPhone app: open a manga / English website inside LingoLens, tap a
word or select a sentence and get the translation in a popup **on the page**, or pick a manga image and OCR it.

## Phase 1 – audit of the existing app (what was found, what is reused)

| Area | Finding | Decision |
|---|---|---|
| App shell | SwiftUI app (`MangaLingoApp`) hosting ONE `WKWebView` (`WebContainer`) with the React UI from the bundle (`app://local`). XcodeGen (`project.yml`) builds on GitHub Actions; iOS 16 deployment target. | Reader is a second, native screen presented with `fullScreenCover`; the app page keeps running underneath. |
| Translation engine | **All in JS** (`src/`): dictionary + grammar rules via the router (`usage` / `lookup`), `machineTranslate()` (Apple Translation through `Translator` shim on iPhone, optional Google Cloud). | Reused as is. The Reader has no engine: it calls `window.__mlReader` of the app page (`MainWebHub`). |
| Google Cloud + quota | `src/modules/usage/` (UsageMeter, QuotaManager, CostProtectionService, …) behind the router message `usage:translate`; `machineTranslate()` routes through it. | Every Reader translation goes through `machineTranslate()` ⇒ same meter, cache, consent and limits. Nothing bypasses it. |
| OCR | Native: `TextRecognizer` (Apple Vision) with the `ocr` bridge command; bubble grouping in JS (`groupLines`, `plausibleText`). | Reused: Swift calls `TextRecognizer`, JS groups the lines (`__mlReader.ocrBlocks`). |
| Vocabulary | `vocabStore` (chrome.storage.local shim) in the app page. | "Lưu từ" in the popup saves there (`__mlReader.save`). |
| Settings | Web `Settings` store for the app; native `UserDefaults` was unused. | Reader settings are native (`WebReaderSettings`, `UserDefaults`) because the Reader UI is native. |
| Existing screens | Scan page (Vision OCR of a picked image / screenshot), Lookup, Vocabulary, Settings. | Untouched. The only changes in existing files: the `openReader` bridge command, `MainWebHub.web`, a Home card, the `fullScreenCover`. |

## Components

```
Home card "Trình đọc web" ──openReader──▶ ReaderPresenter ──fullScreenCover──▶ WebReaderView (SwiftUI)
                                                                                  │
 WebReaderViewModel ◀───────── state (url, progress, error, selection…) ◀────── WebReaderController ── owns WKWebView (non-persistent store)
                                                                                  │  WKUserScript (content world "mlreader")
                                                                                  ▼
                                                                  src/reader/reader.js  (ReaderScript.swift)
                                                    click / select lookup · popup (closed shadow root) · OCR pick mode
                                                                                  │ webkit.messageHandlers.mlr
                                                                                  ▼
                                                                         WebContentBridge ─▶ WebReaderController.handle
                                                                                  │
                                           WebTranslationOverlay ──▶ MainWebHub.call("lookup" / "save" / "ocrBlocks" / "openDetails")
                                                                                  │ callAsyncJavaScript (app page, content world .page)
                                                                                  ▼
                                                    window.__mlReader  (src/mobile/reader-install.ts → reader-bridge.ts)
                                      router lookup · machineTranslate() [quota guard] · vocabStore · groupLines
```

| Spec module | File |
|---|---|
| `WebReaderView` | `ios/MangaLingo/WebReader/WebReaderView.swift` (+ `WebReaderSheets.swift`: library, settings) |
| `WebReaderViewModel` | `WebReaderViewModel.swift` (also `ReaderPresenter`) |
| `WebReaderController` | `WebReaderController.swift` |
| `WebNavigationManager` | `WebNavigationManager.swift` (+ `WebLibrary`: bookmarks, history) |
| `WebContentBridge` | `WebContentBridge.swift` (`MainWebHub`, `JS`, script message handler) |
| `WebTranslationOverlay` | `WebContentBridge.swift` (look-up orchestration) + the popup in `src/reader/reader.js` |
| `WebReaderSettings` | `WebReaderSettings.swift` |
| Engine side | `src/mobile/reader-bridge.ts`, `src/mobile/reader-install.ts` |

### Why the popup lives in the page, and the engine in the other web view
A native view cannot be drawn *inside* a website, and a popup next to the selection must follow the text. The
injected script draws it (one `<mangalingo-reader>` element, closed shadow root). The engine already exists in
JS in the app page, so the Reader asks that page instead of duplicating it.

### Messages (page → Swift, `webkit.messageHandlers.mlr`)
`ready`, `lookup {id,text,context,mode,rect}`, `save {id,word,context}`, `details {text,context}`, `speak {text}`,
`selection {has}`, `ocrImage {id,src,dataUrl?,rect}`, `ocrCancel`.
Swift → page (`window.__mlr`): `configure(settings)`, `show(payload)`, `hide()`, `saved(id,ok,msg)`,
`ocrMode(on)`, `ocrResult({id,blocks|error})`, `translateSelection()`, `toast(msg)`.
Each lookup carries an `id`; an answer for an older id is ignored.

## Privacy & security
* The page is never read or uploaded: only the clicked word / selected text (and its sentence as context) is sent, to the app's own engine.
* The reader script lives in its own `WKContentWorld`: site JavaScript cannot see it, and its listeners are passive and never stop or prevent the site's events (except while the user is explicitly picking an image for OCR).
* The browser uses `WKWebsiteDataStore.nonPersistent()`: no cookies, logins or caches survive; passwords are never stored; the app's own data (vocabulary) lives in the default store of the other web view and cannot be reached.
* Top-level navigation is limited to `http(s)`; `javascript:`, `file:`, `data:` etc. are refused in the address bar and in links. `http://` pages are blocked by iOS App Transport Security (the error says so). A search query typed in the address bar goes to DuckDuckGo.
* Bookmarks / history store titles and URLs only (JSON in Application Support).
* No API keys in the source. Google Cloud is the optional provider with its own key handling and quota protection (see `USAGE_QUOTA.md`).
* The Reader does not emulate browser security UI beyond showing a lock for `https`.
