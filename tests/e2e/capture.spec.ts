import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const composer = (page: Page) => page.getByRole('combobox', { name: 'Note' });
const entry = (page: Page, text: string) => page.getByRole('article', { name: text });

test.describe('quick capture (flows 1 and 2)', () => {
  test('AC-CAP-1 and AC-G-11: loads focused, saves from the keyboard alone in under 5 seconds, sending only the body', async ({
    page,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() === 'POST')
        bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.continue();
    });
    const started = Date.now();
    await page.goto('/');
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type('x');
    await page.keyboard.press('Control+Enter');
    await expect(entry(page, 'x')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5000);

    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual(['body', 'id']);
    expect(bodies[0]?.body).toBe('x');
    // The composer is empty again and still focused (flow 2).
    await expect(composer(page)).toHaveValue('');
    await expect(composer(page)).toBeFocused();
  });

  test('the first screen is empty: no wizard, quiet copy, the real-date hint', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Nothing written today.')).toBeVisible();
    await expect(page.getByText('Set the in-game date to group notes by game day.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set date' })).toBeVisible();
  });

  test('AC-DAY-5: the hint can be dismissed and stays dismissed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Set the in-game date to group notes by game day.')).toBeHidden();
    await page.reload();
    await expect(page.getByText('Nothing written today.')).toBeVisible();
    await expect(page.getByText('Set the in-game date to group notes by game day.')).toBeHidden();
  });

  test('AC-CAP-2: a draft survives a reload exactly, and is gone after saving', async ({
    page,
  }) => {
    await page.goto('/');
    await composer(page).fill('half written thought');
    await page.getByRole('button', { name: 'Discovery' }).click();
    await page.waitForTimeout(450);
    await page.reload();
    await expect(composer(page)).toHaveValue('half written thought');
    await expect(page.getByRole('button', { name: 'Discovery' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await composer(page).press('Control+Enter');
    await expect(entry(page, 'half written thought')).toBeVisible();
    await page.waitForTimeout(450);
    await page.reload();
    await expect(composer(page)).toHaveValue('');
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('moss:draft:')),
      ),
    ).toEqual([]);
  });

  test('AC-CAP-5: whitespace-only text cannot be saved, and no error is shown', async ({
    page,
    seed,
  }) => {
    await page.goto('/');
    await composer(page).fill('   \n  ');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await composer(page).press('Control+Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await seed.notes()).items).toEqual([]);
  });

  test('Escape leaves the text box and keeps the draft', async ({ page }) => {
    await page.goto('/');
    await composer(page).fill('keep me');
    await page.keyboard.press('Escape');
    await expect(composer(page)).not.toBeFocused();
    await expect(composer(page)).toHaveValue('keep me');
  });

  test('a rapid double submit saves once', async ({ page, seed }) => {
    await page.goto('/');
    await composer(page).fill('once only');
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Enter');
    await expect(entry(page, 'once only')).toBeVisible();
    expect((await seed.notes()).items).toHaveLength(1);
  });
});

