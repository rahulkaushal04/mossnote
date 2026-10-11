import type { Page } from '@playwright/test';
import { docsBuilt, docsRequired, expect, test } from './fixtures';

/**
 * The web version as GitHub Pages serves a project site: under `/<repository>/`, with no server
 * behind it. `fixtures.ts` serves `dist/standalone` that way. Build it first with the base path
 * the real site will have, for example `MOSS_BASE=/mossnote/ npm run build:standalone` and
 * `npm run docs:build`; `npm run verify:pages` does both and runs these tests.
 */

const composer = (page: Page) => page.getByRole('combobox', { name: 'Note' });
const welcome = (page: Page) => page.getByRole('heading', { name: /welcome to/i });

async function startJournal(page: Page, address: string) {
  await page.goto(address);
  await expect(welcome(page)).toBeVisible();
  await page.getByRole('button', { name: 'Start my journal' }).click();
  await expect(welcome(page)).toHaveCount(0);
}

async function writeNote(page: Page, text: string) {
  const saved = page.getByRole('article', { name: text }).first();
  await expect(async () => {
    if ((await saved.count()) === 0) {
      await composer(page).fill(text);
      await composer(page).press('Control+Enter');
    }
    await expect(saved).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
}

/** Everything the page asked for, and anything it asked for that went wrong. */
function watch(page: Page) {
  const requests: string[] = [];
  const failures: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    // The document of an address that is not a file is a 404 by design; see "refreshing a page".
    if (response.status() >= 400 && response.request().resourceType() !== 'document') {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The browser logs a 404 for the document itself on a deep link; that is not a broken file.
    if (message.type() === 'error' && message.location().url !== page.url()) {
      errors.push(message.text());
    }
  });
  return { requests, failures, errors };
}

test.describe('the web version on GitHub Pages', () => {
  test('the site is served under the base path the build was made for', ({ site }) => {
    expect(site.base).toMatch(/^\/(?:[\w.-]+\/)?$/);
    // `npm run verify:pages` and the workflows say which base path the site must have.
    if (process.env.MOSS_EXPECT_BASE) expect(site.base).toBe(process.env.MOSS_EXPECT_BASE);
  });

  test('opens at its address and loads everything from under the base path', async ({
    page,
    at,
    site,
  }) => {
    const seen = watch(page);
    const response = await page.goto(at());
    expect(response?.status()).toBe(200);
    await expect(welcome(page)).toBeVisible();
    await expect(page).toHaveTitle(/Welcome · Mossnote/);

    const own = seen.requests.filter((url) => url.startsWith(site.origin));
    expect(own.length).toBeGreaterThan(3);
    expect(own.filter((url) => !new URL(url).pathname.startsWith(site.base))).toEqual([]);
    expect(seen.requests.filter((url) => !url.startsWith(site.origin))).toEqual([]);
    expect(seen.failures).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test('ships a manifest and icons that point inside the site', async ({ page, at, site }) => {
    await page.goto(at());
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestUrl).toBe(`${site.base}manifest.webmanifest`);
    const manifest = (await (await page.request.get(at('manifest.webmanifest'))).json()) as {
      start_url: string;
      scope: string;
      icons: { src: string }[];
    };
    expect(manifest.start_url).toBe(site.base);
    expect(manifest.scope).toBe(site.base);
    for (const icon of manifest.icons) {
      const reply = await page.request.get(`${site.origin}${icon.src}`);
      expect(reply.status(), icon.src).toBe(200);
    }
    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect((await page.request.get(`${site.origin}${touch}`)).status()).toBe(200);
  });

  test('refreshing a page works: the app opens at any address inside the site', async ({
    page,
    at,
  }) => {
    // GitHub Pages has no file for /journal, so it answers with 404.html, which is the app. The
    // status is 404 but the browser shows the app; this is the standard way to host one.
    const seen = watch(page);
    const response = await page.goto(at('journal'));
    expect(response?.status()).toBe(404);
    await expect(welcome(page)).toBeVisible();
    expect(seen.failures).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test('keeps the journal across reloads and direct visits to every page', async ({ page, at }) => {
    await startJournal(page, at());
    await writeNote(page, 'A note kept under the base path');

    await page.reload();
    await expect(
      page.getByRole('article', { name: 'A note kept under the base path' }),
    ).toBeVisible();

    for (const route of ['journal', 'people', 'maps', 'settings', 'search?q=base']) {
      const seen = watch(page);
      await page.goto(at(route));
      await expect(page.getByRole('navigation').first()).toBeVisible();
      await expect(welcome(page)).toHaveCount(0);
      expect(seen.failures, route).toEqual([]);
      expect(seen.errors, route).toEqual([]);
    }

    await page.goto(at('journal'));
    await expect(
      page.getByRole('article', { name: 'A note kept under the base path' }),
    ).toBeVisible();
  });

  test('links inside the app stay under the base path, including Today, which has no slash', async ({
    page,
    at,
    site,
  }) => {
    // The router writes the front page as `/mossnote`. Pages redirects that to `/mossnote/`.
    const inside = (address: string) => `${address.replace(/\/$/, '')}/`.startsWith(site.base);
    await startJournal(page, at());
    for (const name of ['Journal', 'People', 'Maps', 'Settings', 'Today']) {
      await page.getByRole('link', { name, exact: true }).first().click();
      await expect.poll(() => inside(new URL(page.url()).pathname), { message: name }).toBe(true);
    }
    // Today is open now. Export links are skipped: the web version saves those from the click
    // itself (see `DownloadLink`), so their `/api/...` addresses are never requested.
    await expect(composer(page)).toBeVisible();
    const hrefs = await page
      .locator('a[href^="/"]:not([download])')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.filter((href) => !inside(href))).toEqual([]);

    // Refreshing on Today (the address with no trailing slash) opens the journal, not an error.
    await page.reload();
    await expect(welcome(page)).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
  });

  test('an address with nothing behind it shows the app’s own not-found page', async ({
    page,
    at,
  }) => {
    await startJournal(page, at());
    await page.goto(at('no-such-page'));
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  });

  test('opens with no network once loaded, at the front page and at a deep link', async ({
    context,
    page,
    at,
    site,
  }) => {
    await startJournal(page, at());
    await writeNote(page, 'Written before going offline');
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return new URL(registration.scope).pathname;
    });
    expect(scope).toBe(site.base);
    // The first load has to finish keeping every file before the network goes away.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const cache = await caches.open(names[0] ?? '');
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThan(10);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Written before going offline' })).toBeVisible();

    await context.setOffline(true);
    for (const route of ['', 'journal', 'settings']) {
      await page.goto(at(route));
      await expect(welcome(page)).toHaveCount(0);
      await expect(page.getByRole('navigation').first()).toBeVisible();
    }
    await page.goto(at('journal'));
    await expect(page.getByRole('article', { name: 'Written before going offline' })).toBeVisible();
    await context.setOffline(false);
  });

  test('the documentation shares the site: /docs redirects, loads, and links back to the app', async ({
    page,
    at,
    site,
  }) => {
    test.skip(
      !docsBuilt && !docsRequired,
      'The documentation is not built: run npm run docs:build.',
    );
    const redirect = await page.request.get(at('docs'), { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers().location).toBe(`${site.base}docs/`);

    await page.goto(at('docs/getting-started/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible();
    await page.getByRole('link', { name: 'Open Mossnote' }).first().click();
    await expect(welcome(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(site.base);
  });

  test('the first screen links to how to install the computer version', async ({ page, at }) => {
    test.skip(
      !docsBuilt && !docsRequired,
      'The documentation is not built: run npm run docs:build.',
    );
    await page.goto(at());
    await expect(page.getByText('Want it on your computer?')).toBeVisible();
    await page.getByRole('link', { name: 'see how to install it' }).click();
    await expect(page.getByRole('heading', { name: 'Install the computer version' })).toBeVisible();
  });

  test('documentation pages are not replaced by the app once the app is installed offline', async ({
    page,
    at,
  }) => {
    test.skip(
      !docsBuilt && !docsRequired,
      'The documentation is not built: run npm run docs:build.',
    );
    await startJournal(page, at());
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.goto(at('docs/getting-started/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible();
  });

  test('makes no request to any other site while it is used', async ({ page, at, site }) => {
    const seen = watch(page);
    await startJournal(page, at());
    await writeNote(page, 'Example');
    await page.goto(at('settings'));
    await page.goto(at('docs/'));
    expect(seen.requests.filter((url) => !url.startsWith(site.origin))).toEqual([]);
  });

  test('fits a phone: no sideways scrolling on the first screen or on Today', async ({
    page,
    at,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(at());
    await expect(welcome(page)).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Start my journal' }).click();
    await expect(composer(page)).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
