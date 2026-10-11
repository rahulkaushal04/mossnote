import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures';

/**
 * Safari's engine on a project site. Playwright's usual WebKit context is ephemeral, like a Safari
 * private window, and WebKit refuses file storage there, so the first test opens a persistent
 * context instead (as `tests/standalone/webkit.spec.ts` does).
 */
test('@smoke opens at a deep link, keeps a note across a refresh, and stays under the base path', async ({
  playwright,
  at,
  site,
}) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-pages-webkit-'));
  const context = await playwright.webkit.launchPersistentContext(folder, {
    ...playwright.devices['Desktop Safari'],
  });
  try {
    const page = await context.newPage();
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== site.origin || !`${url.pathname}/`.startsWith(site.base)) {
        outside.push(request.url());
      }
    });

    // A refresh on an address that is not a file: the host answers 404.html, which is the app.
    const response = await page.goto(at('journal'));
    expect(response?.status()).toBe(404);
    await page.getByRole('button', { name: 'Start my journal' }).click();
    const composer = page.getByRole('combobox', { name: 'Note' });
    await composer.fill('Example note kept in WebKit under the base path');
    await composer.press('Control+Enter');
    await expect(page.getByRole('article', { name: /kept in WebKit/ })).toBeVisible();

    await page.reload();
    await page.goto(at('journal'));
    await expect(page.getByRole('article', { name: /kept in WebKit/ })).toBeVisible();
    expect(outside).toEqual([]);
  } finally {
    await context.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('@smoke says so plainly in a private window, which cannot keep files', async ({
  browser,
  at,
}) => {
  test.skip(browser.browserType().name() !== 'webkit');
  const page = await (await browser.newContext()).newPage();
  await page.goto(at());
  await expect(page.getByRole('heading', { name: /can.t keep your journal/i })).toBeVisible();
});
