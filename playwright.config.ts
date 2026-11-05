import { defineConfig } from '@playwright/test';

// Electron e2e tests; Playwright's Electron support is experimental (see ADR 0001).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
