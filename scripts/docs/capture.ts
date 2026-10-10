import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  APP_URL,
  IMG_DIR,
  VIDEO_DIR,
  glide,
  launch,
  saveVideo,
  shot,
  showCursor,
  startJournal,
  type Launch,
} from './lib.ts';

/**
 * Captures every screenshot and recording used in the documentation, from the real app.
 *
 *   npm run build:standalone
 *   npm run preview:standalone          # serves the web version on http://127.0.0.1:4318
 *   npx tsx scripts/docs/capture.ts     # all scenes, or name some: capture.ts first-run notes
 *
 * Each scene starts a fresh browser with empty storage, types real text and clicks real buttons,
 * then photographs the result. The numbered orange boxes are drawn on the live page for the
 * picture and removed again; nothing else is added to the interface.
 */

const scenes: Record<string, (l: Launch) => Promise<void>> = {};
const scene = (name: string, run: (l: Launch) => Promise<void>) => {
  scenes[name] = run;
};
/** Scenes that are recorded. They run in a browser that films the page and draws the pointer. */
const videoScenes = new Set<string>();
const videoScene = (name: string, run: (l: Launch) => Promise<void>) => {
  videoScenes.add(name);
  scenes[name] = run;
};

const wait = (page: Page, ms = 350) => page.waitForTimeout(ms);
const composer = (page: Page) => page.getByRole('combobox', { name: 'Note' }).first();

/** Types into the composer the way a person does, so the `#`, `@`, `[[` and `/` pickers open. */
async function type(page: Page, text: string, delay = 12): Promise<void> {
  await page.keyboard.type(text, { delay });
}

/** Set today's in-game date from the Today header. `value` is typed into the picker. */
async function setToday(page: Page, value: string): Promise<void> {
  await page
    .getByRole('button', { name: /Set date|Change date/ })
    .first()
    .click();
  await wait(page);
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await wait(page);
}

/** A small journal with a few notes of each kind, written through the interface. */
async function seedDefault(page: Page): Promise<void> {
  await setToday(page, '12');
  await composer(page).focus();
  await type(page, 'Found a locked door behind the waterfall. Need a key?');
  await page.getByRole('button', { name: 'Question' }).click();
  await composer(page).focus();
  await page.keyboard.press('Meta+Enter');
  await wait(page);

  await composer(page).focus();
  await type(page, 'Met a fisher by the river. @Mara');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await type(page, ' says the old bridge washed out. #lead');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await page.keyboard.press('Meta+Enter');
  await wait(page);

  await composer(page).focus();
  await type(page, 'Picked up a strange lantern near the ruins.');
  await page.getByRole('button', { name: 'Discovery' }).click();
  await composer(page).focus();
  await page.keyboard.press('Meta+Enter');
  await wait(page);
}

// ---------------------------------------------------------------------------------------------
// Getting started and the interface
// ---------------------------------------------------------------------------------------------

scene('first-run', async ({ page }) => {
  await page.goto(`${APP_URL}/`);
  await page.getByRole('radio', { name: /Default/ }).waitFor();
  await wait(page, 600);
  await shot(page, 'first-run', {
    marks: [
      { n: 1, target: page.getByRole('radio', { name: /Default/ }), pad: 6 },
      { n: 2, target: page.getByRole('radio', { name: /Stardew Valley/ }), pad: 6 },
      { n: 3, target: page.getByLabel('Journal name') },
      { n: 4, target: page.getByRole('button', { name: 'Start my journal' }) },
    ],
  });
});

scene('today-empty', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await wait(page, 600);
  await shot(page, 'today-empty', {
    marks: [
      { n: 1, target: page.getByRole('region', { name: 'New note' }), pad: 6 },
      { n: 2, target: page.getByRole('button', { name: /Set date/ }).first() },
      { n: 3, target: page.getByRole('button', { name: 'Hide this tip' }) },
    ],
  });
});

scene('interface', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await wait(page, 600);
  await shot(page, 'interface-desktop', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: /Journal: / }) },
      { n: 2, target: page.getByRole('button', { name: /^Search/ }).first() },
      { n: 3, target: page.getByRole('button', { name: 'New note' }).first() },
      {
        n: 4,
        target: page.getByRole('navigation', { name: 'Primary' }).getByRole('link').first(),
        pad: 2,
      },
      { n: 5, target: page.getByRole('link', { name: 'Settings' }).first() },
      { n: 6, target: page.getByRole('group', { name: 'Current in-game date' }) },
      { n: 7, target: page.getByRole('region', { name: 'New note' }), pad: 6 },
    ],
  });
});

// ---------------------------------------------------------------------------------------------
// Writing notes
// ---------------------------------------------------------------------------------------------

scene('composer', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await composer(page).focus();
  await type(page, 'Found a locked door behind the waterfall.');
  const bar = page.getByRole('group', { name: 'Note options' });
  await shot(page, 'composer-options', {
    marks: [
      { n: 1, target: bar.getByRole('button', { name: /Day 12/ }).first(), pad: 2 },
      { n: 2, target: bar.getByRole('button', { name: 'Discovery' }), pad: 1 },
      { n: 3, target: bar.getByRole('button', { name: 'Question' }), pad: 1 },
      { n: 4, target: bar.getByRole('button', { name: 'Title' }), pad: 1 },
      { n: 5, target: bar.getByRole('button', { name: 'Tag' }), pad: 1 },
      { n: 6, target: bar.getByRole('button', { name: 'Link' }), pad: 1 },
      { n: 7, target: page.getByRole('button', { name: /^Save/ }) },
    ],
    clip: { x: 262, y: 160, width: 900, height: 210 },
  });

  // Person picker
  await composer(page).fill('');
  await type(page, 'Spoke to @Ma');
  await wait(page, 600);
  await shot(page, 'picker-person', {
    marks: [{ n: 1, target: page.getByRole('listbox') }],
    clip: { x: 262, y: 160, width: 900, height: 330 },
  });
  await page.keyboard.press('Escape');

  // Tag picker
  await composer(page).fill('');
  await type(page, 'The bridge is out. #le');
  await wait(page, 600);
  await shot(page, 'picker-tag', {
    marks: [{ n: 1, target: page.getByRole('listbox') }],
    clip: { x: 262, y: 160, width: 900, height: 330 },
  });
  await page.keyboard.press('Escape');

  // Slash menu
  await composer(page).fill('');
  await type(page, '/');
  await wait(page, 500);
  await shot(page, 'picker-slash', {
    marks: [{ n: 1, target: page.getByRole('listbox') }],
    clip: { x: 262, y: 160, width: 900, height: 400 },
  });
});

