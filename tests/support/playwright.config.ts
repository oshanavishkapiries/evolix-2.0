import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({ testDir: '.', testMatch: /.*\.spec\.ts/, workers: 1, timeout: 30000, use: { baseURL: 'http://127.0.0.1:4181', viewport: { width: 1280, height: 850 }, headless: true }, webServer: { cwd: resolve(import.meta.dirname, '../..'), command: 'pnpm exec vite --config tests/support/browser/vite.config.ts', url: 'http://127.0.0.1:4181', reuseExistingServer: false } });
