# LingoLens – Liquid Glass design system

The LingoLens UI (Chrome extension popups, side panel, settings, phone apps) shares one visual
language: **Liquid Glass**. It uses translucent, lightly blurred surfaces that float above the
content, with a fine specular edge and soft depth. Glass is a *material for floating layers*, not a
coat of paint for every element.

All code lives in two places:

| What | Where |
| --- | --- |
| Tokens and material classes | [`src/ui/styles.css`](../../src/ui/styles.css) |
| Theme variables from settings | [`src/ui/theme.ts`](../../src/ui/theme.ts) (`themeVars`) |
| Glass primitives (Button, IconButton, Toggle, Segmented, Select, Tabs, Badge, Notice, Progress) | [`src/ui/components.tsx`](../../src/ui/components.tsx) |
| Logo renderer | [`src/ui/logo-data.ts`](../../src/ui/logo-data.ts), [`src/ui/logos.tsx`](../../src/ui/logos.tsx) |

## Principles

1. **Hierarchy decides the material.**
   - Floating layers get full glass: blur, tint, edge highlight and depth. These are popups, menus,
     toasts, the selection button and the phone tab bar.
   - Content inside them gets light glass cards: a tint and a fine edge, but no blur.
   - Text never sits on raw transparency.
2. **Readability first.** Tint opacity is 70–72%, high enough that text stays legible over manga
   art, page text and photos. The blur (24 px, saturation 180%) removes detail behind the panel
   instead of showing it through.
3. **Light comes from the top-left.**
   - Every glass surface has a 1 px inner highlight on its top edge and a softer one on its
     bottom edge.
   - Floating panels also get a faint radial sheen in the top-left corner.
4. **Depth is soft and short.**
   - Floating panels: one wide ambient shadow plus one tight contact shadow.
   - Cards: only a hairline.
5. **Motion is quick and quiet.**
   - Panels fade and scale in over about 180 ms and fade out over about 140 ms.
   - Toggles move with a slight spring.
   - Pressing a control scales it to 0.96.
   - Nothing moves while you read.
6. **The user stays in control.**
   - Settings → Giao diện → **Hiệu ứng kính** turns the material into opaque panels.
   - The OS "reduce transparency" and "reduce motion" preferences are respected.

## Tokens

Colours are `r g b` triples, so Tailwind can apply alpha (`bg-surface/60`). The existing colour
tokens (`--ml-bg`, `--ml-surface`, `--ml-elevated`, `--ml-border`, `--ml-text`, `--ml-muted`,
`--ml-subtle`, `--ml-accent`, `--ml-ok`, `--ml-warn`, `--ml-danger`, `--ml-box`) are unchanged. The
user's accent colour and the custom popup and sidebar backgrounds keep working, and the glass
tints whatever `--ml-surface` is.

### Material

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--ml-glass-alpha` | 0.72 | 0.70 | Tint opacity of floating panels |
| `--ml-glass-card-alpha` | 0.50 | 0.62 | Tint opacity of cards inside panels |
| `--ml-glass-edge` / `--ml-glass-edge-a` | white / 0.13 | white / 0.75 | 1 px border of glass |
| `--ml-glass-hi` | 0.16 | 0.90 | Strength of the specular top-edge highlight |
| `--ml-glass-shadow` | 24/56 px ambient + 4/14 px contact (black) | Same, tinted navy and lighter, plus a hairline | Depth of floating panels |
| `--ml-glass-card-shadow` | 1 px | 1 px + hairline | Depth of cards |
| `--ml-glass-blur` | 24px | 24px | Backdrop blur |
| `--ml-glass-saturate` | 180% | 180% | Backdrop saturation (keeps colours alive behind the blur) |
| `--ml-ambient-1/2`, `--ml-ambient-a` | indigo, violet / 0.20 | indigo, pink / 0.22 | Soft light in the page background |

Derived tokens are resolved on the element that carries `data-theme`:

- `--ml-glass-k`: max(`--ml-glass-solid`, `--ml-glass-off`), between 0 (full glass) and 1 (opaque).
- `--ml-glass-a`, `--ml-glass-card-a`: the effective tint opacities.
- `--ml-glass-blur-on`: the effective blur. It is 0 when the user switches glass off.

Switches:

- `--ml-glass-off` is set by `themeVars()` from `settings.appearance.glass`.
- `--ml-glass-solid` is 0.85 in browsers without `backdrop-filter`.
- With `prefers-reduced-transparency: reduce`, `--ml-glass-solid` is 1 and the blur is 0.

### Shape and motion

| Token | Value | Use |
| --- | --- | --- |
| `--ml-radius-sm` | 10px | Buttons, fields |
| `--ml-radius` | 14px | Small cards |
| `--ml-radius-lg` | 20px | Panels, popups (the classes also use 16–30 px for phone surfaces) |
| `--ml-dur` | 160ms | State transitions |
| `--ml-ease` | `cubic-bezier(.2,.8,.2,1)` | Default easing |
| `--ml-ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | Toggle thumbs |
| `--ml-anim` | 180ms, or 0 when popup animation is off | Popup entrance and exit |