scene('notes', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await wait(page, 500);
  // The link picker
  await composer(page).focus();
  await type(page, 'Back at the door, see [[');
  await wait(page, 600);
  await shot(page, 'picker-link', {
    marks: [{ n: 1, target: page.getByRole('listbox') }],
    clip: { x: 262, y: 160, width: 900, height: 360 },
  });
  await page.keyboard.press('Escape');
  await composer(page).fill('');
  // Note menu
  const first = page.getByRole('button', { name: 'More actions' }).first();
  const firstBox = (await first.boundingBox())!;
  await first.click();
  await wait(page);
  await shot(page, 'note-menu', {
    marks: [
      { n: 1, target: page.getByRole('menu') },
      { n: 2, target: firstBox },
    ],
  });
  await page.keyboard.press('Escape');
  // Question: mark solved
  await page.getByRole('button', { name: 'Mark solved' }).click();
  await wait(page);
  await page.getByLabel('What was the answer? (optional)').fill('The key was in the lighthouse.');
  await shot(page, 'question-solve', {
    marks: [
      { n: 1, target: page.getByLabel('What was the answer? (optional)') },
      { n: 2, target: page.getByRole('button', { name: 'Skip' }) },
    ],
  });
  await page.keyboard.press('Enter');
  await wait(page, 500);
  await shot(page, 'question-solved', {
    marks: [{ n: 1, target: page.getByRole('button', { name: 'Reopen' }) }],
  });
  // Delete with undo
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await wait(page, 500);
  await shot(page, 'delete-undo', {
    toast: true,
    marks: [{ n: 1, target: page.getByRole('button', { name: /Undo/ }).first() }],
  });
});

scene('dates', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await page
    .getByRole('button', { name: /Set date/ })
    .first()
    .click();
  await wait(page);
  await shot(page, 'date-picker-counter', {
    marks: [{ n: 1, target: page.getByLabel('Pick a date') }],
    clip: { x: 262, y: 100, width: 700, height: 340 },
  });
  await page.keyboard.type('12');
  await page.keyboard.press('Enter');
  await wait(page);
  await shot(page, 'today-date-header', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: /Day 12/ }).first() },
      { n: 2, target: page.getByRole('button', { name: 'Previous day' }) },
      { n: 3, target: page.getByRole('button', { name: 'Next day' }) },
    ],
    clip: { x: 262, y: 20, width: 700, height: 200 },
  });
});

// ---------------------------------------------------------------------------------------------
// Looking back: Journal, Day, People, Tags, Search
// ---------------------------------------------------------------------------------------------

/** More days of notes, so the Journal has something to group and filter. Ends on day 14. */
async function seedDays(page: Page): Promise<void> {
  await seedDefault(page);
  await page.getByRole('button', { name: 'Next day' }).first().click();
  await wait(page);
  await composer(page).focus();
  await type(page, 'Crossed the river on the fallen log. @Mara');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await type(page, ' waved from the far bank. #lead');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await page.keyboard.press('Meta+Enter');
  await wait(page);
  await composer(page).focus();
  await type(page, 'Does the lantern react to anything? Try it at night.');
  await page.getByRole('button', { name: 'Question' }).click();
  await composer(page).focus();
  await page.keyboard.press('Meta+Enter');
  await wait(page);
  await page.getByRole('button', { name: 'Next day' }).first().click();
  await wait(page);
  await composer(page).focus();
  await type(page, 'Rain all day. Stayed inside and sorted my supplies.');
  await page.keyboard.press('Meta+Enter');
  await wait(page);
}

scene('journal', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDays(page);
  await page.getByRole('link', { name: 'Journal' }).first().click();
  await wait(page, 700);
  const filters = page.getByRole('group', { name: 'Journal filters' });
  await shot(page, 'journal-view', {
    marks: [
      { n: 1, target: filters.getByRole('radiogroup', { name: 'Show' }) },
      { n: 2, target: filters.getByRole('button', { name: 'Tag' }) },
      { n: 3, target: filters.getByRole('button', { name: 'Not dated' }) },
      { n: 4, target: filters.getByRole('button', { name: /first$/ }) },
    ],
  });
  await filters.getByRole('radio', { name: 'Questions' }).click();
  await wait(page, 500);
  await shot(page, 'journal-questions', {
    marks: [{ n: 1, target: filters.getByRole('radiogroup', { name: 'Question state' }) }],
  });
  await filters.getByRole('radio', { name: 'All' }).first().click();
  await filters.getByRole('button', { name: 'Tag' }).click();
  await wait(page);
  await shot(page, 'journal-tag-filter', {
    marks: [
      {
        n: 1,
        target: page
          .getByRole('dialog')
          .or(page.locator('[role=dialog], [data-radix-popper-content-wrapper]'))
          .first(),
      },
    ],
  });
});

