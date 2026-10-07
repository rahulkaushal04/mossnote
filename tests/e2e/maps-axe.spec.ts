import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** Accessibility of the map and game-settings screens (AC-G-4): maps, the editor, the pin sheet, game settings. */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 1280]) {
    test(`maps and game settings have no serious violations: ${theme} at ${width}px`, async ({
      page,
      seed,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('moss:theme', value);
      }, theme);
      await page.setViewportSize({ width, height: 800 });
      const note = await seed.note({ body: 'A linked note' });
      const map = await seed.post<{ id: string }>('/api/maps', { name: 'Example map' });
      await seed.post(`/api/maps/${map.id}`.concat('/pins'), {
        x: 40,
        y: 40,
        label: 'Example pin',
        color: 'rose',
        target: { type: 'note', id: note.id },
      });
      await seed.settings({
        layout: {
          template: 'stardew',
          order: [],
          hidden: [],
          labels: {},
          quickActions: true,
        },
      });

      await page.goto('/maps');
      await expect(page.getByRole('heading', { level: 1, name: 'Maps' })).toBeVisible();
      expect(await violations(page), 'maps list').toEqual([]);

      await page.goto(`/maps/${map.id}`);
      await expect(page.locator('[data-kind="pin"]')).toHaveCount(1);
      expect(await violations(page), 'map editor').toEqual([]);

      await page.locator('[data-kind="pin"] circle').first().dblclick();
      await expect(page.getByRole('dialog', { name: 'Marker' })).toBeVisible();
      expect(await violations(page), 'pin sheet').toEqual([]);
      await page.keyboard.press('Escape');

      await page.goto('/settings#game');
      await expect(
        page.getByRole('heading', { level: 2, name: 'Game and sections' }),
      ).toBeVisible();
      expect(await violations(page), 'game settings').toEqual([]);

      await page.goto('/');
      await expect(page.getByRole('group', { name: 'Quick actions' })).toBeVisible();
      expect(await violations(page), 'today with quick actions').toEqual([]);
    });
  }
}

test.describe('the map editor (AC-MAP-22)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious violations with objects, panels and menus open: ${theme}`, async ({
      page,
      seed,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('moss:theme', value);
      }, theme);
      const map = await seed.post<{ id: string }>('/api/maps', {
        name: 'Editor map',
        template: 'layers',
      });
      await seed.post(`/api/maps/${map.id}/pins`, {
        x: 120,
        y: 80,
        label: 'Gate',
        color: 'rose',
        props: { icon: 'door', tags: ['north'], status: 'to check' },
      });
      await seed.post(`/api/maps/${map.id}/changes`, {
        scene: {
          v: 2,
          layers: [{ id: 'layer-1', name: 'Layer 1' }],
          shapes: [
            {
              id: 'a',
              layer: 'layer-1',
              t: 'rect',
              x: 0,
              y: 0,
              w: 100,
              h: 60,
              name: 'Hall',
              style: { stroke: 'sky', fill: 'sky', width: 3, dash: 'solid' },
            },
            {
              id: 'b',
              layer: 'layer-1',
              t: 'ellipse',
              cx: 250,
              cy: 40,
              rx: 40,
              ry: 30,
              style: { stroke: 'moss', fill: null, width: 3, dash: 'dashed' },
            },
            {
              id: 'c',
              layer: 'layer-1',
              t: 'connector',
              from: { pt: [100, 30], ref: 'a' },
              to: { pt: [210, 40], ref: 'b' },
              route: 'curve',
              head: 'end',
              style: { stroke: 'ink', fill: null, width: 3, dash: 'solid' },
            },
            {
              id: 'n',
              layer: 'layer-1',
              t: 'text',
              x: 20,
              y: 90,
              text: 'A sticky note',
              size: 16,
              kind: 'sticky',
              w: 180,
              style: { stroke: 'ink', fill: 'amber', width: 2, dash: 'solid' },
            },
          ],
        },
      });
      await page.goto(`/maps/${map.id}`);
      await expect(page.locator('[data-kind="rect"]')).toBeVisible();
      expect(await violations(page), 'editor').toEqual([]);

      await page.keyboard.press('ControlOrMeta+a');
      expect(await violations(page), 'multi selection').toEqual([]);

      await page.getByRole('tab', { name: 'Layers' }).click();
      expect(await violations(page), 'layers panel').toEqual([]);

      await page.keyboard.press('Shift+G');
      await page.keyboard.press('Shift+R');
      expect(await violations(page), 'grid and rulers').toEqual([]);

      await page.locator('[data-kind="rect"]').click({ button: 'right' });
      await expect(page.getByRole('menu', { name: 'Map actions' })).toBeVisible();
      expect(await violations(page), 'context menu').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'History' }).click();
      await expect(page.getByRole('dialog', { name: 'Version history' })).toBeVisible();
      expect(await violations(page), 'history').toEqual([]);
      await page.keyboard.press('Escape');

      await page.keyboard.press('e');
      await expect(page.getByRole('toolbar', { name: 'Exploring' })).toBeVisible();
      expect(await violations(page), 'exploring').toEqual([]);
    });
  }

  test('works at phone width: tools scroll, the panel is a sheet', async ({ page, seed }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const map = await seed.post<{ id: string }>('/api/maps', { name: 'Phone map' });
    await page.goto(`/maps/${map.id}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: 'Panel' }).click();
    await expect(page.getByRole('tab', { name: 'Layers' })).toBeVisible();
    expect(await violations(page), 'phone').toEqual([]);
  });
});
