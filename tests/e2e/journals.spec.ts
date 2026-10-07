import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { ulid } from 'ulid';
import { createServer, runServerOnce, type MossServer } from './fixtures';

/**
 * Journals, templates and snapshots in a real browser. Each test starts its own server on an
 * empty data folder, which is what a first run looks like.
 */
const test = base.extend<{ fresh: MossServer }>({
  // eslint-disable-next-line no-empty-pattern
  fresh: async ({}, use) => {
    const server = await createServer();
    await use(server);
    await server.stop();
    fs.rmSync(server.dataDir, { recursive: true, force: true });
  },
});

const HEADERS = { 'X-Moss-Client': 'web' };

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

const makeJournal = async (
  request: APIRequestContext,
  server: MossServer,
  name: string,
  template: 'default' | 'stardew',
) => {
  const res = await request.post(`${server.url}/api/journals`, {
    headers: HEADERS,
    data: { name, template },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
};

const addNote = async (request: APIRequestContext, server: MossServer, body: string) => {
  const res = await request.post(`${server.url}/api/notes`, {
    headers: HEADERS,
    data: { id: ulid(), body },
  });
  expect(res.ok(), await res.text()).toBe(true);
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Primary' }).first();
const switcher = (page: Page) => page.getByRole('button', { name: /^Journal: .*Switch journal$/ });

test.describe('a first run', () => {
  test('asks which template, with Default chosen, and is usable by keyboard alone', async ({
    page,
    fresh,
  }) => {
    await page.goto(fresh.url);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Welcome to Mossnote' }),
    ).toBeVisible();
    const group = page.getByRole('group', { name: 'Which template?' });
    const plain = group.getByRole('radio', { name: /Default/ });
    const farm = group.getByRole('radio', { name: /Stardew Valley/ });
    await expect(plain).toBeChecked();
    await expect(page.getByRole('link', { name: 'Request a template' })).toHaveAttribute(
      'href',
      /issues\/new\?template=feature_request\.yml$/,
    );

    await plain.focus();
    await page.keyboard.press('ArrowDown');
    await expect(farm).toBeChecked();
    await page.getByLabel('Journal name').fill('Farm game');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(rail(page).getByRole('link', { name: 'Farm' })).toBeVisible();
    await expect(switcher(page)).toHaveAccessibleName('Journal: Farm game. Switch journal');
    expect(fs.existsSync(path.join(fresh.dataDir, 'farm-game.db'))).toBe(true);

    // And the next start goes straight in.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations: ${theme} theme`, async ({ page, fresh }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('moss:theme', value);
      }, theme);
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(fresh.url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await violations(page), `${theme} ${width}px`).toEqual([]);
      }
    });
  }

  test('says what is wrong in plain words and keeps what was typed', async ({ page, fresh }) => {
    await page.goto(fresh.url);
    await page.getByLabel('Journal name').fill('');
    await page.getByRole('button', { name: 'Start my journal' }).click();
    await expect(page.getByText('Give the journal a name. You can change it later.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Welcome to Mossnote' }),
    ).toBeVisible();
  });
});

test('the first-run screen and the journal screens make no request beyond the local server', async ({
  page,
  context,
  request,
  fresh,
}) => {
  const blocked: string[] = [];
  await context.route(
    (url) => url.hostname !== '127.0.0.1',
    async (route) => {
      blocked.push(route.request().url());
      await route.abort();
    },
  );
  await page.goto(fresh.url);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Mossnote' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await makeJournal(request, fresh, 'One', 'default');
  await makeJournal(request, fresh, 'Two', 'stardew');
  for (const route of ['/settings#journals', '/settings#data', '/']) {
    await page.goto(`${fresh.url}${route}`);
    await page.waitForLoadState('networkidle');
  }
  await switcher(page).click();
  await page.getByRole('menuitem', { name: 'New journal…' }).click();
  await expect(page.getByRole('link', { name: 'Request a template' })).toBeVisible();
  // The link is only an address: nothing is fetched until a person follows it.
  expect(blocked).toEqual([]);
});