scene('day', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDays(page);
  await page.getByRole('link', { name: 'Journal' }).first().click();
  await wait(page, 500);
  await page.getByRole('link', { name: 'Day 13', exact: true }).click();
  await wait(page, 700);
  await shot(page, 'day-page', {
    marks: [{ n: 1, target: page.getByRole('group', { name: 'Viewed in-game day' }) }],
  });
});

scene('people', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDays(page);
  await page.getByRole('link', { name: 'People' }).first().click();
  await wait(page, 600);
  await page.getByLabel('Add someone').fill('Old Tomas');
  await page.keyboard.press('Enter');
  await wait(page, 500);
  await page.getByLabel('Add someone').fill('Marta');
  await page.keyboard.press('Enter');
  await wait(page, 500);
  await shot(page, 'people-list', {
    marks: [
      { n: 1, target: page.getByLabel('Add someone') },
      { n: 2, target: page.getByLabel('Filter people') },
      { n: 3, target: page.getByRole('button', { name: /A to Z|Recently updated/ }) },
    ],
  });
  await page.getByRole('link', { name: 'Mara' }).first().click();
  await wait(page, 700);
  await page.getByRole('button', { name: 'Track progress' }).click();
  await page.getByPlaceholder('max').fill('10');
  await page.getByRole('button', { name: 'Set' }).click();
  await wait(page, 400);
  await page.getByRole('radio', { name: '4 of 10' }).click();
  await page
    .getByPlaceholder('Anything you want to remember.')
    .first()
    .fill('Fishes at the river most mornings.');
  await wait(page, 1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1200, height: 1050 });
  await wait(page, 500);
  await shot(page, 'person-page', {
    marks: [
      { n: 1, target: page.getByRole('radiogroup', { name: /Progress/ }), pad: 6 },
      { n: 2, target: page.getByRole('button', { name: 'Stop tracking' }) },
      { n: 3, target: page.getByRole('button', { name: /Write about Mara/ }) },
    ],
  });
});

// ---------------------------------------------------------------------------------------------
// Stardew Valley template
// ---------------------------------------------------------------------------------------------

scene('stardew-start', async ({ page }) => {
  await startJournal(page, { template: 'Stardew Valley', name: 'Spring farm' });
  await wait(page, 600);
  await shot(page, 'stardew-today-empty', {
    marks: [
      {
        n: 1,
        target: page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: /Farm/ }),
        pad: 0,
      },
      {
        n: 2,
        target: page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: /NPCs/ }),
        pad: 0,
      },
      {
        n: 3,
        target: page
          .getByRole('group', { name: /quick actions/i })
          .or(page.getByText('Met someone').locator('..'))
          .first(),
      },
      { n: 4, target: page.getByRole('button', { name: /Set date/ }).first() },
    ],
  });
  await page
    .getByRole('button', { name: /Set date/ })
    .first()
    .click();
  await wait(page);
  console.log(await page.getByLabel('Pick a date').innerText());
  await shot(page, 'date-picker-seasons', {
    clip: { x: 262, y: 100, width: 760, height: 520 },
  });
});

async function setStardewDate(page: Page, season: string, day: number): Promise<void> {
  await page
    .getByRole('button', { name: /Set date|Change date/ })
    .first()
    .click();
  await wait(page);
  const picker = page.getByLabel('Pick a date');
  await picker.getByRole('radio', { name: season, exact: true }).check();
  await picker.getByRole('radio', { name: String(day), exact: true }).click();
  await picker.getByRole('button', { name: 'Set date', exact: true }).click();
  await wait(page);
}

scene('stardew', async ({ page }) => {
  await startJournal(page, { template: 'Stardew Valley', name: 'Spring farm' });
  await setStardewDate(page, 'Spring', 3);
  await composer(page).focus();
  await page.getByRole('button', { name: 'Met someone' }).click();
  await composer(page).focus();
  await type(page, 'Introduced myself to the shopkeeper. @Pel');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await shot(page, 'stardew-quick-action', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: 'Met someone' }) },
      { n: 2, target: page.locator('text=#met').first() },
    ],
    clip: { x: 262, y: 20, width: 900, height: 470 },
  });
  await page.keyboard.press('Meta+Enter');
  await wait(page);
  await composer(page).focus();
  await type(page, 'Found something shiny in the creek bed.');
  await page.getByRole('button', { name: 'Found something' }).click();
  await composer(page).focus();
  await page.keyboard.press('Meta+Enter');
  await wait(page);

  // Farm
  await page.getByRole('link', { name: 'Farm' }).first().click();
  await wait(page, 600);
  const add = page.getByLabel('Add an entry');
  for (const name of ['Parsnips', 'Potatoes', 'Cauliflower']) {
    await add.fill(name);
    await page.keyboard.press('Enter');
    await wait(page, 500);
  }
  // Move the calendar on, then harvest one entry.
  await page.getByRole('link', { name: 'Today' }).first().click();
  await wait(page, 500);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Next day' }).first().click();
    await wait(page, 200);
  }
  await page.getByRole('link', { name: 'Farm' }).first().click();
  await wait(page, 600);
  const row = page.getByRole('listitem').filter({ hasText: 'Parsnips' });
  await row.hover();
  await row.getByRole('button', { name: 'Harvested today' }).click();
  await wait(page, 400);
  await page.getByLabel('Harvested count').fill('15');
  const rowBox = (await row.boundingBox())!;
  await shot(page, 'farm-harvest', {
    marks: [
      { n: 1, target: page.getByLabel('Harvested count') },
      { n: 2, target: page.getByRole('button', { name: 'Save', exact: true }).first() },
    ],
    clip: { x: 262, y: Math.max(0, rowBox.y - 60), width: 900, height: 220 },
  });
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await wait(page, 500);
  await page.getByRole('link', { name: 'Potatoes' }).first().hover();
  await shot(page, 'farm-list', {
    marks: [
      { n: 1, target: add },
      { n: 2, target: page.getByRole('region', { name: 'Growing' }) },
      { n: 3, target: page.getByRole('region', { name: 'Done' }) },
    ],
  });
  await page.getByRole('link', { name: 'Potatoes' }).first().click();
  await wait(page, 800);
  await shot(page, 'planting-sheet', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: /Spring 3/ }).first() },
      { n: 2, target: page.getByLabel('Planted count') },
    ],
  });
});

