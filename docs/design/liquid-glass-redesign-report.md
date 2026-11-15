# Liquid Glass redesign – implementation report

**Scope:** the visual redesign of the LingoLens logo and every popup, panel and floating surface in
the Chrome extension and the phone apps. Functionality, data flow and business logic are unchanged.
The design system itself is described in
[liquid-glass-design-system.md](liquid-glass-design-system.md).

## 1. Audit (before the redesign)

- **Styling:**
  - Tailwind with colour tokens as CSS variables (`src/ui/styles.css`).
  - Settings-driven variables come from `src/ui/theme.ts`.
  - Shared primitives are in `src/ui/components.tsx`.
- **Isolation:** the content-script UI renders inside a closed Shadow DOM. The same stylesheet is
  injected there.
- **Surfaces:** flat, opaque panels (`bg-surface`, `border-border`, `shadow-pop`), with a 1–2 px
  accent stripe on cards.
- **Logo:** a flat white magnifier on a blue tile, defined as SVG paths. A later round turned it
  into a canvas renderer with five artistic styles; the default is `glass`.

### Surfaces found and redesigned

| Surface | File |
| --- | --- |
| Dictionary popup: word, phrase, sentence and paragraph modes, all tabs | `src/popup/FloatingPopup.tsx`, `src/ui/views.tsx` |
| Translation block (machine translation) | `src/ui/MachineTranslation.tsx` |
| OCR popup: original text, translation, per-word cards, edit mode | `src/popup/FloatingPopup.tsx`, `src/popup/OcrMeaning.tsx` |
| OCR overlay: scan button, region button, "scanning" pill, box labels, region-select hint | `src/content/OcrLayer.tsx` |
| Selection "look up" button, toast | `src/content/App.tsx` |
| Toolbar popup (main extension popup) | `src/action/ActionPopup.tsx` |
| Side panel: header, search, tab pills, cards | `src/sidepanel/SidePanel.tsx` |
| Vocabulary notebook: search, cards, notes | `src/ui/VocabManager.tsx` |
| Settings Center: navigation, setting groups, controls, logo picker | `src/options/SettingsCenter.tsx` |
| Settings live previews (popup + sidebar) | `src/options/SettingsPreview.tsx` |
| Phone app: home, tab bar, main switch, tiles | `src/mobile/App.tsx` |
| Phone scan screen: header, action bar, result cards | `src/mobile/Scan.tsx` |

- **Not present in the project:** no separate language-selection popup exists, because the
  language pair is fixed to EN→VI. There is also no modal dialog besides these surfaces. Nothing
  was added for them.
- **Tooltips:** they are native `title` tooltips drawn by the browser, so they cannot be styled.
  They are unchanged.

## 2. What changed

### Logo

- **Shape:** the LingoLens magnifier keeps its exact geometry: ring radius 14, ring width 6, the
  45° handle and the two text lines.
- **Liquid Glass logo (default):**
  - a frosted translucent body
  - the background refracted and magnified inside the lens
  - specular rims on the top-left outer edge and the inner bottom-right edge
  - a fine dark edge, so the shape reads on any colour
  - a soft drop shadow
- **Small sizes:** at 16 and 32 px the body is drawn denser for legibility.
- **Exports:** Chrome icons (16, 32, 48, 128), 1024 px tiles, transparent 1024 px marks, iPhone
  icons and Android adaptive layers. The original flat logo is kept as
  `assets/logo/lingolens-original.svg`.
- **Other styles:** the four artistic styles (Sơn dầu, Hoàng hôn, Đất sét 3D, Thủy mặc) remain
  selectable in Settings → Giao diện → Logo.

### Design system

- **Material tokens:**
  - glass tint opacity for panels and cards
  - edge colour and opacity
  - specular strength
  - blur and saturation
  - ambient shadows and page ambient light
  - radii, durations and easings
- **Material classes:** `.ml-glass`, `.ml-glass-bar`, `.ml-glass-card`, `.ml-glass-field`,
  `.ml-btn-primary`, `.ml-press`, `.ml-sheen`, `.ml-out`.
- **Shared primitives:** Button, IconButton, Toggle, Segmented, Select, Tabs, Badge, Notice and
  Progress now render with the material. Every screen that uses them was updated at once.
- **New setting:** `appearance.glass` (Settings → Giao diện → **Hiệu ứng kính (Liquid Glass)**,
  on by default) switches every surface to opaque, unblurred panels.

### Popups and panels

- **Dictionary and translation popup:**
  - a glass panel with a 20 px radius and a header hairline
  - more generous padding
  - glass cards for definitions, examples, sentence lists and the OCR original text
  - round icon buttons with a press state
  - pill badges
