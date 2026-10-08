import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

export { expect, test };

export const composer = (page: Page) => page.getByRole('combobox', { name: 'Note' });

/** First run: pick the Default template and open the new journal. */
export async function startJournal(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome to/i })).toBeVisible();
  await page.getByRole('button', { name: 'Start my journal' }).click();
  await expect(page.getByRole('heading', { name: /welcome to/i })).toHaveCount(0);
}

export async function writeNote(page: Page, text: string) {
  await expect(
    page.getByRole('article').or(page.getByText('Nothing written today.')).first(),
  ).toBeVisible();
  const saved = page.getByRole('article', { name: text }).first();
  await expect(async () => {
    if ((await saved.count()) === 0) {
      await composer(page).fill(text);
      await composer(page).press('Control+Enter');
    }
    await expect(saved).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
}

/** Make another journal from Settings and wait until the app has switched to it. */
export async function addJournal(page: Page, name: string) {
  await page.goto('/settings#journals');
  await page
    .locator('#journals')
    .getByRole('button', { name: /new journal/i })
    .click();
  await page.getByRole('textbox', { name: 'Journal name' }).fill(name);
  await page.getByRole('button', { name: 'Make journal' }).click();
  await expect(
    page.getByRole('button', { name: `Journal: ${name}. Switch journal` }),
  ).toBeVisible();
}