// ---------------------------------------------------------------------------------------------
// Search, shortcuts, journals, settings
// ---------------------------------------------------------------------------------------------

/**
 * Cmd/Ctrl+K. It does not fire while the cursor is in a text box (the keyboard library the app
 * uses ignores key presses from inputs), so press Esc first to leave the note box.
 */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Meta+KeyK');
    await wait(page, 500);
    if ((await page.locator('[cmdk-input]').count()) > 0) return;
  }
  throw new Error('The search palette did not open');
}

scene('search', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDays(page);
  await openPalette(page);
  await shot(page, 'palette-commands', {
    marks: [
      { n: 1, target: page.locator('[cmdk-input]') },
      { n: 2, target: page.getByLabel('Search scope') },
    ],
  });
  await page.keyboard.type('lantrn');
  await wait(page, 900);
  await shot(page, 'palette-results', {
    marks: [{ n: 1, target: page.locator('[cmdk-input]') }],
  });
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('lantern is:question');
  await wait(page, 700);
  await page.keyboard.press('Meta+Enter');
  await wait(page, 900);
  await shot(page, 'search-page', {
    marks: [{ n: 1, target: page.getByRole('button', { name: 'Search tips' }) }],
  });
  await page.getByRole('button', { name: 'Search tips' }).click();
  await wait(page, 400);
  await shot(page, 'search-tips', {
    marks: [{ n: 1, target: page.locator('dl').first(), pad: 8 }],
  });
});

scene('shortcuts', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await page.getByRole('region', { name: 'New note' }).click({ position: { x: 5, y: 5 } });
  await page.locator('body').click({ position: { x: 700, y: 700 } });
  await page.keyboard.press('?');
  await wait(page, 600);
  await shot(page, 'shortcuts-dialog');
});

scene('journals', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'Rainy run' });
  await seedDefault(page);
  await page.getByRole('button', { name: /Journal: / }).click();
  await wait(page, 400);
  await shot(page, 'journal-switcher', {
    marks: [{ n: 1, target: page.getByRole('menu') }],
  });
  console.log(await page.getByRole('menu').innerText());
  await page.getByRole('menuitem', { name: /New journal/ }).click();
  await wait(page, 500);
  await shot(page, 'new-journal-dialog', {
    marks: [
      { n: 1, target: page.getByRole('radio', { name: /Stardew Valley/ }), pad: 4 },
      { n: 2, target: page.getByLabel('Journal name') },
      { n: 3, target: page.getByRole('button', { name: 'Create journal' }) },
    ],
  });
  await page.getByRole('radio', { name: /Stardew Valley/ }).click();
  await page.getByLabel('Journal name').fill('Spring farm');
  await page.getByRole('button', { name: 'Create journal' }).click();
  await wait(page, 1500);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await wait(page, 800);
  await page.locator('#journals').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('journals')?.scrollIntoView());
  await wait(page, 400);
  await shot(page, 'settings-journals', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: /^Open Rainy run/ }) },
      { n: 2, target: page.getByRole('button', { name: 'New journal…' }).first() },
    ],
  });
  await page.getByRole('button', { name: /^Delete Rainy run/ }).click();
  await wait(page, 500);
  await shot(page, 'delete-journal-dialog', {
    marks: [
      { n: 1, target: page.getByRole('checkbox', { name: /Keep a last copy/ }) },
      { n: 2, target: page.getByLabel(/Type the journal/) },
    ],
  });
});

async function gotoSection(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => document.getElementById(target)?.scrollIntoView(), id);
  await wait(page, 500);
}

scene('settings', async ({ page }) => {
  await startJournal(page, { template: 'Stardew Valley', name: 'Spring farm' });
  await seedDefault(page).catch(() => undefined);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await wait(page, 800);
  await shot(page, 'settings-appearance', {
    marks: [
      { n: 1, target: page.getByRole('navigation', { name: 'Settings sections' }).first() },
      { n: 2, target: page.getByRole('radiogroup', { name: 'Theme' }) },
      { n: 3, target: page.getByRole('radiogroup', { name: 'Reading size' }) },
    ],
  });
  await gotoSection(page, 'game');
  await shot(page, 'settings-sections', {
    marks: [
      { n: 1, target: page.getByRole('list', { name: 'Sections' }) },
      { n: 2, target: page.getByRole('checkbox', { name: /Show quick actions/ }) },
      { n: 3, target: page.getByRole('button', { name: /Reset sections/ }) },
    ],
  });
  await gotoSection(page, 'calendar');
  await shot(page, 'settings-calendar', {
    marks: [
      { n: 1, target: page.getByLabel('Season 1 name') },
      { n: 2, target: page.getByRole('button', { name: 'Add season' }) },
      { n: 3, target: page.getByRole('button', { name: 'Save calendar' }) },
    ],
  });
  await gotoSection(page, 'tags');
  await shot(page, 'settings-tags');
  await gotoSection(page, 'data');
  await shot(page, 'settings-data', {
    marks: [
      { n: 1, target: page.getByRole('link', { name: 'Export JSON' }) },
      { n: 2, target: page.getByRole('link', { name: 'Export Markdown' }) },
      { n: 3, target: page.getByRole('button', { name: 'Import JSON' }) },
      { n: 4, target: page.getByRole('button', { name: 'Back up now' }) },
    ],
  });
  await page.getByRole('button', { name: 'Back up now' }).click();
  await wait(page, 800);
  await page.evaluate(() => window.scrollBy(0, 360));
  await wait(page, 300);
  await shot(page, 'settings-snapshots');
  await gotoSection(page, 'trash');
  await shot(page, 'settings-trash');
  await gotoSection(page, 'about');
  await shot(page, 'settings-about');
});