## Material classes

| Class | Use | Contains |
| --- | --- | --- |
| `.ml-glass` | Floating panels: dictionary, translation and OCR popup, toolbar-popup header, OCR menus and status pills, toast, selection button, sidebar search box, phone tab bar, scan action bar, settings previews | Tint, backdrop blur and saturate, 1 px edge, inner top and bottom highlight, ambient shadow, `::before` sheen |
| `.ml-glass-bar` | Sticky headers (sidebar, settings navigation, scan screen) | Tint on `--ml-bg`, blur, hairline |
| `.ml-glass-card` | Content cards: meaning, original text, word rows, examples, vocabulary cards, settings groups, home tiles | Tint, fine edge, inner highlight, no blur |
| `.ml-glass-field` | Recessed controls: Select, Segmented track, Toggle track (off), search inputs, colour fields, progress track | Elevated tint, inner shadow |
| `.ml-btn-primary` | Accent actions ("Tra", "Quét vùng này", active tab pill, toggle on) | Accent fill, inner highlight gradient, coloured glow |
| `.ml-press` | Every interactive glass element | Smooth state transitions, press scale 0.96 |
| `.ml-sheen` | Large tappable tiles and primary buttons | Light reflection that sweeps across on hover (disabled with reduced motion) |
| `.ml-out` | Popup exit | Fade + 3 px drop + scale 0.97, not interactive |
| `.ml-focus` | Every focusable control | 2 px accent ring + 5 px soft accent halo (`:focus-visible` only) |

### Components

The shared primitives in `components.tsx` already use the material:

- **Button**:
  - `primary` is `.ml-btn-primary` with `.ml-sheen`.
  - `subtle` is a glass card.
  - `ghost` is a text-tinted hover.
  - `danger` is a tinted outline.
- **IconButton**: round, with a tinted hover; the active state is an accent tint with an inner ring.
- **Toggle**: 44×24 glass track, a white thumb with a spring, and an accent glass fill when on.
- **Segmented**: pill track (`.ml-glass-field`); the selected item is a raised glass pill with an edge highlight.
- **Select**: glass field, 36 px tall.
- **Tabs**: hairline underline; the active tab has a soft accent glow.
- **Badge**: pill, text-tinted.
- **Notice** (info): glass card.
- **Progress**: recessed track with an accent glass fill.

To build a new surface:

- **Floating layer:** `.ml-glass` plus a radius of 18–30 px.
- **Content inside it:** `.ml-glass-card`.
- **Inputs:** `.ml-glass-field`.
- **Actions:** `Button`, `IconButton` and `.ml-btn-primary`.
- **Accent stripes on cards:** keep the 3–4 px left stripe (`border-l-[4px] border-l-…`). It is the
  colour code readers learned:

  | Colour | Content |
  | --- | --- |
  | Grey | Original text |
  | Accent | Translation |
  | Green | Words |
  | Orange | Learning |

## Page background

Pages (side panel, settings, toolbar popup, phone app) paint a soft ambient light behind the glass.
It uses three radial gradients on `html[data-theme] body`: indigo at the top-left, violet or pink at
the bottom-right, and a hint of the user's accent at the top-right. Without it, glass over a flat
colour reads as a plain grey card.

In-page popups (content script) need no ambient, because the web page itself is the backdrop.

## Logo

Every logo is the same LingoLens magnifier: a ring, a handle and two text lines seen through the
lens. The proportions are unchanged from the original logo. Only the material and style change:

| Id | Name | Treatment |
| --- | --- | --- |
| `glass` (default) | Liquid Glass | Frosted glass body; the background is magnified and refracted inside the lens; specular rims top-left and inner bottom-right; colour field of blue, violet, cyan, pink and amber |
| `oil` | Sơn dầu | Swirling oil-paint strokes, cream impasto magnifier |
| `sunset` | Hoàng hôn | Warm gradient sky and sea, white magnifier with soft shadow |
| `clay` | Đất sét 3D | Soft clay 3D with lilac ring and amber handle |
| `ink` | Thủy mặc | Ink-wash brush stroke on rice paper, red seal |

- **Small sizes:** at 16 and 32 px the glass body is drawn denser, so the silhouette stays clear in
  the Chrome toolbar.
- **One renderer:** `drawLogo(ctx, id, size, { square, layer, inset })` in
  [`logo-data.ts`](../../src/ui/logo-data.ts) draws every logo on a canvas. The same function
  renders:
  - the UI (`<canvas>` sized to the device pixel ratio)
  - the Chrome toolbar icon (OffscreenCanvas in the service worker)
  - all exported PNGs