- **Popup animation:** the popup now animates both in (fade + rise + scale) and out (fade + drop +
  scale). The exit keeps the last popup on screen for 170 ms, without its `data-ml-popup`
  attribute and without pointer events, so it never blocks clicks or tests.
- **OCR word cards and translation block:** glass cards keep their colour stripes (green for words,
  accent for the translation).
- **OCR overlay controls, scanning pill, box labels, region hint, toast and selection button:**
  glass pills.
- **Toolbar popup:**
  - the header with the logo, status and site switch is a glass panel
  - the info and translation-model blocks are glass cards
  - the quick actions are glass tiles with a hover sheen
  - the switch is a glass toggle
- **Sidebar:**
  - glass header bar
  - large glass search field with the primary "Tra" button
  - glass tab track with an accent glass pill for the active tab
  - glass content cards
- **Settings Center:**
  - glass navigation
  - setting groups in glass cards
  - glass Segmented, Select, Toggle and colour fields
  - logo picker tiles with an accent glow on the selected one
  - previews rendered with the same glass as the real popup and sidebar
- **Phone app:**
  - floating Liquid Glass tab bar with rounded ends above the home indicator
  - glass home card and tiles
  - glass main switch
  - glass scan header and floating scan action bar

## 3. Validation

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Pass |
| Unit tests (`npm test`, 146 tests) | Pass |
| Extension build (`npm run build`) | Pass |
| End-to-end in Chrome (`node scripts/e2e.mjs`, 39 steps: popups, OCR, sidebar, toolbar popup, settings, offline, security) | 39/39 pass |
| Phone web UI build (`npm run build:ios-web`) and Android APK build | Pass |
| Logo exports (16/32/48/128, 1024 tiles, transparent marks, iOS, Android) | Generated and inspected on light and dark backgrounds |

- **Rendered UI inspection:** screenshots of the real UI were inspected.
  - `ML_SHOTS=1 node scripts/e2e.mjs` writes these to `test-results/ui-*.png`:
    - word popup and sentence popup (grammar tab) over a text page
    - OCR popup beside a manga bubble
    - toolbar popup (dark)
    - side panel (dark) with a lookup
  - The phone app settings and lookup screens (light) were captured with a desktop Chrome
    mobile viewport.
- **What the screenshots confirmed:**
  - no clipping or overflow
  - the popup still sits beside the bubble and does not cover the clicked word
  - text is readable over page text and manga art
  - the glass setting switches the material: the phone tab bar goes from
    `rgba(22,25,33,0.72)` with `blur(24px)` to `rgb(22,25,33)` with no blur
- **One e2e assertion was updated:** the light OCR popup used to expect an opaque white background.
  It now accepts the translucent white tint, `rgba(255,255,255,0.7)`.

## 4. Limitations and alternatives used

- **Real refraction (lensing):** CSS cannot refract the page behind a panel. The UI uses blur +
  saturation + specular edges instead. The logo shows true refraction because it is drawn on a
  canvas.
- **Browsers without `backdrop-filter`:** panels fall back to 85% opaque tints.
- **Exit animation scope:** only the floating popup has one. Toasts, menus and the selection button
  disappear immediately; they are short-lived and an exit delay would get in the way.
- **Native `title` tooltips:** drawn by the browser and cannot be styled.
- **Not verified on real devices:**
  - **iPhone:** WKWebView supports `-webkit-backdrop-filter` and the material was not changed for
    it, but the redesign was not inspected on an iPhone.
  - **Android:** the Android WebView build was not inspected on a device in this round.
- **Custom popup or sidebar background colours** are tinted as glass too, at the same opacity.
  Users who want a solid colour can turn off Hiệu ứng kính.

## 5. Follow-up: Kính trong logo, clear popups, app background

### Logo

- **New option:** "Kính trong" (`clear`) is a new logo choice in Settings → Giao diện → Logo.
- **Look:** a white frosted glass tile at 12 % with a clear optical magnifier and a grey hairline.
- **Approval:** chosen after reviewing 30, 50, 70 %, then 15, 25, 35 %, then 8, 12, 18 % opacity.
- **Liquid Glass logo:** it stays the default and now uses the per-pixel optical glass renderer.

### Popups and app background

- **Popup material:** Chất liệu popup offers Liquid Glass, Kính trong or Nền đặc.
- **App background:** Nền ứng dụng offers Ánh sáng dịu, Rực rỡ or Trơn.
- **Fix:** in-page toasts and OCR pills now use the popup's colour scheme. With clear glass they
  were unreadable on white pages.

### Validation

| Check | Result |
| --- | --- |
| Unit tests | 146 pass |
| End-to-end | 39/39 pass |
| Android build | Pass |

`ML_SHOTS=1` additionally captures `ui-popup-word-clear.png` and `ui-popup-ocr-clear.png`, the
popups with the clear material.