// ---------------------------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------------------------

const MAP_VIEW = { width: 1440, height: 900 };
const MAP_VIEW_VIDEO = MAP_VIEW;

async function openNewMap(page: Page, name: string, layered = true): Promise<void> {
  await page.getByRole('link', { name: 'Maps' }).first().click();
  await wait(page, 500);
  await page.getByPlaceholder(/Name a new map/).fill(name);
  const layers = page.getByRole('checkbox', { name: 'Start with layers' });
  if (layered) await layers.check();
  await page.getByRole('button', { name: 'Start drawing' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).waitFor();
  await wait(page, 700);
}

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 14,
): Promise<void> {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps });
  await page.mouse.up();
  await wait(page, 220);
}

async function tool(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).first().click();
}

scene('maps-list', async ({ page }) => {
  await page.setViewportSize(MAP_VIEW);
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await page.getByRole('link', { name: 'Maps' }).first().click();
  await wait(page, 700);
  await shot(page, 'maps-empty', {
    marks: [
      { n: 1, target: page.getByPlaceholder(/Name a new map/) },
      { n: 2, target: page.getByRole('checkbox', { name: 'Start with layers' }) },
      { n: 3, target: page.getByRole('button', { name: 'Open a map file' }) },
      { n: 4, target: page.getByRole('button', { name: 'Start drawing' }) },
    ],
  });
});

/** The sample map used in the pictures: a few shapes, two labels and two markers. */
async function buildMap(page: Page, options: { smart?: boolean } = {}): Promise<void> {
  await tool(page, 'Circle');
  await drag(page, [760, 520], [900, 610]);
  await tool(page, 'Box');
  await drag(page, [430, 250], [560, 330]);
  await tool(page, 'Line');
  await drag(page, [560, 300], [700, 380]);
  await tool(page, 'Area');
  for (const point of [
    [640, 450],
    [720, 430],
    [760, 480],
    [700, 540],
    [630, 520],
  ] as [number, number][]) {
    await page.mouse.click(...point);
    await wait(page, 120);
  }
  await page.keyboard.press('Enter');
  await wait(page, 300);
  await tool(page, 'Text');
  await page.mouse.click(440, 365);
  await wait(page, 300);
  await page.keyboard.type('Cabin');
  await page.keyboard.press('Enter');
  await wait(page, 300);
  await tool(page, 'Note');
  await page.mouse.click(880, 250);
  await wait(page, 300);
  await page.keyboard.type('Check the shallows at dawn');
  await page.keyboard.press('Meta+Enter');
  await wait(page, 300);
  if (options.smart) {
    await tool(page, 'Draw');
    await page.mouse.move(930, 400);
    await page.mouse.down();
    for (const point of [
      [1010, 402],
      [1060, 400],
      [1062, 440],
      [1060, 480],
      [1010, 482],
      [932, 478],
      [928, 440],
      [930, 402],
    ]) {
      await page.mouse.move(point[0]!, point[1]!, { steps: 6 });
    }
    await page.mouse.up();
    await wait(page, 600);
  }
  await tool(page, 'Marker');
  await page.mouse.click(495, 290);
  await wait(page, 500);
  await page.keyboard.type('Cabin door');
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await page.mouse.click(830, 560);
  await wait(page, 500);
  await page.keyboard.type('Fishing spot');
  await page.keyboard.press('Enter');
  await wait(page, 600);
  await tool(page, 'Select');
  await page.mouse.click(1000, 640);
  await wait(page, 300);
}

