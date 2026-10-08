import { test, expect } from './fixtures';

/** The three layouts: a phone, a tablet and a wide screen (the rail starts at 900px). */
const WIDTHS = [375, 768, 1280] as const;

test.describe('screens fit at phone, tablet and wide widths', () => {
  for (const width of WIDTHS) {
    test(`no horizontal scroll at ${width}px, including Maps and the editor`, async ({
      page,
      seed,
    }) => {
      await seed.reset('stardew');
      const map = await seed.post<{ id: string }>('/api/maps', { name: 'Fit test' });
      await seed.note({ title: 'A note', body: 'Some text to fill the page.', gameDate: 10101 });
      await seed.person('Sam Example');
      await page.setViewportSize({ width, height: 800 });
      for (const route of [
        '/',
        '/journal',
        '/people',
        '/farm',
        '/maps',
        `/maps/${map.id}`,
        '/settings',
      ]) {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }
});

test.describe('touch targets on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test('tab bar, header buttons and map toolbar are at least 44 by 44', async ({ page, seed }) => {
    await seed.reset('stardew');
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Touch test' });
    const big = async (locators: ReturnType<typeof page.locator>[], what: string) => {
      for (const locator of locators) {
        const box = await locator.boundingBox();
        expect(box?.width, `${what} width`).toBeGreaterThanOrEqual(43.5);
        expect(box?.height, `${what} height`).toBeGreaterThanOrEqual(43.5);
      }
    };

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    const bar = page.getByRole('navigation', { name: 'Primary' }).last();
    await big(
      [...(await bar.getByRole('link').all()), bar.getByRole('button', { name: 'More' })],
      'tab bar',
    );
    const header = page.getByRole('banner');
    await big(await header.getByRole('button').all(), 'header');

    await page.goto(`/maps/${map.id}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await big(
      await page.getByRole('toolbar', { name: 'Map tools' }).getByRole('button').all(),
      'tools',
    );
    await big(
      await page.getByRole('toolbar', { name: 'Map controls' }).getByRole('button').all(),
      'controls',
    );
  });
});

test.describe('the map editor on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('is full-bleed: the canvas gets most of the screen and the tab bar is out of the way', async ({
    page,
    seed,
  }) => {
    await seed.reset('stardew');
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Room test' });
    await page.goto(`/maps/${map.id}`);
    const canvas = page.getByTestId('map-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(812 * 0.6);
    // No tab bar on this screen: the only way out is the back link at the top.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to Maps' })).toBeVisible();
  });

  test('the tools can be hidden for more room and shown again', async ({ page, seed }) => {
    await seed.reset('stardew');
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Collapse test' });
    await page.goto(`/maps/${map.id}`);
    const canvas = page.getByTestId('map-canvas');
    await expect(canvas).toBeVisible();
    const before = (await canvas.boundingBox())?.height ?? 0;

    await page.getByRole('button', { name: 'Hide tools' }).click();
    await expect(page.getByRole('toolbar', { name: 'Map tools' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect
      .poll(async () => (await canvas.boundingBox())?.height ?? 0)
      .toBeGreaterThan(before);

    await page.getByRole('button', { name: 'Show tools' }).click();
    await expect(page.getByRole('toolbar', { name: 'Map tools' })).toBeVisible();
  });
});

test.describe('sheets and motion', () => {
  test('a dialog is a bottom sheet on a phone and a centred panel on a wide screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/dev/kit');
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const sheet = page.getByRole('dialog', { name: 'Example dialog' });
    await expect(sheet).toHaveAttribute('data-presentation', 'sheet');
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox?.width).toBe(375);
    expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeCloseTo(800, 0);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const panel = page.getByRole('dialog', { name: 'Example dialog' });
    await expect(panel).toHaveAttribute('data-presentation', 'panel');
    const panelBox = await panel.boundingBox();
    expect(panelBox?.x).toBeGreaterThan(0);
    expect(panelBox?.y).toBeGreaterThan(0);
  });

  test('a dialog animates in, unless the person asked for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dev/kit');
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const dialog = page.getByRole('dialog', { name: 'Example dialog' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');
    await page.keyboard.press('Escape');
    // Let the exit animation finish before changing the setting, or it is cancelled half way.
    await expect(page.locator('.scrim')).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