test.describe('journals side by side', () => {
  test('two Default journals and a Stardew Valley one keep their own data, calendar and sections', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'Game one', 'default');
    await addNote(request, fresh, 'only in game one');
    await makeJournal(request, fresh, 'Game two', 'default');
    await addNote(request, fresh, 'only in game two');
    await makeJournal(request, fresh, 'Farm game', 'stardew');
    await addNote(request, fresh, 'only in the farm game');

    await page.goto(fresh.url);
    await expect(rail(page).getByRole('link', { name: 'Farm' })).toBeVisible();
    await expect(page.getByText('Set date')).toBeVisible();
    await expect(page.getByText('only in the farm game')).toBeVisible();
    await expect(page.getByText('only in game one')).toHaveCount(0);

    // Switch with the menu.
    await switcher(page).click();
    await page.getByRole('menuitem', { name: /Game one/ }).click();
    await expect(switcher(page)).toHaveAccessibleName('Journal: Game one. Switch journal');
    await expect(rail(page).getByRole('link', { name: 'Farm' })).toHaveCount(0);
    await expect(rail(page).getByRole('link', { name: 'Maps' })).toBeVisible();

    // A plain day counter, not seasons.
    await page.getByRole('button', { name: 'Set date' }).click();
    await page.getByLabel('Day', { exact: true }).fill('120');
    await page.getByLabel('Day', { exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: /Day 120/ })).toBeVisible();
    await expect(page.getByText(/Spring|Summer|Season/)).toHaveCount(0);

    await page.goto(`${fresh.url}/journal`);
    await expect(page.getByText('only in game one')).toBeVisible();
    await expect(page.getByText('only in game two')).toHaveCount(0);
    await page.goto(`${fresh.url}/farm`);
    await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();

    const list = (await (await request.get(`${fresh.url}/api/journals`)).json()) as {
      items: { name: string; template: string }[];
    };
    expect(list.items.map((j) => [j.name, j.template])).toEqual([
      ['Farm game', 'stardew'],
      ['Game one', 'default'],
      ['Game two', 'default'],
    ]);
  });

  test('a new journal can be made from the switcher, with a name and a template', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'First', 'default');
    await page.goto(fresh.url);
    await switcher(page).click();
    await page.getByRole('menuitem', { name: 'New journal…' }).click();
    const dialog = page.getByRole('dialog', { name: 'New journal' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Stardew Valley/ }).check();
    await dialog.getByLabel('Journal name').fill('Second');
    await dialog.getByRole('button', { name: 'Make journal' }).click();
    await expect(switcher(page)).toHaveAccessibleName('Journal: Second. Switch journal');
    await expect(rail(page).getByRole('link', { name: 'Farm' })).toBeVisible();
  });

  test('a window left on the old journal is stopped before it can write into the new one', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'Left behind', 'default');
    await page.goto(fresh.url);
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    // Another window switches.
    await makeJournal(request, fresh, 'Elsewhere', 'default');
    await page.getByRole('link', { name: 'Journal', exact: true }).first().click();
    await expect(page.getByText('You switched journals in another window')).toBeVisible();
    const notes = (await (await request.get(`${fresh.url}/api/notes`)).json()) as {
      items: unknown[];
    };
    expect(notes.items).toHaveLength(0);
  });
});

test.describe('rename and delete', () => {
  test('renames a journal and deletes another only after its name is typed', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'Keeper', 'default');
    await addNote(request, fresh, 'kept');
    await makeJournal(request, fresh, 'Doomed', 'default');
    await page.goto(`${fresh.url}/settings#journals`);

    await page.getByRole('button', { name: 'Rename Keeper' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename journal' });
    await rename.getByLabel('Journal name').fill('Kept safe');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('list', { name: 'Journals' }).getByText('Kept safe')).toBeVisible();

    await page.getByRole('button', { name: 'Delete Doomed' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete “Doomed”?' });
    const confirm = dialog.getByRole('button', { name: 'Delete journal' });
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole('link', { name: 'Download JSON' })).toHaveAttribute(
      'href',
      '/api/journals/doomed/export.json',
    );
    await expect(dialog.getByRole('checkbox')).toBeChecked();
    await dialog.getByLabel(/Type the journal.s name/).fill('Doom');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type the journal.s name/).fill('Doomed');
    await confirm.click();

    await expect(switcher(page)).toHaveAccessibleName('Journal: Kept safe. Switch journal');
    expect(fs.existsSync(path.join(fresh.dataDir, 'doomed.db'))).toBe(false);
    const kept = fs.readdirSync(path.join(fresh.dataDir, 'backups'));
    expect(kept.some((f) => f.startsWith('doomed-') && f.endsWith('-manual.db'))).toBe(true);
    await page.goto(`${fresh.url}/journal`);
    await expect(page.getByText('kept', { exact: true })).toBeVisible();
  });

  test('exporting a journal that is not open gives that journal’s notes', async ({
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'Elsewhere', 'default');
    await addNote(request, fresh, 'written elsewhere');
    await makeJournal(request, fresh, 'Here', 'default');
    const res = await request.get(`${fresh.url}/api/journals/elsewhere/export.md`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('written elsewhere');
  });
});

