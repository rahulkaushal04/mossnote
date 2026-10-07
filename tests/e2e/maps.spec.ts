import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const canvas = (page: Page) => page.getByTestId('map-canvas');

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('No canvas.');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

test.describe('maps', () => {
  test('sketch, pin, write a note on the spot, and find it from both sides', async ({
    page,
    seed,
  }) => {
    await page.goto('/maps');
    await expect(page.getByText('No maps yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Start drawing' }).click();
    await expect(page).toHaveURL(/\/maps\/[0-9A-Z]{26}$/);
    await expect(canvas(page)).toBeVisible();

    // Draw a line, then drop a marker with the keyboard shortcut for the Marker tool.
    await page.keyboard.press('b');
    await drag(page, [80, 80], [220, 160]);
    await expect(canvas(page).locator('[data-kind="connector"]')).toHaveCount(1);
    await page.keyboard.press('k');
    await canvas(page).click({ position: { x: 360, y: 120 } });
    await page.getByLabel('Marker name').fill('Odd stone');
    await page.keyboard.press('Enter');
    await page.keyboard.press('v');
    await canvas(page).locator('[data-kind="pin"] circle').first().dblclick();

    const sheet = page.getByRole('dialog', { name: 'Marker' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Name')).toHaveValue('Odd stone');
    await sheet
      .getByLabel('Link to a note, person or farm entry')
      .fill('Met someone near the lake');
    await sheet.getByRole('button', { name: /as a new note and link it/ }).click();
    await expect(sheet.getByText('Linked to')).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).click();

    // Everything persists across a reload.
    await page.reload();
    await expect(canvas(page).locator('[data-kind="connector"]')).toHaveCount(1);
    await expect(canvas(page).locator('[data-kind="pin"]')).toHaveCount(1);

    // From the note: "On maps" opens the map centred on the pin.
    const notes = await seed.get<{ items: { id: string }[] }>('/api/notes');
    await page.goto(`/notes/${notes.items[0]?.id ?? ''}`);
    await page.getByRole('link', { name: /Odd stone · Untitled map/ }).click();
    await expect(page).toHaveURL(/\/maps\/[0-9A-Z]{26}\?pin=[0-9A-Z]{26}$/);
    await expect(canvas(page).locator('[data-kind="pin"]')).toHaveCount(1);
  });

  test('search finds a pin, and a deleted map can be restored', async ({ page, seed }) => {
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Riverside' });
    await seed.post(`/api/maps/${map.id}/pins`, { x: 0, y: 0, label: 'Strange gate' });
    await page.goto('/search?q=gate');
    await expect(page.getByRole('link', { name: /Strange gate/ })).toBeVisible();

    await page.goto(`/maps/${map.id}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete map' }).click();
    await expect(page).toHaveURL(/\/maps$/);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: 'Riverside' })).toBeVisible();
  });

  test('every drawing action has a button, and zoom buttons change the view', async ({
    page,
    seed,
  }) => {
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Controls' });
    await page.goto(`/maps/${map.id}`);
    for (const name of [
      'Select',
      'Pan',
      'Draw',
      'Line',
      'Arrow',
      'Box',
      'Circle',
      'Area',
      'Connect',
      'Text',
      'Note',
      'Marker',
      'Measure',
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await canvas(page).click({ position: { x: 120, y: 100 } });
    await page.getByLabel('Label text').fill('shore');
    await page.keyboard.press('Enter');
    const label = canvas(page).locator('[data-kind="text"]');
    await expect(label).toContainText('shore');
    const before = await label.boundingBox();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const after = await label.boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(canvas(page).locator('[data-kind="text"]')).toHaveCount(0);
  });
});

test.describe('game templates and sections', () => {
  test('choose a game, rename and hide a section, use a quick action', async ({ page }) => {
    await page.goto('/settings#game');
    await page.getByRole('radio', { name: 'Stardew Valley' }).click();
    await expect(page.getByRole('radio', { name: 'Stardew Valley' })).toBeChecked();
    const nav = page.getByRole('navigation', { name: 'Primary' }).first();
    await expect(nav.getByRole('link', { name: 'NPCs' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Daily journal' })).toBeVisible();

    await page.getByLabel('Name of Farm').fill('Fields');
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('link', { name: 'Fields' })).toBeVisible();
    await page.getByRole('list', { name: 'Sections' }).getByLabel('Show').nth(4).click();
    await expect(nav.getByRole('link', { name: 'Maps' })).toHaveCount(0);

    await page.goto('/');
    const found = page.getByRole('button', { name: 'Found something' });
    await found.click();
    await expect(found).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('combobox', { name: 'Note' }).fill('Something odd by the river');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.goto('/journal?flag=discovery');
    await expect(page.getByText('Something odd by the river')).toBeVisible();
  });
});
