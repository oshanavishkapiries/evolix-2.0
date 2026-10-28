import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({ resolve: { alias: { '@': resolve(import.meta.dirname, '../..') } }, test: { include: ['tests/feedback/**/*.test.ts'], testTimeout: 20000, hookTimeout: 30000 } });