test.describe('structure while capturing (flow 3)', () => {
  test('AC-CAP-4: #abc then Enter creates the tag as a chip and removes the trigger text', async ({
    page,
  }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('plan #abc');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('option', { name: 'Create #abc' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveValue('plan ');
    await expect(page.getByRole('list', { name: 'Tags' }).getByText('#abc')).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('article').getByText('#abc')).toBeVisible();
  });

  test('AC-CAP-4 and AC-TAG-6: Esc closes the picker and creates nothing', async ({
    page,
    seed,
  }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('#abc');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(composer(page)).toHaveValue('#abc');
    await expect(page.getByRole('list', { name: 'Tags' })).toHaveCount(0);
    expect(await seed.get<unknown[]>('/api/tags')).toEqual([]);
  });

  test('while a picker is open, Enter never saves the note', async ({ page, seed }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('text #idea');
    await page.keyboard.press('Enter');
    expect((await seed.notes()).items).toEqual([]);
    await expect(page.getByRole('list', { name: 'Tags' }).getByText('#idea')).toBeVisible();
  });

  test('a trailing line of #tokens becomes tags on save and leaves the body', async ({
    page,
    seed,
  }) => {
    await page.goto('/');
    await composer(page).fill('A thought.\n#one #Two');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('article', { name: 'A thought.' })).toBeVisible();
    const [saved] = (await seed.notes()).items;
    expect(saved?.tags).toEqual(['one', 'Two']);
    expect(saved?.body).toBe('A thought.');
  });

  test('pasted text never opens a picker', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await composer(page).click();
    await page.evaluate(async () => navigator.clipboard.writeText('pasted #tag @name [[x'));
    await page.keyboard.press('ControlOrMeta+V');
    await expect(composer(page)).toHaveValue('pasted #tag @name [[x');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    // Typing more characters after the paste does not reopen it for the pasted trigger either.
    await page.keyboard.type('y');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('AC-CAP-7 and AC-LNK-1: @ with no match offers Create person, makes exactly one, and links it', async ({
    page,
    seed,
  }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('Met @Zorbin');
    await expect(page.getByRole('option', { name: /Create person ‘Zorbin’/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveValue('Met Zorbin');
    await expect(page.getByRole('link', { name: 'Zorbin' })).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('article', { name: 'Met Zorbin' })).toBeVisible();
    const people = await seed.get<{ items: { name: string }[] }>('/api/people');
    expect(people.items.map((p) => p.name)).toEqual(['Zorbin']);
    const [saved] = (await seed.notes()).items;
    expect(saved).toBeTruthy();
  });

  test('@ selects an existing person, inserts the name as plain text and adds a link chip', async ({
    page,
    seed,
  }) => {
    const person = await seed.person('Sam Example');
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('Talked to @sa');
    await expect(page.getByRole('option', { name: 'Sam Example' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveValue('Talked to Sam Example');
    await page.keyboard.press('Control+Enter');
    const article = page.getByRole('article', { name: 'Talked to Sam Example' });
    await expect(article.getByRole('link', { name: 'Sam Example' })).toHaveAttribute(
      'href',
      `/people/${person.id}`,
    );
  });

  test('AC-LNK-6: an email address never opens the people picker', async ({ page }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('write to someone@example.com');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('[[ links a note or farm entry as a chip only', async ({ page, seed }) => {
    const target = await seed.note({ title: 'Target note', body: 'hello' });
    await seed.planting('Row one');
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('see [[tar');
    await expect(page.getByRole('option', { name: /Target note/ })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(composer(page)).toHaveValue('see ');
    await expect(page.getByRole('link', { name: 'Target note' })).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(
      page.getByRole('article', { name: 'see' }).getByRole('link', { name: 'Target note' }),
    ).toHaveAttribute('href', `/notes/${target.id}`);
  });

  test('/ opens the command menu: Title shows the title field, Discovery toggles the flag', async ({
    page,
  }) => {
    await page.goto('/');
    await composer(page).click();
    await page.keyboard.type('/ti');
    await expect(page.getByRole('option', { name: 'Title' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeFocused();
    await composer(page).click();
    await page.keyboard.type('/disc');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Discovery' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(composer(page)).toHaveValue('');
  });

  test('a title, a discovery and a question are saved with the note', async ({ page, seed }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Note' }).fill('Why is it here?');
    await page.getByRole('button', { name: 'Title' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('A puzzle');
    await page.getByRole('button', { name: 'Discovery' }).click();
    await page.getByRole('button', { name: 'Question' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'A puzzle' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Discovery' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Open question' })).toBeVisible();
    const [saved] = (await seed.notes()).items;
    expect(saved?.body).toBe('Why is it here?');
  });
});

test.describe('failing saves (AC-CAP-6)', () => {
  test.describe.configure({ mode: 'serial' });

  test('with the server stopped the page says so and keeps the draft; after restart the text is back and saves once', async ({
    page,
    server,
    seed,
  }) => {
    await page.goto('/');
    await composer(page).fill('survives an outage');
    await server.stop();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: "Can't reach your journal." })).toBeVisible({
      timeout: 10_000,
    });
    expect(await page.evaluate(() => localStorage.getItem('moss:draft:home'))).toContain(
      'survives an outage',
    );
    await server.start();
    await expect(composer(page)).toHaveValue('survives an outage', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(entry(page, 'survives an outage')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('article', { name: 'survives an outage' })).toHaveCount(1);
    expect((await seed.notes()).items).toHaveLength(1);
  });

  test('a server error keeps the text, shows an inline error, and Retry reuses the id so there is no duplicate', async ({
    page,
    seed,
  }) => {
    const ids: string[] = [];
    let failures = 1;
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      ids.push((route.request().postDataJSON() as { id: string }).id);
      if (failures-- > 0) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'internal', message: 'Something went wrong. Reference abc.' },
          }),
        });
      }
      return route.continue();
    });
    await page.goto('/');
    await composer(page).fill('needs a retry');
    await page.keyboard.press('Control+Enter');
    await expect(
      page.getByRole('alert').getByText("Couldn't save. Your text is still here."),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue('needs a retry');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(entry(page, 'needs a retry')).toBeVisible();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect((await seed.notes()).items).toHaveLength(1);
  });
});
