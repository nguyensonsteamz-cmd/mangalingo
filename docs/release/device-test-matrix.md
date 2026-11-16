# Device test matrix

Status of **every** case on a **physical device**: **NOT TESTED** (no device — see `physical-device-verification.md`). The last column says what *has* been verified elsewhere, which is evidence for the code path but **not** a device PASS. Fill the A / I columns with PASS / FAIL + evidence (log, screenshot) when a phone is available.

Legend of "Elsewhere": E = Android emulator, S = iOS simulator (CI), C = real Chrome, U = unit/mock tests.

| ID | Case | Android | iPhone | Elsewhere |
|---|---|---|---|---|
| C1.1 | Fresh install, first launch | NOT TESTED | NOT TESTED | E: launches (15/15) · S: probe app launches |
| C1.2 | Background → foreground, resume | NOT TESTED | NOT TESTED | E: model survives Home → return |
| C1.3 | Force close → restart (state kept) | NOT TESTED | NOT TESTED | E: model still cached after force-stop · S: cache persists after terminate |
| C1.4 | Offline launch | NOT TESTED | NOT TESTED | – |
| C1.5 | Network recovery | NOT TESTED | NOT TESTED | U: retry / backoff |
| C2.1 | Short text EN→VI / VI→EN (default provider) | NOT TESTED | NOT TESTED | E: ML Kit both directions · C: Chrome |
| C2.2 | Long text (> 5,000 chars): progress, cancel, resume, retry | NOT TESTED | NOT TESTED | U: chunk runner · C: e2e |
| C2.3 | Several paragraphs in a row | NOT TESTED | NOT TESTED | U |
| C2.4 | API error / timeout / 429 → retry; Google BYOK | NOT TESTED | NOT TESTED | U: mock only (no live key) |
| C2.5 | Network interruption mid-job: nothing lost or duplicated | NOT TESTED | NOT TESTED | U: resume sends only the unfinished chunks |
| C2.6 | OPUS-MT download (size shown, consent), verify, cancel, repair, remove | NOT TESTED | iOS: model not offered | E: all · S: download/verify/persist · C: all |
| C3.1 | Usage counters per provider / direction | NOT TESTED | NOT TESTED | U |
| C3.2 | Quota warnings 80 / 90 / 100 %, block, consent | NOT TESTED | NOT TESTED | U · C |
| C3.3 | Usage after resume; network error while updating | NOT TESTED | NOT TESTED | U |
| C3.4 | No real payment | n/a | n/a | do not perform |
| C4.1 | Keyboard, text selection, clipboard | NOT TESTED | NOT TESTED | C |
| C4.2 | Permission prompts (overlay permission for the floating button; notifications) | NOT TESTED | n/a | – |
| C4.3 | Rotation, safe areas, notch | NOT TESTED | NOT TESTED | – |
| C4.4 | Fonts, long-text layout, dark / light, glass-off | NOT TESTED | NOT TESTED | C (screenshots) |
| C5.1 | Startup time, memory (PSS / Xcode gauge), CPU | NOT TESTED | NOT TESTED | E: ≈ 1.08 GB PSS with both models (x86 emulator) |
| C5.2 | Repeated translation 50×: no leak / crash / ANR | NOT TESTED | NOT TESTED | – |
| C5.3 | Crash / ANR log review | NOT TESTED | NOT TESTED | E: none observed |
| I.1 | Apple Translation en→vi, vi→en | n/a | NOT TESTED | S: reports `unsupported` (needs a device) |
| I.2 | Scan flow (Shortcuts → OCR → batch translation) | n/a | NOT TESTED | – |
| A.1 | ML Kit pack download on mobile data / Wi-Fi | NOT TESTED | n/a | E: downloaded |

No performance criterion was invented: pass thresholds (e.g. maximum memory) must be agreed by the owner before a device result is called PASS.
