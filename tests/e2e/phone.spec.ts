import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Settings → Phone on the real server. A real second device cannot be played here (anything on
 * this machine counts as this computer), so pairing itself is covered by the server's tests.
 */

const TOGGLE = (page: Page) => page.getByRole('checkbox', { name: /let phones and tablets/i });

test.afterEach(async ({ request, server }) => {
  // The server is shared by the tests of this worker: leave phone access as it was found, off.
  await request.put(`${server.url}/api/phone`, {
    headers: { 'X-Moss-Client': 'web' },
    data: { enabled: false },
  });
});

test.describe('phone access', () => {
  test('turns on at once, shows a pairing code with a QR code, and turns off again', async ({
    page,
    seed,
  }) => {
    await seed.reset();
    await page.goto('/settings#phone');
    await expect(TOGGLE(page)).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Show pairing code' })).toHaveCount(0);

    await TOGGLE(page).check();
    await page.getByRole('button', { name: 'Show pairing code' }).click();

    await expect(
      page.getByRole('img', { name: /pairing link http:\/\/.+\/pair\?code=/i }),
    ).toBeVisible();
    await expect(page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('img', { name: /pairing link/i })).toHaveCount(0);

    await TOGGLE(page).uncheck();
    await expect(page.getByRole('button', { name: 'Show pairing code' })).toHaveCount(0);
    await expect(TOGGLE(page)).not.toBeChecked();
  });

  test('is still on after a reload, and the app keeps answering while it moves', async ({
    page,
    seed,
  }) => {
    await seed.reset();
    await page.goto('/settings#phone');
    await TOGGLE(page).check();
    await expect(page.getByRole('button', { name: 'Show pairing code' })).toBeVisible();

    await page.reload();

    await expect(TOGGLE(page)).toBeChecked();
    await page.goto('/');
    await expect(page.getByRole('link', { name: /today/i }).first()).toBeVisible();
  });

  test('an unpaired request by a name other than this computer’s is refused', async ({
    page,
    seed,
    request,
    server,
  }) => {
    await seed.reset();
    await page.goto('/settings#phone');
    await TOGGLE(page).check();
    await expect(page.getByRole('button', { name: 'Show pairing code' })).toBeVisible();

    const refused = await request.get(`${server.url}/api/health`, {
      headers: { Host: 'evil.example:4317' },
    });

    expect(refused.status()).toBe(403);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the pairing screen has no serious accessibility violations: ${theme} theme`, async ({
      page,
      seed,
    }) => {
      await seed.reset();
      await page.addInitScript((value) => {
        localStorage.setItem('moss:theme', value);
      }, theme);
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/settings#phone');
        await TOGGLE(page).check();
        await page.getByRole('button', { name: 'Show pairing code' }).click();
        await expect(page.getByRole('img', { name: /pairing link/i })).toBeVisible();

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        const serious = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );

        expect(
          serious.map((v) => v.id),
          `${theme} ${width}`,
        ).toEqual([]);
        await page.getByRole('button', { name: 'Done' }).click();
        await TOGGLE(page).uncheck();
        await expect(page.getByRole('button', { name: 'Show pairing code' })).toHaveCount(0);
      }
    });
  }
});
