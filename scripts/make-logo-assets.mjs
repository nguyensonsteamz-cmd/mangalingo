/**
 * Generates every app icon from the logo renderer in src/ui/logo-data.ts (run after changing a
 * logo; the outputs are committed):
 *   - assets/icons/icon-{16,32,48,128}.png                 Chrome extension (default logo, rounded tile)
 *   - ios/MangaLingo/Assets.xcassets/AppIcon*.appiconset    iPhone: default + alternate icons (1024 px)
 *   - android/app/src/main/res/…                           Android adaptive launcher icons (PNG layers)
 *   - assets/logo/                                         brand sources: every logo as a 1024 px tile,
 *                                                          the magnifier alone on transparency, and the
 *                                                          original flat logo (SVG backup)
 * "Kính trong" (clear) is transparent in the files; phones need opaque icons, so its app icons
 * show the clear glass tile over the LingoLens colours.
 * PNGs are drawn with the app's own drawLogo() in headless Chrome.   node scripts/make-logo-assets.mjs
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { attach, launch } from './cdp.mjs';

const root = resolve(import.meta.dirname, '..');
// logo-data.ts + logo-glass.ts bundled into one script: `L.drawLogo`, `L.LOGOS`…
const js = (
  await build({
    stdin: { contents: `export * from './src/ui/logo-data';`, resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'iife',
    globalName: 'L',
    write: false,
  })
).outputFiles[0].text;
const { LOGOS, DEFAULT_LOGO } = await import(`data:text/javascript;base64,${Buffer.from(js + '\nexport const { LOGOS, DEFAULT_LOGO } = L;').toString('base64')}`);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** The original flat LingoLens logo (before the Liquid Glass redesign), kept as a backup. */
const ORIGINAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
  <title>LingoLens – original flat logo</title>
  <rect width="64" height="64" rx="15" fill="#3451D1"/>
  <path fill="#FFFFFF" fill-rule="evenodd" d="M28 11a17 17 0 1 1 0 34a17 17 0 1 1 0-34zm0 6a11 11 0 1 0 0 22a11 11 0 1 0 0-22z"/>
  <path fill="#FFFFFF" d="M38.6 41.4l4.2-4.2l11.4 11.4a3 3 0 0 1-4.2 4.2z"/>
  <path fill="#FFD43B" d="M21 23.5h14v3.6H21zM21 30h9v3.6h-9z"/>
</svg>
`;

// Android adaptive icons: 108 dp layers, only the centre ~66 dp is always visible → the magnifier
// is drawn smaller on its own layer, the background fills the whole layer.
const ANDROID_PX = 432; // xxxhdpi (4×); the launcher scales it down for other densities
const ANDROID_INSET = 0.68;
/** 1×1 transparent PNG (empty adaptive-icon foreground). */
const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ---------------------------------------------------------------- PNG rendering in Chrome
const browser = await launch({ headless: true });
const png = async (id, size, opts) => {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const page = await attach(browser, targetId);
  const b64 = await page.evaluateMain(`(async () => {
    ${js}
    const c = new OffscreenCanvas(${size}, ${size});
    L.drawLogo(c.getContext('2d'), ${JSON.stringify(id)}, ${size}, ${JSON.stringify(opts)});
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  })()`);
  await browser.send('Target.closeTarget', { targetId });
  return Buffer.from(b64, 'base64');
};

const res = join(root, 'android/app/src/main/res');
try {
  // Chrome extension icons
  const ext = join(root, 'assets/icons');
  await mkdir(ext, { recursive: true });
  for (const size of [16, 32, 48, 128]) await writeFile(join(ext, `icon-${size}.png`), await png(DEFAULT_LOGO, size, {}));

  // Brand sources (high resolution)
  const brand = join(root, 'assets/logo');
  await mkdir(brand, { recursive: true });
  for (const logo of LOGOS) {
    await writeFile(join(brand, `lingolens-${logo.id}-1024.png`), await png(logo.id, 1024, {}));
    if (logo.id === 'clear') {
      // already transparent; plus the opaque version used for phone icons
      await writeFile(join(brand, 'lingolens-clear-on-brand-1024.png'), await png(logo.id, 1024, { backdrop: 'brand' }));
      continue;
    }
    await writeFile(join(brand, `lingolens-${logo.id}-mark-1024.png`), await png(logo.id, 1024, { square: true, layer: 'fg', inset: 1.2 }));
  }
  await writeFile(join(brand, 'lingolens-original.svg'), ORIGINAL_SVG);

  // iPhone: AppIcon = default, AppIcon-<Name> = alternates (old alternates are removed first)
  const xc = join(root, 'ios/MangaLingo/Assets.xcassets');
  for (const d of await readdir(xc)) if (d.startsWith('AppIcon')) await rm(join(xc, d), { recursive: true, force: true });
  for (const logo of LOGOS) {
    const name = logo.id === DEFAULT_LOGO ? 'AppIcon' : `AppIcon-${cap(logo.id)}`;
    const dir = join(xc, `${name}.appiconset`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'icon-1024.png'), await png(logo.id, 1024, { square: true, backdrop: 'brand' }));
    await writeFile(
      join(dir, 'Contents.json'),
      JSON.stringify({ images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
    );
  }

  // Android: PNG layers + adaptive-icon XML per logo
  const mip = join(res, 'mipmap-xxxhdpi');
  const any = join(res, 'mipmap-anydpi-v26');
  for (const d of [mip, any]) {
    await mkdir(d, { recursive: true });
    for (const f of await readdir(d)) if (/^ic_(logo|launcher)_/.test(f)) await rm(join(d, f));
  }
  for (const logo of LOGOS) {
    if (logo.id === 'clear') {
      // Android can show the wallpaper through an icon: empty (transparent) background layer, and
      // the white 12 % glass tile + magnifier with real alpha as the foreground layer.
      await writeFile(join(mip, `ic_logo_${logo.id}_bg.png`), EMPTY_PNG);
      await writeFile(join(mip, `ic_logo_${logo.id}_fg.png`), await png(logo.id, ANDROID_PX, { square: true, inset: ANDROID_INSET }));
    } else {
      await writeFile(join(mip, `ic_logo_${logo.id}_bg.png`), await png(logo.id, ANDROID_PX, { square: true, layer: 'bg' }));
      await writeFile(join(mip, `ic_logo_${logo.id}_fg.png`), await png(logo.id, ANDROID_PX, { square: true, layer: 'fg', inset: ANDROID_INSET }));
    }
    await writeFile(
      join(any, `ic_launcher_${logo.id}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>
<!-- generated by scripts/make-logo-assets.mjs – edit src/ui/logo-data.ts instead -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_logo_${logo.id}_bg" />
    <foreground android:drawable="@mipmap/ic_logo_${logo.id}_fg" />
</adaptive-icon>
`,
    );
  }
} finally {
  await browser.close();
}
console.log(`[logos] ${LOGOS.map((l) => l.id).join(', ')} → assets/icons, iOS app icons, Android launcher icons`);
