/**
 * Builds the phone apps' web UI (Android: android/app/src/main/assets/web/, iPhone: --out
 * ios/LingoLens/web) and copies the dictionary data next to it.
 *   node scripts/build-mobile.mjs [--out <dir>]
 */
import { build } from 'vite';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sharedConfig, root } from './vite-shared.mjs';

// --out <dir>: e.g. ios/LingoLens/web for the iPhone app (default: the Android app's assets)
const outArg = process.argv.indexOf('--out');
const out = resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'android/app/src/main/assets/web');
const data = resolve(root, 'build-data/data');
if (!existsSync(join(data, 'meta.json'))) throw new Error('Run "npm run data" first (build-data/data missing).');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await rm(out, { recursive: true, force: true });
await build({
  ...sharedConfig(),
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.VITE_ML_VERSION': JSON.stringify(pkg.version) },
  build: {
    outDir: out,
    emptyOutDir: true,
    target: 'chrome100',
    modulePreload: false,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { index: resolve(root, 'src/mobile/index.html') } },
  },
});
// Vite writes src/mobile/index.html → flatten to web/index.html with relative asset paths.
const nested = join(out, 'src/mobile/index.html');
const html = (await readFile(nested, 'utf8')).replace(/(src|href)="(\.\.\/)+assets\//g, '$1="./assets/');
await writeFile(join(out, 'index.html'), html);
await rm(join(out, 'src'), { recursive: true, force: true });
// Local translation model runtime (ONNX Runtime Web WASM); the model itself is downloaded on demand
await mkdir(join(out, 'vendor/ort'), { recursive: true });
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await cp(resolve(root, 'node_modules/onnxruntime-web/dist', f), join(out, 'vendor/ort', f));
await mkdir(join(out, 'data'), { recursive: true });
await cp(data, join(out, 'data'), { recursive: true });
console.log('[mobile] web UI →', out);
