import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { addJournal, startJournal, test, expect, writeNote } from './helpers';

test.describe('the journal in the browser', () => {
  test('@smoke starts empty, keeps a note, and still has it after a reload', async ({ page }) => {
    await startJournal(page);

    await writeNote(page, 'Example note kept in the browser');
    await page.reload();

    await page.goto('/journal');
    await expect(
      page.getByRole('article', { name: 'Example note kept in the browser' }),
    ).toBeVisible();
  });

  test('says the journal lives in this browser', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(/lives in this browser/i)).toBeVisible();
  });

  test('a second tab is told the first one has the journal, and works once the first closes', async ({
    context,
    page,
  }) => {
    await startJournal(page);
    const second = await context.newPage();

    await second.goto('/');
    await expect(second.getByRole('heading', { name: /open in another tab/i })).toBeVisible();

    await page.close();
    await second.reload();
    await expect(second.getByRole('heading', { name: /open in another tab/i })).toHaveCount(0);
    await expect(second.getByRole('link', { name: /today/i }).first()).toBeVisible();
  });

  test('exports the journal as a file that holds the note', async ({ page }) => {
    await startJournal(page);
    await writeNote(page, 'Example note to export');
    await page.goto('/settings#data');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export JSON' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^mossnote-.*\.json$/);
    const text = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(text).toString('utf8')).toContain('Example note to export');
  });

  test('takes a snapshot and restores it', async ({ page }) => {
    await startJournal(page);
    await writeNote(page, 'Before the snapshot');
    await page.goto('/settings#data');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText(/Saved a snapshot/)).toBeVisible();
    await page.goto('/');
    await writeNote(page, 'After the snapshot');
    await page.goto('/settings#data');

    await page
      .getByRole('button', { name: /^Restore/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText(/Before a restore/)).toBeVisible();

    await page.goto('/journal');
    await expect(page.getByRole('article', { name: 'Before the snapshot' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'After the snapshot' })).toHaveCount(0);
  });

  test('opens with no network once it has loaded, and keeps working', async ({ context, page }) => {
    await startJournal(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await writeNote(page, 'Written before going offline');

    await context.setOffline(true);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /today/i }).first()).toBeVisible();
    await writeNote(page, 'Written while offline');

    await context.setOffline(false);
  });

  test('makes no request to any other site', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1')) foreign.push(request.url());
    });

    await startJournal(page);
    await writeNote(page, 'Example');
    await page.goto('/settings');

    expect(foreign).toEqual([]);
  });

  test('keeps two journals apart and remembers which was open', async ({ page }) => {
    await startJournal(page);
    await writeNote(page, 'In the first journal');

    await addJournal(page, 'Second');
    await page.goto('/');
    await writeNote(page, 'In the second journal');

    await page.reload();
    await page.goto('/journal');
    await expect(page.getByRole('article', { name: 'In the second journal' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'In the first journal' })).toHaveCount(0);
  });

  test('deleting the open journal opens the other one', async ({ page }) => {
    await startJournal(page);
    await writeNote(page, 'In the first journal');
    await addJournal(page, 'Second');

    await page.goto('/settings#journals');
    await page.getByRole('button', { name: 'Delete Second' }).click();
    await page.getByRole('textbox', { name: /type/i }).fill('Second');
    await page.getByRole('button', { name: /^delete journal/i }).click();

    await expect(
      page.getByRole('button', { name: 'Journal: My journal. Switch journal' }),
    ).toBeVisible();
    await page.goto('/journal');
    await expect(page.getByRole('article', { name: 'In the first journal' })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`the first run, Today, Settings and the other-tab screen have no serious accessibility violations: ${theme} theme`, async ({
    context,
    page,
  }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('moss:theme', value);
    }, theme);
    const check = async (label: string, target: Page) => {
      const results = await new AxeBuilder({ page: target })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `${label} (${theme})`,
      ).toEqual([]);
    };

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /welcome to/i })).toBeVisible();
    await check('first run', page);

    await page.getByRole('button', { name: 'Start my journal' }).click();
    await expect(page.getByRole('heading', { name: /welcome to/i })).toHaveCount(0);
    await writeNote(page, 'Example note');
    await check('today', page);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Keep your journal safe')).toBeVisible();
    await check('settings', page);

    const second = await context.newPage();
    await second.addInitScript((value) => {
      localStorage.setItem('moss:theme', value);
    }, theme);
    await second.goto('/');
    await expect(second.getByRole('heading', { name: /open in another tab/i })).toBeVisible();
    await check('other tab', second);
  });
}
