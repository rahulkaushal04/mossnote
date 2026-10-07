import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Accessibility (spec section 22, AC-G-4): every route, in both themes, at 360, 768 and 1280px,
 * with zero serious or critical axe violations.
 */
const ROUTES = [
  '/',
  '/day/10003',
  '/day/oops',
  '/journal',
  '/notes/abc',
  '/people',
  '/people/abc',
  '/farm',
  '/farm/abc',
  '/maps',
  '/maps/abc',
  '/search?q=lantern',
  '/settings',
  '/dev/kit',
  '/nowhere',
];
/** Routes that open a modal sheet. The sheet hides the page behind it, so its title is the heading. */
const SHEET_ROUTES = new Set(['/farm/abc']);
const WIDTHS = [360, 768, 1280];
const THEMES = ['light', 'dark'] as const;

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`no serious or critical violations: ${theme} theme at ${width}px`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('moss:theme', value);
      }, theme);
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(route);
        if (SHEET_ROUTES.has(route)) await expect(page.getByRole('dialog')).toBeVisible();
        else await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await violations(page), `${route} (${theme}, ${width}px)`).toEqual([]);
      }
    });
  }

  test(`dialog and toast are accessible: ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('moss:theme', value);
    }, theme);
    await page.goto('/dev/kit');
    await page.getByRole('button', { name: 'Show toast with Undo' }).click();
    await expect(page.getByText('Item deleted')).toBeVisible();
    expect(await violations(page), 'toast').toEqual([]);

    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog', { name: 'Example dialog' })).toBeVisible();
    expect(await violations(page), 'dialog').toEqual([]);
  });
}

test('the unreachable page is accessible', async ({ page, server }) => {
  await page.route(`${server.url}/api/**`, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Can't reach your journal." })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('the scan itself catches real problems (so a clean result means something)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    document.body.append(img);
    const p = document.createElement('p');
    p.className = 'text-base';
    p.textContent = 'faint text';
    p.setAttribute('data-test', 'x');
    document.body.append(p);
    p.classList.add('text-rule');
  });
  const found = await violations(page);
  expect(found.some((v) => v.startsWith('image-alt'))).toBe(true);
});
