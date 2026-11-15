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
    resolve: { alias: { '@': resolve(root, 'src') } },
    css: { postcss: { plugins: [tailwindcss(tailwindConfig), remToPx()] } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'warn',
  };
}
