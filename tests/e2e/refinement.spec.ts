import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

/** The second visual pass (ADR 0009): editorial Today, palette scopes, long-press names, details. */

test.describe('Today', () => {
  test('the heading names the day and the composer is the first thing to type in', async ({
    page,
    seed,
  }) => {
    await seed.reset('default');
    await page.goto('/');
    const heading = page.getByRole('heading', { level: 1, name: 'Today' });
    await expect(heading).toBeVisible();
    await expect(heading.locator('em')).toHaveText(
      new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date()),
    );
    await expect(page.getByRole('combobox', { name: 'Note' })).toBeFocused();
  });
});

test.describe('search palette', () => {
  test('opens from the sidebar field, narrows by scope and shows key hints', async ({
    page,
    seed,
  }) => {
    await seed.reset('default');
    await seed.person('Pelican Sam');
    await seed.note({ body: 'a pelican note' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: /^Search/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Search and commands' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('close')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Search' }).fill('pelican');
    await expect(dialog.getByRole('option', { name: /Pelican Sam/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: /a pelican note/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(dialog.getByRole('option', { name: /Pelican Sam/ })).toHaveCount(0);
    await expect(dialog.getByRole('option', { name: /a pelican note/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('details', () => {
  test('the theme-color meta follows the theme', async ({ page, seed }) => {
    await seed.reset('default');
    await page.goto('/');
    const color = () =>
      page.evaluate(() =>
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      );
    await page.evaluate(() => {
      localStorage.setItem('moss:theme', 'light');
    });
    await page.reload();
    expect(await color()).toBe('#f7f5f0');
    await page.evaluate(() => {
      localStorage.setItem('moss:theme', 'dark');
    });
    await page.reload();
    expect(await color()).toBe('#141816');
  });

  test('the People list has monogram avatars and axe finds nothing in either theme', async ({
    page,
    seed,
  }) => {
    await seed.reset('default');
    await seed.person('Abigail');
    for (const theme of ['light', 'dark']) {
      await page.addInitScript((t) => {
        localStorage.setItem('moss:theme', t);
      }, theme);
      await page.goto('/people');
      await expect(page.getByRole('link', { name: 'Abigail' })).toBeVisible();
      await expect(page.locator('.avatar').first()).toHaveText('A');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, theme).toEqual([]);
    }
  });
});

test.describe('map editor on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test('a long press on a toolbar icon shows its name and does not run it', async ({
    page,
    seed,
  }) => {
    await seed.reset('default');
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Long press' });
    await page.goto(`/maps/${map.id}`);
    const rectangle = page.getByRole('button', { name: 'Box' });
    await rectangle.dispatchEvent('pointerdown', { pointerType: 'touch' });
    await expect(page.getByTestId('toolbar-hint')).toHaveText('Box', { timeout: 2000 });
    await rectangle.dispatchEvent('pointerup', { pointerType: 'touch' });
    await rectangle.dispatchEvent('click');
    await expect(rectangle).toHaveAttribute('aria-pressed', 'false');
  });
});
