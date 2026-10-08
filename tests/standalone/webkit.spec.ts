import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startJournal, test, expect, writeNote } from './helpers';

/**
 * Safari's engine. Playwright's usual WebKit context is ephemeral, like a Safari private window,
 * and WebKit refuses file storage there, so this test opens a persistent context instead.
 */
test('@smoke the journal works in WebKit and survives a reload', async ({ playwright, site }) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-webkit-'));
  const context = await playwright.webkit.launchPersistentContext(folder, {
    ...playwright.devices['Desktop Safari'],
    baseURL: site.url,
  });
  try {
    const page = await context.newPage();
    await startJournal(page);
    await writeNote(page, 'Example note kept in WebKit');

    await page.reload();
    await page.goto('/journal');

    await expect(page.getByRole('article', { name: 'Example note kept in WebKit' })).toBeVisible();
  } finally {
    await context.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('@smoke says so plainly in a private window, which cannot keep files', async ({
  browser,
  site,
}) => {
  test.skip(browser.browserType().name() !== 'webkit');
  const page = await (await browser.newContext({ baseURL: site.url })).newPage();

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /can.t keep your journal/i })).toBeVisible();
  await expect(page.getByText(/private windows/i).first()).toBeVisible();
});