scene('maps', async ({ page }) => {
  await page.setViewportSize(MAP_VIEW);
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await openNewMap(page, 'River valley');
  await buildMap(page, { smart: true });
  await shot(page, 'map-smart-draw', {
    toast: true,
    marks: [{ n: 1, target: page.getByText(/Tidied up as/).locator('..') }],
    clip: { x: 330, y: 90, width: 780, height: 520 },
  });
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await wait(page, 300);
  await shot(page, 'map-editor', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: 'Undo' }), pad: 3 },
      { n: 2, target: page.getByRole('button', { name: 'Select', exact: true }).first(), pad: 2 },
      { n: 3, target: page.getByRole('button', { name: 'Explore' }), pad: 3 },
      { n: 4, target: page.getByRole('button', { name: 'View', exact: true }), pad: 3 },
      { n: 5, target: page.getByRole('button', { name: 'Export' }), pad: 3 },
      { n: 6, target: page.getByRole('button', { name: 'History' }), pad: 3 },
      { n: 7, target: page.getByRole('tab', { name: 'Details' }), pad: 3 },
      { n: 8, target: page.getByRole('button', { name: 'Snap', exact: true }), pad: 3 },
    ],
  });
  await page.mouse.click(830, 560);
  await wait(page, 500);
  await shot(page, 'map-marker-selected', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: /Details, icon, tags, link/ }) },
      { n: 2, target: page.getByRole('toolbar', { name: 'Quick actions for the selection' }) },
    ],
  });
  await page.getByRole('button', { name: /Details, icon, tags, link/ }).click();
  await wait(page, 700);
  await page.getByLabel('Add a tag').fill('fishing');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder('For example: to check, done').fill('to check');
  await page
    .getByRole('button', { name: 'Star' })
    .first()
    .click()
    .catch(() => undefined);
  await shot(page, 'map-marker-details', {
    marks: [
      {
        n: 1,
        target: page
          .getByRole('group', { name: 'Icon' })
          .or(page.getByText('Icon', { exact: true }).locator('..'))
          .first(),
      },
      { n: 2, target: page.getByPlaceholder('For example: to check, done') },
      { n: 3, target: page.getByPlaceholder('Search, or type a new note') },
    ],
  });
  await page
    .getByPlaceholder('Search, or type a new note')
    .fill('The best fishing spot is by the pond.');
  await wait(page, 600);
  await shot(page, 'map-marker-link', {
    marks: [
      { n: 1, target: page.getByPlaceholder('Search, or type a new note') },
      { n: 2, target: page.getByRole('button', { name: /as a new note and link it/ }) },
    ],
  });
  await page.getByRole('button', { name: /as a new note and link it/ }).click();
  await wait(page, 800);
  await shot(page, 'map-marker-linked', {
    marks: [{ n: 1, target: page.getByText('Linked to').locator('..') }],
  });
  await page.getByRole('button', { name: 'Done' }).click();
  await wait(page, 600);

  // Layers
  await page.getByRole('tab', { name: 'Layers' }).click();
  await wait(page, 500);
  await shot(page, 'map-layers', {
    marks: [
      { n: 1, target: page.getByRole('tab', { name: 'Layers' }), pad: 3 },
      { n: 2, target: page.getByRole('list', { name: 'Layers' }) },
    ],
  });
  await page.getByRole('tab', { name: 'Details' }).click();

  // View menu
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await wait(page, 400);
  await shot(page, 'map-view-menu', { marks: [{ n: 1, target: page.getByRole('menu') }] });
  console.log((await page.getByRole('menu').innerText()).replace(/\n+/g, ' | '));
  await page.keyboard.press('Escape');

  // Export menu
  await page.getByRole('button', { name: 'Export' }).click();
  await wait(page, 400);
  await shot(page, 'map-export-menu', { marks: [{ n: 1, target: page.getByRole('menu') }] });
  await page.keyboard.press('Escape');

  // More menu
  await page.getByRole('button', { name: 'More map actions' }).click();
  await wait(page, 400);
  await shot(page, 'map-more-menu', { marks: [{ n: 1, target: page.getByRole('menu') }] });
  await page.keyboard.press('Escape');

  // Right-click menu on an object
  await page.mouse.click(495, 260);
  await page.mouse.click(495, 250, { button: 'right' });
  await wait(page, 500);
  await shot(page, 'map-context-menu', { marks: [{ n: 1, target: page.getByRole('menu') }] });
  await page.keyboard.press('Escape');

  // History
  await page.getByRole('button', { name: 'History' }).click();
  await wait(page, 600);
  await shot(page, 'map-history', {});
  console.log((await page.getByRole('dialog').innerText()).replace(/\n+/g, ' | ').slice(0, 600));
  await page.keyboard.press('Escape');

  // Marker types
  await page.getByRole('button', { name: 'More map actions' }).click();
  await page.getByRole('menuitem', { name: /Marker types/ }).click();
  await wait(page, 600);
  await shot(page, 'map-marker-types', {});
  await page.keyboard.press('Escape');

  // Select everything: the panel offers align and distribute
  await page.mouse.click(1000, 640);
  await page.keyboard.press('Meta+a');
  await wait(page, 500);
  await shot(page, 'map-multi-select', {
    marks: [
      { n: 1, target: page.getByRole('group', { name: 'Align' }) },
      { n: 2, target: page.getByRole('group', { name: 'Distribute and size' }) },
    ],
  });
  await page.mouse.click(1000, 640);

  // Grid and rulers, and a guide dragged out of the ruler
  await page.keyboard.press('Shift+G');
  await page.keyboard.press('Shift+R');
  await wait(page, 500);
  await shot(page, 'map-grid-rulers', {
    marks: [
      { n: 1, target: page.getByRole('button', { name: 'Grid', exact: true }), pad: 3 },
      { n: 2, target: page.getByRole('button', { name: 'Rulers', exact: true }), pad: 3 },
    ],
  });
  await page.keyboard.press('Shift+G');
  await page.keyboard.press('Shift+R');

  // Measure
  await page.getByLabel('Units per grid cell').fill('5');
  await page.getByLabel('Unit name').fill('m');
  await page.keyboard.press('Tab');
  await wait(page, 400);
  await tool(page, 'Measure');
  await page.mouse.move(450, 640);
  await page.mouse.down();
  await page.mouse.move(750, 640, { steps: 12 });
  await wait(page, 300);
  await shot(page, 'map-measure', {
    marks: [
      { n: 1, target: page.getByLabel('Units per grid cell') },
      { n: 2, target: page.getByLabel('Unit name') },
    ],
  });
  await page.mouse.up();
  await tool(page, 'Select');

  // Exploring mode
  await page.getByRole('button', { name: 'Explore' }).click();
  await wait(page, 500);
  await shot(page, 'map-explore', {
    marks: [{ n: 1, target: page.getByRole('toolbar', { name: 'Exploring' }) }],
  });
});

// ---------------------------------------------------------------------------------------------
// Other screen sizes, themes and the web version
// ---------------------------------------------------------------------------------------------