test.describe('snapshots', () => {
  test('restores an earlier snapshot from Settings and can delete one', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'Restorable', 'default');
    await addNote(request, fresh, 'before the snapshot');
    await page.goto(`${fresh.url}/settings#data`);
    await page.getByRole('button', { name: 'Back up now' }).click();
    const list = page.getByRole('list', { name: 'Snapshots' });
    await expect(list.getByText('Made by you')).toBeVisible();
    await addNote(request, fresh, 'after the snapshot');

    await list
      .getByRole('button', { name: /^Restore the snapshot/ })
      .first()
      .click();
    const confirm = page.getByRole('dialog', { name: 'Restore this snapshot?' });
    await expect(confirm).toContainText('saved as a snapshot first');
    await confirm.getByRole('button', { name: 'Restore' }).click();

    await expect(async () => {
      const notes = (await (await request.get(`${fresh.url}/api/notes`)).json()) as {
        items: { body: string }[];
      };
      expect(notes.items.map((n) => n.body)).toEqual(['before the snapshot']);
    }).toPass();
    // The journal as it was just before the restore is kept, and can be restored in turn.
    await expect(
      page.getByRole('list', { name: 'Snapshots' }).getByText('Before a restore'),
    ).toBeVisible();

    await page
      .getByRole('list', { name: 'Snapshots' })
      .getByRole('button', { name: /^Delete the snapshot/ })
      .first()
      .click();
    await page
      .getByRole('dialog', { name: 'Delete this snapshot?' })
      .getByRole('button', { name: 'Delete snapshot' })
      .click();
    await expect(page.getByText('Snapshot deleted.')).toBeVisible();
  });

  test('shows where the data lives and can open the folder', async ({ page, request, fresh }) => {
    await makeJournal(request, fresh, 'Located', 'default');
    await page.goto(`${fresh.url}/settings#data`);
    await expect(page.getByText(fresh.dataDir).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder' })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`journal screens have no serious accessibility violations: ${theme} theme`, async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'One', 'default');
    await makeJournal(request, fresh, 'Two', 'stardew');
    await page.addInitScript((value) => {
      localStorage.setItem('moss:theme', value);
    }, theme);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${fresh.url}/settings#journals`);
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await violations(page), `settings ${theme} ${width}`).toEqual([]);

      await switcher(page).click();
      await expect(page.getByRole('menuitem', { name: 'New journal…' })).toBeVisible();
      expect(await violations(page), `menu ${theme} ${width}`).toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'New journal…' }).first().click();
      await expect(page.getByRole('dialog', { name: 'New journal' })).toBeVisible();
      expect(await violations(page), `new journal ${theme} ${width}`).toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Delete One' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await violations(page), `delete ${theme} ${width}`).toEqual([]);
      await page.keyboard.press('Escape');
    }
  });
}

test.describe('upgrades', () => {
  test('the single-journal layout of earlier versions opens with no question asked', async ({
    page,
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'journal', 'stardew');
    await addNote(request, fresh, 'written long ago');
    await fresh.stop();
    // Make it look like an older version left it: no stored layout, no remembered journal.
    const db = new BetterSqlite3(path.join(fresh.dataDir, 'journal.db'));
    db.prepare("DELETE FROM settings WHERE key = 'layout'").run();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    fs.rmSync(path.join(fresh.dataDir, 'active-journal'), { force: true });
    await fresh.start();

    await page.goto(fresh.url);
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(switcher(page)).toHaveAccessibleName('Journal: My journal. Switch journal');
    // Seasons and Farm, as before.
    await expect(rail(page).getByRole('link', { name: 'Farm' })).toBeVisible();
    await page.goto(`${fresh.url}/journal`);
    await expect(page.getByText('written long ago')).toBeVisible();
  });

  test('a journal from a newer version is refused with a clear message and left untouched', async ({
    request,
    fresh,
  }) => {
    await makeJournal(request, fresh, 'From the future', 'default');
    await fresh.stop();
    const file = path.join(fresh.dataDir, 'from-the-future.db');
    const db = new BetterSqlite3(file);
    db.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)",
    ).run();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const before = fs.readFileSync(file);

    const result = await runServerOnce({ MOSS_DATA_DIR: fresh.dataDir, MOSS_PORT: '4398' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('made by a newer version of Mossnote');
    expect(result.stderr).toContain('Nothing was changed');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(fresh.dataDir, 'from-the-future.lock'))).toBe(false);
  });
});
