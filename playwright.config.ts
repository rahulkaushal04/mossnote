import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the built app served by the real server. Each worker starts its
 * own server with a temporary MOSS_DATA_DIR and a free port (see tests/e2e/fixtures.ts).
 * `npm run test:e2e` builds first, in `--mode e2e`: a production build that also includes the
 * hidden /dev/kit route so the Radix primitives can be exercised under the full CSP.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Reduced motion keeps animations from running mid-scan: axe would measure a half-faded dialog.
  // Tests that care about motion turn it back on with page.emulateMedia.
  use: { trace: 'retain-on-failure', colorScheme: 'light', reducedMotion: 'reduce' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit smoke test (macOS CI only): npx playwright test --project=webkit --grep @smoke
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@smoke/ },
  ],
});
