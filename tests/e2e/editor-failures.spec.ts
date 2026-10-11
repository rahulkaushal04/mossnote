import { test, expect } from './fixtures';

test.describe('editors tell you when a change could not be saved', () => {
  test('a person: a failed rename shows a message', async ({ page, seed }) => {
    const person = await seed.post<{ id: string }>('/api/people', { name: 'Example Person' });
    await page.goto(`/people/${person.id}`);
    await page.route('**/api/people/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );

    await page.getByLabel('Name', { exact: true }).fill('Renamed');
    await page.getByLabel('Name', { exact: true }).blur();

    await expect(page.getByText("Couldn't save that change.")).toBeVisible();
  });

  test('a person: fields that fail to save show the error beside them', async ({ page, seed }) => {
    const person = await seed.post<{ id: string }>('/api/people', { name: 'Example Person' });
    await page.goto(`/people/${person.id}`);
    await page.route('**/api/people/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );

    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByPlaceholder('Label').fill('Likes');
    await page.getByPlaceholder('Value').fill('Cheese');

    await expect(page.getByRole('alert').filter({ hasText: /reach your journal/i })).toBeVisible({
      timeout: 4000,
    });
  });

  test('a person: a value typed without a label says why it is not saved', async ({
    page,
    seed,
  }) => {
    const person = await seed.post<{ id: string }>('/api/people', { name: 'Example Person' });
    await page.goto(`/people/${person.id}`);

    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByPlaceholder('Value').fill('Cheese');

    await expect(page.getByText('Add a label to save this field.')).toBeVisible();
  });

  test('a farm entry: notes that fail to save show the error', async ({ page, seed }) => {
    await seed.reset('stardew');
    const entry = await seed.post<{ id: string }>('/api/plantings', { label: 'Example row' });
    await page.goto(`/farm/${entry.id}`);
    await page.route('**/api/plantings/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );

    await page.getByLabel('Notes about this entry').fill('Some notes');

    await expect(page.getByRole('alert').filter({ hasText: /reach your journal/i })).toBeVisible({
      timeout: 4000,
    });
  });
});