- **Exports:** `node scripts/make-logo-assets.mjs` regenerates:

  | Output | Contents |
  | --- | --- |
  | `assets/icons/icon-{16,32,48,128}.png` | Chrome extension icons |
  | `assets/logo/lingolens-<id>-1024.png` | High-resolution tile of each logo |
  | `assets/logo/lingolens-<id>-mark-1024.png` | Magnifier only, on a transparent background |
  | `assets/logo/lingolens-original.svg` | The original flat logo (backup) |
  | `ios/MangaLingo/Assets.xcassets/AppIcon*.appiconset` | iPhone primary and alternate icons |
  | `android/app/src/main/res/mipmap-*` | Android adaptive-icon layers; the magnifier is scaled to 68% so it stays inside the safe zone |

## Accessibility

- Text contrast is measured against the tint at its lowest opacity: 0.70 in light, 0.72 in dark.
  Text stays well above 4.5:1 for body text, even over a busy backdrop.
- The focus ring is a 2 px accent ring with a soft halo, shown only for keyboard focus.
- `prefers-reduced-motion`:
  - every animation and transition inside `.ml-root` drops to 1 ms
  - the sheen is removed
  - the press scale is disabled
- `prefers-reduced-transparency`: the panels become opaque and unblurred.
- Settings → Giao diện → Hiệu ứng kính does the same on demand.

## Clear glass ("Kính trong")

A second, lighter glass look that matches the **Kính trong** logo: white frosted glass at 12 %
opacity, with a fine grey hairline so it stays visible on white pages.

### Popup material (Settings → Floating Popup → Chất liệu popup)

| Value | Look | Variables set on the popup (`popupMaterialVars()` in `theme.ts`) |
| --- | --- | --- |
| `glass` (default) | Tinted Liquid Glass (theme surface, 70–72 %) | none |
| `clear` | Clear white glass: `--ml-surface` white at 12 %, cards at 10 %, 18 px blur, grey hairline edge (`72 80 98` at 0.45) | `--ml-surface`, `--ml-glass-alpha`, `--ml-glass-card-alpha`, `--ml-glass-edge(-a)`, `--ml-glass-hi`, `--ml-glass-blur` |
| `solid` | Opaque panel, no blur | `--ml-glass-off: 1` |

- **What follows the setting:** the floating popup and the in-page bits (toast, OCR pills,
  selection button). They also take the popup's colour scheme, so their text stays readable.
- **Custom background:** a custom popup background colour (Màu nền popup) still wins over the
  material's surface colour.
- **Readability:** clear glass reads best on light pages. On dark pages, set Màu popup to Tối.

### App background (Settings → Giao diện → Nền ứng dụng)

The value is `appearance.background`. `applyPageTheme()` writes it to `<html data-bg>`, and it
applies to the side panel, the settings page, the toolbar popup and the phone app.

| Value | Look |
| --- | --- |
| `ambient` (default) | Soft radial light |
| `vivid` | LingoLens colour field (cyan, amber, magenta, indigo) that shows the glass panels best |
| `plain` | Flat `--ml-bg` |

### Kính trong logo

[`logo-glass.ts`](../../src/ui/logo-glass.ts) builds the logo in two layers:

- **The tile** (`renderSlab`) is a slab of white frosted glass at 12 %. The backdrop is blurred and
  bent along the rounded bevel. The slab has Fresnel reflection, an edge light and a grey hairline.
- **The magnifier** (`renderGlass`) sits on the tile and refracts it. It uses the approved
  `CLEAR_OPTICS` settings: the optical variant plus the hairline.

Where it is used depends on whether the backdrop behind it is known:

| Where | Version | Why |
| --- | --- | --- |
| UI, Chrome toolbar, `assets/logo/lingolens-clear-1024.png` | Real alpha transparency (`renderClearAlpha`) | The backdrop is unknown, so the PNG is un-composited from black and white renders. Transparency, reflections and the hairline survive; refraction of the unknown backdrop cannot. |
| iPhone and Android app icons, `lingolens-clear-on-brand-1024.png` | The clear tile over the LingoLens colours | Phone icons must be opaque. |

## Selection pill and popup glass opacity

### Selection pill (`.ml-glass-select`)

Every "selected" state uses the same glass pill:

- the active tab in popups, the sidebar and the phone tab bar
- the chosen Segmented option
- the current settings page
- the chosen logo
- an active icon button

The pill is made of:

- a tint of `--ml-sel` at 16 %
- a top highlight
- half the backdrop blur
- a `--ml-sel` edge and a soft glow

| Token | Value |
| --- | --- |
| `--ml-sel` | Settings → Giao diện → **Màu hiệu ứng chọn** (`appearance.selectColor`). Empty means the accent colour. |
| Text colour | `--ml-sel` mixed with black (light theme) or white (dark theme), using `color-mix`, so it stays readable |

### Popup glass opacity

Settings → Floating Popup → **Độ đục của kính** (`popup.glassAlpha`) sets the tint opacity of
the popup glass:

| Value | Effect |
| --- | --- |
| 0 | The material's own opacity: Liquid Glass 72 %, Kính trong 12 % |
| 5–95 % | `--ml-glass-alpha` is set to this value, and the cards inside use 80 % of it |

The slider is hidden when the material is Nền đặc.