scene('responsive', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await page.setViewportSize({ width: 820, height: 760 });
  await wait(page, 600);
  await shot(page, 'interface-tablet', {
    marks: [{ n: 1, target: page.getByRole('navigation', { name: 'Primary' }), pad: 2 }],
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await wait(page, 600);
  await shot(page, 'interface-phone', {
    marks: [{ n: 1, target: page.getByRole('navigation', { name: 'Primary' }), pad: 2 }],
  });
  console.log(await page.getByRole('navigation').allInnerTexts());
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'More' })
    .click();
  await wait(page, 700);
  await shot(page, 'phone-more-sheet', {});
});

scene('themes', async ({ page }) => {
  await startJournal(page, { template: 'Stardew Valley', name: 'Spring farm' });
  await seedDefault(page);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await wait(page, 600);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await wait(page, 500);
  await page.getByRole('radio', { name: 'Large' }).click();
  await wait(page, 500);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await wait(page, 700);
  await shot(page, 'theme-dark-large', {});
});

scene('note-extras', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  // Edit in place
  await page.getByRole('article', { name: /strange lantern/ }).focus();
  await page.keyboard.press('e');
  await wait(page, 500);
  await shot(page, 'note-editing', {});
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Enter');
  // Note page
  await page.getByRole('link', { name: 'Journal' }).first().click();
  await wait(page, 500);
  console.log(await page.getByRole('main').getByRole('link').allInnerTexts());
});

scene('web-version', async ({ page, context }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await wait(page, 700);
  await gotoSection(page, 'data');
  await wait(page, 500);
  await shot(page, 'web-storage-protection', {
    marks: [
      { n: 1, target: page.getByRole('heading', { name: 'Keep your journal safe' }).locator('..') },
    ],
  });
  // A second tab on the same site.
  const second = await context.newPage();
  await second.goto(`${APP_URL}/`);
  await wait(second, 1500);
  await shot(second, 'web-second-tab', {});
});

// ---------------------------------------------------------------------------------------------
// The computer version (needs the server: `npm run build && npm start`, then
// DOCS_APP_URL=http://127.0.0.1:4317 npx tsx scripts/docs/capture.ts server-data server-phone)
// ---------------------------------------------------------------------------------------------

scene('server-data', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await wait(page, 800);
  await gotoSection(page, 'data');
  await shot(page, 'server-data', {
    marks: [
      { n: 1, target: page.getByText('Data folder').first().locator('..') },
      { n: 2, target: page.getByRole('button', { name: /Open folder/ }) },
    ],
  });
});

scene('server-phone', async ({ page }) => {
  await page.goto(`${APP_URL}/settings`);
  await wait(page, 1200);
  await gotoSection(page, 'phone');
  await shot(page, 'phone-off', {});
  console.log((await page.locator('#phone').innerText()).replace(/\n+/g, ' | '));
  await page.getByRole('checkbox', { name: /Let phones and tablets/ }).check();
  await wait(page, 2000);
  await shot(page, 'phone-on', {});
  console.log((await page.locator('#phone').innerText()).replace(/\n+/g, ' | '));
  await page.getByRole('button', { name: /Show pairing code/ }).click();
  await wait(page, 1500);
  await shot(page, 'phone-pairing', {
    redact: [
      page.locator('#phone svg, #phone img, #phone canvas').first(),
      page.getByText(/Can't scan it\?/),
    ],
    marks: [{ n: 1, target: page.getByRole('button', { name: 'Done' }) }],
  });
  console.log((await page.locator('#phone').innerText()).replace(/\n+/g, ' | '));
  // Turn it off again straight away.
  await page.getByRole('checkbox', { name: /Let phones and tablets/ }).uncheck();
  await wait(page, 1500);
});

// ---------------------------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------------------------

/** Types slowly enough to follow on a recording. */
const slow = (page: Page, text: string) => page.keyboard.type(text, { delay: 70 });

videoScene('video-quick-capture', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await wait(page, 800);
  await glide(page, page.getByRole('button', { name: /Set date/ }).first());
  await wait(page, 500);
  await page.keyboard.type('12', { delay: 150 });
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 800);
  await glide(page, composer(page));
  await slow(page, 'Met a fisher by the river. @Mar');
  await wait(page, 900);
  await page.keyboard.press('Enter');
  await wait(page, 700);
  await slow(page, ' says the bridge washed out. #lea');
  await wait(page, 900);
  await page.keyboard.press('Enter');
  await wait(page, 900);
  await glide(page, page.getByRole('button', { name: 'Question' }));
  await wait(page, 700);
  await glide(page, page.getByRole('button', { name: /^Save/ }));
  await wait(page, 1800);
});

videoScene('video-maps-drawing', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await openNewMap(page, 'River valley', false);
  await wait(page, 600);
  const pick = async (name: string) =>
    glide(page, page.getByRole('button', { name, exact: true }).first());
  const dragSlow = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(...from, { steps: 10 });
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 28 });
    await page.mouse.up();
    await wait(page, 700);
  };
  await pick('Box');
  await dragSlow([430, 250], [580, 340]);
  await pick('Circle');
  await dragSlow([760, 480], [900, 570]);
  await pick('Arrow');
  await dragSlow([580, 330], [770, 500]);
  await pick('Draw');
  await page.mouse.move(930, 250, { steps: 12 });
  await page.mouse.down();
  for (const point of [
    [1010, 252],
    [1060, 250],
    [1062, 290],
    [1060, 330],
    [1010, 332],
    [932, 328],
    [928, 290],
    [930, 252],
  ]) {
    await page.mouse.move(point[0]!, point[1]!, { steps: 14 });
  }
  await page.mouse.up();
  await wait(page, 1800);
  await pick('Marker');
  await page.mouse.move(500, 300, { steps: 16 });
  await page.mouse.click(500, 300);
  await wait(page, 600);
  await slow(page, 'Cabin door');
  await page.keyboard.press('Enter');
  await wait(page, 1000);
  await glide(page, page.getByRole('button', { name: 'Undo' }));
  await wait(page, 900);
  await glide(page, page.getByRole('button', { name: 'Redo' }));
  await wait(page, 1500);
});

