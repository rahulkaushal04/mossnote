import type { Page } from '@playwright/test';
import { encode } from '@shared/gameDate';
import { test, expect } from './fixtures';

const k = (year: number, season: number, day: number) => encode({ year, season, day });
const editor = (page: Page) => page.getByRole('combobox', { name: 'Note' });
const article = (page: Page, name: string | RegExp) => page.getByRole('article', { name });

test.describe('reading and editing a note', () => {
  test('an edit autosaves, persists across a reload, and only updatedAt moves', async ({
    page,
    seed,
  }) => {
    const note = await seed.note({ body: 'before', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'before').getByText('before').click();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(' and after');
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 4000 });
    await page.reload();
    await expect(article(page, 'before and after')).toBeVisible();
    const saved = await seed.get<{ createdAt: string; updatedAt: string }>(`/api/notes/${note.id}`);
    expect(saved.createdAt).toBe(note.createdAt);
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(note.createdAt));
  });

  test('e edits the focused entry, and Escape ends editing and keeps the change', async ({
    page,
    seed,
  }) => {
    await seed.note({ body: 'keyboard edit', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    const entry = article(page, 'keyboard edit');
    await entry.focus();
    await page.keyboard.press('e');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await expect(article(page, 'keyboard edit!')).toBeVisible();
    expect((await seed.notes()).items[0]?.body).toBe('keyboard edit!');
  });

  test('Ctrl+Enter finishes editing', async ({ page, seed }) => {
    await seed.note({ body: 'finish me', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'finish me').getByText('finish me').click();
    await page.keyboard.press('Control+Enter');
    await expect(editor(page)).toHaveCount(0);
  });

  test('raw HTML and script text are shown literally and never run', async ({ page, seed }) => {
    await seed.note({
      body: '<script>window.__pwned = true</script> <img src=x onerror="window.__pwned = true"> <b>not bold</b>',
      gameDate: k(1, 0, 1),
    });
    await page.goto('/journal');
    const entry = page.getByRole('article').first();
    await expect(entry).toContainText('<script>window.__pwned = true</script>');
    await expect(entry).toContainText('<b>not bold</b>');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
    await expect(page.locator('article script, article img, article b')).toHaveCount(0);
  });

  test('the Markdown subset renders; headings, tables and code blocks stay plain text; links are safe', async ({
    page,
    seed,
  }) => {
    await seed.note({
      body: [
        '**bold** and *italic* and `code`',
        '',
        '- one',
        '- two',
        '',
        '> a quote',
        '',
        '# Not a heading',
        '',
        '[safe](https://example.com/page) [unsafe](javascript:alert(1))',
      ].join('\n'),
      gameDate: k(1, 0, 1),
    });
    await page.goto('/journal');
    const entry = page.getByRole('article').first();
    await expect(entry.locator('strong')).toHaveText('bold');
    await expect(entry.locator('em')).toHaveText('italic');
    await expect(entry.locator('code')).toHaveText('code');
    await expect(entry.getByRole('listitem')).toHaveCount(2);
    await expect(entry.locator('blockquote')).toContainText('a quote');
    await expect(entry.locator('h1, h2')).toHaveCount(0);
    await expect(entry).toContainText('# Not a heading');
    const safe = entry.getByRole('link', { name: /safe/ });
    await expect(safe).toHaveAttribute('href', 'https://example.com/page');
    await expect(safe).toHaveAttribute('target', '_blank');
    await expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(entry.getByRole('link', { name: /^unsafe/ })).toHaveCount(0);
    await expect(entry).toContainText('unsafe');
  });

  test('emptying a note reverts it, shows the message, and leaves the stored note unchanged', async ({
    page,
    seed,
  }) => {
    await seed.note({ body: 'do not lose me', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'do not lose me').getByText('do not lose me').click();
    await editor(page).fill('');
    await expect(page.getByText("A note can't be empty. Delete it instead?")).toBeVisible({
      timeout: 4000,
    });
    await expect(editor(page)).toHaveValue('do not lose me');
    expect((await seed.notes()).items[0]?.body).toBe('do not lose me');
  });

  test('a stale edit shows the conflict banner and never overwrites silently', async ({
    page,
    seed,
  }) => {
    const note = await seed.note({ body: 'version one', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'version one').getByText('version one').click();
    await seed.patchNote(note.id, { body: 'changed elsewhere' });
    await editor(page).press('End');
    await page.keyboard.type(' mine');
    await expect(page.getByText('This note changed in another window.')).toBeVisible({
      timeout: 4000,
    });
    expect((await seed.notes()).items[0]?.body).toBe('changed elsewhere');
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(editor(page)).toHaveValue('changed elsewhere');
  });

  test('Keep mine saves over the newer version on purpose', async ({ page, seed }) => {
    const note = await seed.note({ body: 'original', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'original').getByText('original').click();
    await seed.patchNote(note.id, { body: 'theirs' });
    await editor(page).fill('mine');
    await expect(page.getByText('This note changed in another window.')).toBeVisible({
      timeout: 4000,
    });
    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expect.poll(async () => (await seed.notes()).items[0]?.body).toBe('mine');
  });

  test('the note page shows the whole note and "Linked from"', async ({ page, seed }) => {
    const target = await seed.note({ title: 'Target', body: 'target body', gameDate: k(1, 0, 1) });
    await seed.note({
      body: 'points at target',
      gameDate: k(1, 0, 2),
      links: [{ type: 'note', id: target.id }],
    });
    await page.goto(`/notes/${target.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Note' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Target' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Linked from' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'points at target' })).toBeVisible();
  });

  test('a missing or deleted note says so, with a link to Recently deleted', async ({
    page,
    seed,
  }) => {
    const note = await seed.note({ body: 'short lived', gameDate: k(1, 0, 1) });
    await page.request.delete(`${seed.url}/api/notes/${note.id}`, {
      headers: { 'X-Moss-Client': 'web', 'Content-Type': 'application/json' },
    });
    await page.goto(`/notes/${note.id}`);
    await expect(page.getByText("This note isn't here. It may have been deleted.")).toBeVisible();
    await page.getByRole('link', { name: 'Recently deleted' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Recently deleted' })).toBeVisible();
  });

  test('a long note collapses with Show more in lists, and shows fully on its page', async ({
    page,
    seed,
  }) => {
    const long = Array.from({ length: 30 }, (_, i) => `line number ${i}`).join('\n');
    const note = await seed.note({ body: long, gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    const entry = page.getByRole('article').first();
    await expect(entry.getByRole('button', { name: 'Show more' })).toBeVisible();
    await entry.getByRole('button', { name: 'Show more' }).click();
    await expect(entry.getByRole('button', { name: 'Show less' })).toBeVisible();
    await page.goto(`/notes/${note.id}`);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(page.getByText('line number 29')).toBeVisible();
  });
});

test.describe('the … menu, flags, delete and undo', () => {
  test('the discovery flag toggles from the menu, persists, and has an accessible name', async ({
    page,
    seed,
  }) => {
    await seed.note({ body: 'flag me', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'flag me').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Mark as discovery' }).click();
    await expect(page.getByRole('img', { name: 'Discovery' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('img', { name: 'Discovery' })).toBeVisible();
    await article(page, 'flag me').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove discovery' }).click();
    await expect(page.getByRole('img', { name: 'Discovery' })).toHaveCount(0);
  });

  test('delete, Undo from the toast, and the note returns with its tags', async ({
    page,
    seed,
  }) => {
    await seed.note({ body: 'oops', tags: ['keep'], gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'oops').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(article(page, 'oops')).toHaveCount(0);
    await expect(page.getByRole('status').getByText('Note deleted')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(article(page, 'oops')).toBeVisible();
    await expect(article(page, 'oops').getByText('#keep')).toBeVisible();
  });

  test('u undoes while the toast is visible; after it expires the note is still in Recently deleted', async ({
    page,
    seed,
  }) => {
    await seed.note({ body: 'undo with u', gameDate: k(1, 0, 1) });
    await page.goto('/journal');
    await article(page, 'undo with u').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(article(page, 'undo with u')).toHaveCount(0);
    await page.keyboard.press('u');
    await expect(article(page, 'undo with u')).toBeVisible();

    await article(page, 'undo with u').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByText('Note deleted')).toBeHidden({ timeout: 12_000 });
    await page.goto('/settings#trash');
    await expect(
      page.getByRole('list', { name: 'Recently deleted' }).getByText('undo with u'),
    ).toBeVisible();
  });

  test('Set date from the menu stamps the note', async ({ page, seed }) => {
    await seed.note({ body: 'needs a date' });
    await page.goto('/journal?undated=1');
    await article(page, 'needs a date').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set date' }).click();
    await page
      .getByRole('dialog')
      .or(page.getByRole('group', { name: 'Pick a date' }))
      .first()
      .waitFor();
    await page.getByRole('radio', { name: 'Fall' }).check();
    await page.keyboard.type('9');
    await page.getByRole('button', { name: 'Set date' }).click();
    await expect.poll(async () => (await seed.notes()).items[0]?.gameDate).toBe(k(1, 2, 9));
  });
});
