import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import remToPx from './postcss-rem-to-px.mjs';
import tailwindConfig from '../tailwind.config.ts';

export const root = resolve(import.meta.dirname, '..');

export function sharedConfig() {
  return {
    configFile: false,
    root,
    plugins: [react()],
    // onnxruntime-web → its WASM-only build (the default build embeds WebGPU and needs a 21 MB wasm; we only use the CPU / WASM path)
    resolve: { alias: [{ find: '@', replacement: resolve(root, 'src') }, { find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] },
    worker: { format: 'es' },
    css: { postcss: { plugins: [tailwindcss(tailwindConfig), remToPx()] } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'warn',
  };
}