videoScene('video-exploring', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await openNewMap(page, 'Cave system', false);
  await glide(page, page.getByRole('button', { name: 'Explore' }));
  await wait(page, 900);
  const markerAt = async (x: number, y: number, name: string) => {
    await page.mouse.move(x, y, { steps: 18 });
    await page.mouse.click(x, y);
    await wait(page, 500);
    await slow(page, name);
    await page.keyboard.press('Enter');
    await wait(page, 700);
  };
  await markerAt(480, 300, 'Entrance');
  await glide(page, page.getByRole('button', { name: /^Path/ }));
  await wait(page, 500);
  await page.mouse.move(485, 305, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(600, 380, { steps: 25 });
  await page.mouse.move(720, 400, { steps: 25 });
  await page.mouse.up();
  await wait(page, 800);
  await glide(page, page.getByRole('button', { name: /^Marker/ }));
  await markerAt(720, 405, 'Fork');
  await glide(page, page.getByRole('button', { name: /^Note/ }));
  await page.mouse.move(840, 320, { steps: 16 });
  await page.mouse.click(840, 320);
  await wait(page, 500);
  await slow(page, 'Left tunnel is flooded');
  await page.keyboard.press('Meta+Enter');
  await wait(page, 900);
  await glide(page, page.getByRole('button', { name: 'Done' }));
  await wait(page, 1500);
});

videoScene('video-search', async ({ page }) => {
  await startJournal(page, { template: 'Default', name: 'My journal' });
  await seedDefault(page);
  await wait(page, 800);
  await page.keyboard.press('Escape');
  await glide(page, page.getByRole('button', { name: /^Search/ }).first());
  await wait(page, 900);
  await slow(page, 'lantrn');
  await wait(page, 1500);
  await page.keyboard.press('Meta+a');
  await slow(page, 'is:question');
  await wait(page, 1500);
  await page.keyboard.press('Meta+a');
  await slow(page, '#lead');
  await wait(page, 1500);
  await page.keyboard.press('Escape');
  await wait(page, 800);
});

// ---------------------------------------------------------------------------------------------
// The README's pictures: clean, unannotated, in docs/assets/readme
// ---------------------------------------------------------------------------------------------

const README_DIR = path.join(IMG_DIR, '..', 'readme');

scene('readme', async ({ page }) => {
  fs.mkdirSync(README_DIR, { recursive: true });
  await page.setViewportSize({ width: 1200, height: 700 });

  // Default template: Today with a few notes.
  await startJournal(page, { template: 'Default', name: 'Rainy day run' });
  await seedDefault(page);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await wait(page, 700);
  await shot(page, 'today-default', {
    dir: README_DIR,
    clip: { x: 0, y: 0, width: 1200, height: 700 },
  });

  // Stardew Valley template: quick actions and the Farm in the sidebar.
  await page.goto(`${APP_URL}/settings`);
  await page.getByRole('button', { name: /Journal: / }).click();
  await page.getByRole('menuitem', { name: /New journal/ }).click();
  await page.getByRole('radio', { name: /Stardew Valley/ }).click();
  await page.getByLabel('Journal name').fill('Spring farm');
  await page.getByRole('button', { name: 'Create journal' }).click();
  await wait(page, 1500);
  await setStardewDate(page, 'Spring', 3);
  await composer(page).focus();
  await page.getByRole('button', { name: 'Met someone' }).click();
  await composer(page).focus();
  await type(page, 'Introduced myself to the shopkeeper. @Pel');
  await wait(page, 500);
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await page.keyboard.press('Meta+Enter');
  await wait(page);
  await composer(page).focus();
  await type(page, 'Found something shiny in the creek bed.');
  await page.getByRole('button', { name: 'Found something' }).click();
  await composer(page).focus();
  await page.keyboard.press('Meta+Enter');
  await wait(page, 700);
  await shot(page, 'today-stardew', {
    dir: README_DIR,
    clip: { x: 0, y: 0, width: 1200, height: 700 },
  });

  // A phone-width screen, on the Default journal.
  await page.getByRole('button', { name: /Journal: / }).click();
  await page.getByRole('menuitem', { name: /Rainy day run/ }).click();
  await wait(page, 1800);
  await page.setViewportSize({ width: 390, height: 780 });
  await wait(page, 700);
  await shot(page, 'phone', { dir: README_DIR });

  // A map, clean.
  await page.setViewportSize(MAP_VIEW);
  await openNewMap(page, 'River valley');
  await buildMap(page, { smart: true });
  await page
    .getByRole('button', { name: 'Dismiss' })
    .click()
    .catch(() => undefined);
  await wait(page, 500);
  await shot(page, 'map', { dir: README_DIR, clip: { x: 262, y: 0, width: 1178, height: 820 } });
});

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const names = wanted.length > 0 ? wanted : Object.keys(scenes);
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  for (const name of names) {
    const run = scenes[name];
    if (!run)
      throw new Error(`No scene called "${name}". Scenes: ${Object.keys(scenes).join(', ')}`);
    const recorded = videoScenes.has(name);
    const l = await launch(recorded ? { video: true, viewport: MAP_VIEW_VIDEO } : {});
    try {
      process.stdout.write(`${name}… `);
      if (recorded) await showCursor(l.page);
      await run(l);
      if (recorded) {
        await l.page.screenshot({ path: path.join(IMG_DIR, `${name}-poster.png`) });
        await saveVideo(l.context, l.page, name);
      }
      process.stdout.write('ok\n');
    } finally {
      await l.browser.close();
    }
  }
}

await main();
