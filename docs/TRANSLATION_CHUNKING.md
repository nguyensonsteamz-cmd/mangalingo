# Long-text translation: chunking

Code: `src/modules/translation/` (chunker, providers, runner), glue in `src/translation/long-text.ts`, wiring in `src/translation/chrome-mt.ts`, UI in `src/ui/MachineTranslation.tsx`.

## Before / after
| Before | After |
|---|---|
| `machineTranslate` cut the text at 4,000 characters, **silently**; the look-up cut it at 6,000 / 1,200 for analysis and the translation block received the cut text | Any length up to an application safety limit (500,000 characters, an explicit error beyond it, never a silent cut) |
| one request, no progress, no cancel, no per-part retry | chunks, ordered merge, progress, cancel, per-chunk retry, "retry failed parts" |

## Splitting (`splitIntoChunks`)
* Sizes are in **Unicode code points** (what Google counts). Target ≈ 4,800, hard ceiling = the provider's limit (5,000).
* **Lossless**: `prefix + source + suffix` of all chunks, concatenated, equals the input (tested with random inputs): nothing dropped, nothing duplicated, whitespace and paragraph breaks kept.
* Boundary preference: paragraph break > sentence end (incl. closing quotes, `。！？…`) > line break > clause punctuation > whitespace > hard cut. A boundary must fill a minimum share of the target (paragraph 80 %, sentence 50 %, …) so chunks do not get needlessly small.
* A cut never lands inside a surrogate pair, a combining sequence (decomposed Vietnamese), a ZWJ emoji sequence or before a variation selector.
* The provider **byte** limit is respected too (a code point is at most 4 UTF-8 bytes → `maxChars ≤ maxBytes / 4`).

## Running (`translateLong`)
* Sequential or controlled concurrency (Google: 2, device: 1).
* **Retries per chunk**: up to 3 attempts, exponential backoff with jitter, `Retry-After` honoured. 429 / 408 / 5xx / network are retried; 400 / 401 / 403 / 404 are **fatal** (the same request would fail, and so would every other chunk); a quota block is fatal too: nothing more is sent.
* **Idempotency key** per chunk = `jobId:index:hash(text)`; the usage counter counts a key once, so a retry — or "retry failed chunks" — never counts twice.
* **Cancellation** (`AbortSignal`): stops scheduling, interrupts a retry wait, keeps what already finished. A request that completes after the cancel is still counted (the provider did process it) and cached, so resuming does not pay for it again.
* **Progress**: `{status, total, completed, failed, retrying, inFlight, charsDone, charsTotal}` after every change; the UI shows "Đang dịch phần 5/10 · 40 %" with a cancel button.
* **Result**: `{text (merged in order), complete, cancelled, chunks, outcomes[], failedIndexes}`. A failed chunk keeps its ORIGINAL text in the merged result and is listed; the UI says so and offers "Thử lại phần lỗi" / "Dịch tiếp".

## Provider-specific limits
See `TRANSLATION_PROVIDER_LIMITS.md`.

## Look-up integration
`lookup()` caps the dictionary / grammar **analysis** (6,000 characters, 1,200 per sentence) but returns `fullText` with the whole input; the translation block translates `fullText`. The sidebar says "Phân tích chi tiết áp dụng cho N ký tự đầu; bản dịch bao gồm toàn bộ M ký tự". A text file loaded into the sidebar is no longer cut at 6,000 characters.

## Known limitations
* Line breaks inside a chunk are kept (`normalizeChunk`), but a translation engine may reflow them.
* A text above 500,000 characters is refused with a message (configurable `maxTotalChars`).
* The sentence analysis (words, grammar) still covers only the first part of a very long text.
