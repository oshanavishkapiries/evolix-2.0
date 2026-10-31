import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../../..');
export default defineConfig({ root: import.meta.dirname, resolve: { alias: { '@': repo, 'next/navigation': resolve(import.meta.dirname, 'navigation.ts'), 'next/link': resolve(import.meta.dirname, '../../subtitles/browser/link.tsx') } }, server: { host: '127.0.0.1', port: 4181, strictPort: true, fs: { allow: [repo] } } });
