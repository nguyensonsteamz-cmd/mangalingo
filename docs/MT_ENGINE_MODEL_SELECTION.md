# Model selection

> **Lịch sử / Historical (2026-11-23):** Google Cloud Translation (khoá API, Smart Setup, đăng nhập Google, hạn mức, thanh toán) và mô hình OPUS-MT tải về đã được **gỡ khỏi LingoLens**. Nguồn dịch hiện có: dịch trên máy (mặc định) và Google Dịch (web, không chính thức). Nội dung bên dưới chỉ còn giá trị lịch sử. Xem [google_translate_unofficial_migration_report.md](google_translate_unofficial_migration_report.md).


Decision: integrate **OPUS-MT (Marian) q8, one checkpoint per direction**, as an **optional, user-downloaded local provider** that supplements — does not replace — Chrome Translator, Apple Translation, ML Kit and Google BYOK.

## Checkpoints (exact)
| Direction | Runtime artefact (downloaded) | Converted from | Licence (model card, read 2026-11-16) |
|---|---|---|---|
| en→vi | `Xenova/opus-mt-en-vi` @ `30bcd461c0d7338ad106b36314d3eedc2d4e998c`, ONNX **q8**, 102 MB | `Helsinki-NLP/opus-mt-en-vi` @ `989c9fb9ec63987901022baf0182dcec3e149be6` | **Apache-2.0** |
| vi→en | `Xenova/opus-mt-vi-en` @ `541dfd72ec07e8f1563795e0224408ad8d729e80`, ONNX **q8**, 102 MB | `Helsinki-NLP/opus-mt-vi-en` @ `c8d2853e77f5fae31124d993e0b35176b1c8914e` | **Apache-2.0** |
Runtime: ONNX Runtime Web 1.22 (MIT) through `@huggingface/transformers` 3.7.6 (Apache-2.0). *The framework's licence and the checkpoint's licence are separate; both were checked.*
Caveats that remain (commercial-use risk is lowered, not zero): the Xenova ONNX repos carry no licence text of their own (they inherit the upstream Apache-2.0 card); the OPUS training corpora are a mix of corpora with their own licences (the weights are released under Apache-2.0 by Helsinki-NLP). Attribution: credit Helsinki-NLP / OPUS and Xenova in the app's third-party notices. **This is an engineering reading of the cards, not legal advice** — have the licence reviewed before a commercial release.

## Gates and minimums (fixed before looking at the ranking)
1. **Commercial licence gate** (not a score): checkpoint **and** weights licence permits commercial use, and the training-data terms do not forbid it.
2. **Evidence gate**: measured results in both directions.
3. **Minimums** to be worth shipping on phones: peak RSS < 1,000 MB, download ≤ 150 MB per direction, p95 per sentence < 3 s, repeated-4-gram rate < 2 %.

## Candidates
| Candidate | Licence gate | Evidence | Minimums | Result |
|---|---|---|---|---|
| **OPUS-MT q8** | pass (Apache-2.0) | both directions | **pass** (604 MB, 102 MB, p95 1.4 s) | **selected** (weighted score in table T5) |
| M2M-100 418M q8 | pass (MIT) | both directions | **fail** (≈ 2.7 GB RSS, 610 MB, p95 ≈ 5–9 s) | rejected: unusable on a phone |
| EnViT5-translation q8 | **fail / unproven**: OpenRAIL weights, but trained on **PhoMT**, whose terms allow *"research or educational purposes only"* and forbid redistribution; MTet terms not verified | both directions | fail (RSS 1.2 GB, 305 MB) | rejected on licence. It has the best vi→en quality in the test; revisit only if VietAI / VinAI confirm commercial use in writing |
| NLLB-200 | **fail** (CC-BY-NC-4.0) | – | – | excluded; no numbers produced |
| VinAI vinai-translate | **fail** (AGPL-3.0) | – | – | excluded; no numbers produced |
| MADLAD-400 3B | pass (Apache-2.0) | **none** (BLOCKED, could not run here) | would fail on size (3 GB int8) | not selected; no invented numbers |
| M2M-100 1.2B | pass (MIT) | **none** (BLOCKED) | would fail (larger than the 418M that already fails) | not selected |
| Chrome Translator | not a distributable model | baseline measured | n/a | **kept as the default**; best quality / speed of everything measured |

## Why OPUS-MT
* It is the **only candidate that is both commercially licensable and small enough for a phone** (102 MB / direction, ≈ 0.6 GB RAM, ≈ 0.6 s per sentence on a laptop CPU).
* Weighted score among eligible candidates: see table T5 below (quality 35 · latency 20 · RAM 15 · size 10 · platform compat 10 · long text 10). With only two eligible candidates min-max normalisation exaggerates differences (OPUS-MT gets 0 on quality, M2M-100 100), so the *minimums* are what actually decide: M2M-100 is rejected because it fails them, not because of the weights. Even with 100 % weight on quality M2M-100 would only gain ≈ 3 chrF++ on average (52.1 vs 49.1) while needing 4.5× the RAM.

### T5 – Weighted selection (only candidates with a verified commercial licence, measured in both directions)

| Model | weighted score | quality | latency | RAM | size | compat | long text | meets minimums |
|---|---|---|---|---|---|---|---|---|
| OPUS-MT | **65** | 0 | 100 | 100 | 100 | 100 | 100 | yes |
| M2M-100 418M | **38.3** | 100 | 0 | 0 | 0 | 33 | 0 | NO |


## What this selection does *not* say
* OPUS-MT is **not better than what the app already has**: Chrome Translator scores ≈ 56 chrF++ (en→vi 55.6, vi→en 55.6) vs OPUS-MT 44.5 (en→vi) / 53.7 (vi→en). OPUS-MT en→vi is clearly weaker, especially on technical / academic text.
* Therefore the new provider is used (a) when the platform translator cannot do the pair (e.g. an older Chrome / a browser without the Translator API, an Android device without the ML Kit pack) *and* the user downloaded the model, or (b) when the user switches *Ưu tiên dùng mô hình này* on. **No default was changed.**
* Platforms: Chrome extension — verified; Android — builds, shared JS verified, not run on a device; iPhone — **not offered** (not verified, see `MT_ENGINE_DEPLOYMENT.md`).

## Deployment strategy
Download on demand with explicit consent and size shown; pinned revisions; Cache API storage (removable in Settings); runs in a Worker (offscreen document in the extension); text never leaves the device; no silent cloud fallback; usage tracked separately (informational ledger `device-local|local`).

## Re-opening the decision
Re-run the Lab if: a candidate's licence changes; a candidate with a clean commercial licence is added (e.g. a distilled / quantised vi↔en model); or a real-device benchmark shows OPUS-MT fails the phone minimums.
