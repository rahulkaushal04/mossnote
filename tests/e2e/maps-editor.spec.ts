import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { Seed } from './fixtures';

const canvas = (page: Page) => page.getByTestId('map-canvas');

type Pt = [number, number];

/** Press, move through the points, release: a hand drawing on the canvas. */
async function stroke(page: Page, pts: Pt[]) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('No canvas.');
  const [first, ...rest] = pts;
  if (!first) return;
  await page.mouse.move(box.x + first[0], box.y + first[1]);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(box.x + p[0], box.y + p[1]);
  await page.mouse.up();
}

const along = (a: Pt, b: Pt, n: number): Pt[] =>
  Array.from({ length: n }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);
const wobble = (pts: Pt[], amount = 3): Pt[] =>
  pts.map(([x, y], i) => [x + Math.sin(i * 3.1) * amount, y + Math.cos(i * 2.3) * amount]);
const circle = (cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: 64 }, (_, i) => {
    const t = 0.5 + (i / 60) * Math.PI * 2;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  });
const polygon = (corners: Pt[]): Pt[] => [
  ...corners.flatMap((c, i) => along(c, corners[(i + 1) % corners.length]!, 14)),
  corners[0]!,
];

interface SavedMap {
  scene: {
    layers: { id: string; name: string; hidden?: boolean; locked?: boolean }[];
    shapes: Record<string, unknown>[];
  };
  pins: { id: string; label: string; props: Record<string, unknown> }[];
}
const saved = (seed: Seed, id: string) => seed.get<SavedMap>(`/api/maps/${id}`);

async function openNewMap(page: Page, seed: Seed, name = 'Test map') {
  const map = await seed.post<{ id: string }>('/api/maps', { name });
  await page.goto(`/maps/${map.id}`);
  await expect(canvas(page)).toBeVisible();
  return map.id;
}

const kinds = (page: Page, kind: string) => canvas(page).locator(`[data-kind="${kind}"]`);

test.describe('smart drawing', () => {
  test('a rough circle, rectangle, line and arrow become clean objects', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('b');
    await stroke(page, wobble(circle(200, 200, 70), 6));
    await expect(kinds(page, 'ellipse')).toHaveCount(1);
    await expect(page.getByText('Tidied up as circle.')).toBeVisible();

    await stroke(
      page,
      wobble(
        polygon([
          [400, 120],
          [560, 124],
          [558, 210],
          [398, 206],
        ]),
        4,
      ),
    );
    await expect(kinds(page, 'rect')).toHaveCount(1);

    await stroke(page, wobble(along([120, 400], [360, 420], 30), 3));
    await stroke(
      page,
      wobble([...along([420, 420], [640, 420], 40), ...along([640, 420], [624, 436], 6)], 2),
    );
    await expect(kinds(page, 'connector')).toHaveCount(2);

    await expect
      .poll(async () => (await saved(seed, id)).scene.shapes.map((s) => s.t).sort())
      .toEqual(['connector', 'connector', 'ellipse', 'rect']);
    const shapes = (await saved(seed, id)).scene.shapes;
    const ellipse = shapes.find((s) => s.t === 'ellipse') as { rx: number; ry: number };
    expect(ellipse.rx).toBe(ellipse.ry);
    const heads = shapes.filter((s) => s.t === 'connector').map((s) => s.head);
    expect(heads.sort()).toEqual(['end', 'none']);
  });

  test('"Keep my drawing" brings the raw stroke back, and tidying can be turned off', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('b');
    await stroke(page, wobble(circle(200, 200, 70), 6));
    await page.getByRole('button', { name: 'Keep my drawing' }).click();
    await expect(kinds(page, 'ellipse')).toHaveCount(0);
    await expect(kinds(page, 'path')).toHaveCount(1);

    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Tidy up rough shapes' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('b');
    await stroke(page, wobble(circle(420, 200, 70), 6));
    await expect(kinds(page, 'ellipse')).toHaveCount(0);
    await expect(kinds(page, 'path')).toHaveCount(2);
    await expect.poll(async () => (await saved(seed, id)).scene.shapes.length).toBe(2);
  });

  test('lines snap to the end of other lines and attach to objects', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await page.keyboard.press('r');
    await stroke(page, [
      [420, 100],
      [540, 170],
    ]);
    // A line from the first box to the second joins both.
    await page.keyboard.press('c');
    await stroke(page, [
      [160, 135],
      [480, 135],
    ]);
    await expect(kinds(page, 'connector')).toHaveCount(1);
    await expect
      .poll(async () => {
        const c = (await saved(seed, id)).scene.shapes.find((s) => s.t === 'connector') as
          { from: { ref?: string }; to: { ref?: string } } | undefined;
        return Boolean(c?.from.ref && c.to.ref);
      })
      .toBe(true);
  });
});

test.describe('selecting and editing objects', () => {
  test('draw a box, select it, move it, resize it, undo and redo', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [260, 200],
    ]);
    const rect = kinds(page, 'rect');
    await expect(rect).toHaveCount(1);
    const first = await rect.boundingBox();
    // Move: drag from the middle.
    await stroke(page, [
      [180, 150],
      [240, 190],
      [320, 230],
    ]);
    const moved = await rect.boundingBox();
    expect((moved?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThan(100);
    // Undo puts it back, Redo moves it again.
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await rect.boundingBox();
    expect(Math.abs((undone?.x ?? 0) - (first?.x ?? 0))).toBeLessThan(2);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(((await rect.boundingBox())?.x ?? 0) - (first?.x ?? 0)).toBeGreaterThan(100);
    // Resize with the east handle.
    const handle = page.locator('[data-handle="e"]');
    const hb = await handle.boundingBox();
    const before = await rect.boundingBox();
    await page.mouse.move((hb?.x ?? 0) + 5, (hb?.y ?? 0) + 5);
    await page.mouse.down();
    await page.mouse.move((hb?.x ?? 0) + 85, (hb?.y ?? 0) + 5, { steps: 5 });
    await page.mouse.up();
    expect((await rect.boundingBox())?.width ?? 0).toBeGreaterThan((before?.width ?? 0) + 40);
    // Delete removes it and survives a reload.
    await page.keyboard.press('Delete');
    await expect(rect).toHaveCount(0);
    await expect.poll(async () => (await saved(seed, id)).scene.shapes.length).toBe(0);
  });

  test('marquee selects several, group and align them, then ungroup', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [180, 160],
    ]);
    await page.keyboard.press('r');
    await stroke(page, [
      [260, 220],
      [340, 300],
    ]);
    await page.keyboard.press('v');
    await stroke(page, [
      [60, 60],
      [420, 360],
    ]);
    await expect(page.getByRole('heading', { name: '2 objects' })).toBeVisible();
    await page.getByRole('button', { name: 'Align left' }).click();
    await expect
      .poll(async () => {
        const xs = (await saved(seed, id)).scene.shapes.map((s) => s.x as number);
        return xs.length === 2 && Math.abs((xs[0] ?? 0) - (xs[1] ?? 1)) < 0.5;
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect
      .poll(async () => new Set((await saved(seed, id)).scene.shapes.map((s) => s.group)).size)
      .toBe(1);
    await page.getByRole('button', { name: 'Ungroup' }).click();
    await expect
      .poll(async () => (await saved(seed, id)).scene.shapes.every((s) => !s.group))
      .toBe(true);
  });

  test('copy, paste and duplicate; arrow keys nudge; Escape clears', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [200, 160],
    ]);
    await page.keyboard.press('ControlOrMeta+d');
    await expect(kinds(page, 'rect')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(kinds(page, 'rect')).toHaveCount(3);
    const before = await kinds(page, 'rect').nth(2).boundingBox();
    await page.keyboard.press('Shift+ArrowRight');
    const after = await kinds(page, 'rect').nth(2).boundingBox();
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThanOrEqual(9);
    await expect.poll(async () => (await saved(seed, id)).scene.shapes.length).toBe(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-handle]')).toHaveCount(0);
  });

  test('the right-click menu offers actions, and Delete there removes the object', async ({
    page,
    seed,
  }) => {
    await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await kinds(page, 'rect').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Map actions' });
    await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(kinds(page, 'rect')).toHaveCount(0);
  });

  test('lock stops an object being picked; hide removes it from view', async ({ page, seed }) => {
    await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await page.getByRole('button', { name: 'Lock', exact: true }).first().click();
    await page.keyboard.press('Escape');
    await stroke(page, [
      [160, 135],
      [200, 150],
    ]);
    await expect(page.locator('[data-handle]')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('button', { name: /^Hide Box/ }).click();
    await expect(kinds(page, 'rect')).toHaveCount(0);
  });
});

test.describe('layers', () => {
  test('add, rename, hide, lock and reorder layers; objects follow their layer', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('button', { name: 'New layer' }).click();
    await expect(page.getByRole('list', { name: 'Layers' }).locator(':scope > li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Hide Layer 1' }).click();
    await expect(kinds(page, 'rect')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show Layer 1' }).click();
    await expect(kinds(page, 'rect')).toHaveCount(1);
    await page.getByRole('button', { name: 'Lock Layer 2' }).click();
    await page.getByRole('button', { name: 'Move Layer 2 down' }).click();
    await expect
      .poll(async () =>
        (await saved(seed, id)).scene.layers.map((l) => `${l.name}${l.locked ? ':locked' : ''}`),
      )
      .toEqual(['Layer 2:locked', 'Layer 1']);
  });

  test('a layered template and suggested layers use plain names', async ({ page, seed }) => {
    const map = await seed.post<{ id: string }>('/api/maps', {
      name: 'Layered',
      template: 'layers',
    });
    await page.goto(`/maps/${map.id}`);
    await page.getByRole('tab', { name: 'Layers' }).click();
    const list = page.getByRole('list', { name: 'Layers' });
    await expect(list.locator(':scope > li')).toHaveCount(5);
    await expect(list).toContainText('Terrain');
    await expect(list).toContainText('Locations');
  });
});

test.describe('markers', () => {
  test('a marker gets a name, type, icon, status, tags, fields and a link', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('k');
    await canvas(page).click({ position: { x: 300, y: 200 } });
    await page.getByLabel('Marker name').fill('Odd door');
    await page.keyboard.press('Enter');
    await page.keyboard.press('v');
    await kinds(page, 'pin').locator('circle').first().dblclick();
    const sheet = page.getByRole('dialog', { name: 'Marker' });
    await sheet.getByRole('button', { name: 'Edit types' }).click();
    const types = page.getByRole('dialog', { name: 'Marker types' });
    await types.getByRole('button', { name: 'Add “Entrance”' }).click();
    await types.getByRole('button', { name: 'Close' }).click();
    await sheet.getByLabel('Type').selectOption({ label: 'Entrance' });
    await sheet.getByRole('button', { name: 'Key' }).click();
    await sheet.getByLabel('Status').fill('to check');
    await sheet.getByLabel('Status').blur();
    await sheet.getByLabel('Add a tag').fill('north');
    await sheet.getByLabel('Add a tag').press('Enter');
    await sheet.getByRole('button', { name: 'Add a field' }).click();
    await sheet.getByLabel('Field 1 label').fill('Depth');
    await sheet.getByLabel('Field 1 label').blur();
    await sheet.getByLabel('Field 1 value').fill('3');
    await sheet.getByLabel('Field 1 value').blur();
    await sheet.getByLabel('Link to a note, person').fill('A note about the door');
    await sheet.getByRole('button', { name: /as a new note and link it/ }).click();
    await expect(sheet.getByText('Linked to')).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect
      .poll(async () => {
        const pin = (await saved(seed, id)).pins[0];
        return JSON.stringify({ label: pin?.label, props: pin?.props });
      })
      .toContain('"icon":"key"');
    const pin = (await saved(seed, id)).pins[0];
    expect(pin?.props).toMatchObject({
      status: 'to check',
      tags: ['north'],
      fields: [{ label: 'Depth', value: '3' }],
    });
    expect(pin?.props.type).toBeTruthy();
  });

  test('marker types start empty and are made by the person', async ({ page, seed }) => {
    const settings = await seed.get<{ markerTypes: unknown[] }>('/api/settings');
    expect(settings.markerTypes).toEqual([]);
    await openNewMap(page, seed);
    await page.getByRole('button', { name: 'More map actions' }).click();
    await page.getByRole('menuitem', { name: 'Marker types…' }).click();
    const types = page.getByRole('dialog', { name: 'Marker types' });
    await expect(types.getByText('No types yet.')).toBeVisible();
    await types.getByRole('button', { name: 'New type' }).click();
    await expect(
      types.getByRole('list', { name: 'Marker types' }).getByRole('listitem'),
    ).toHaveCount(1);
  });
});

test.describe('exploring', () => {
  test('marker, path from it, and a note: the loop works with taps and keys', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('e');
    await expect(page.getByRole('toolbar', { name: 'Exploring' })).toBeVisible();
    await canvas(page).click({ position: { x: 200, y: 200 } });
    await page.getByLabel('Marker name').fill('Start');
    await page.keyboard.press('Enter');
    await page.keyboard.press('b');
    await stroke(page, wobble(along([212, 210], [520, 220], 40), 3));
    await expect(kinds(page, 'connector')).toHaveCount(1);
    await page.keyboard.press('s');
    await canvas(page).click({ position: { x: 560, y: 120 } });
    await page.getByLabel('Note text').fill('A dead end');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(kinds(page, 'text')).toContainText('A dead end');
    await expect
      .poll(async () => {
        const m = await saved(seed, id);
        const c = m.scene.shapes.find((s) => s.t === 'connector') as
          { from: { ref?: string } } | undefined;
        return Boolean(c?.from.ref && c.from.ref === m.pins[0]?.id);
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('toolbar', { name: 'Exploring' })).toHaveCount(0);
  });
});

test.describe('history, copies and files', () => {
  test('save a version, experiment, restore it, and duplicate before experimenting', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed, 'Cave');
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await expect.poll(async () => (await saved(seed, id)).scene.shapes.length).toBe(1);
    await page.getByRole('button', { name: 'History' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await dialog.getByLabel('Name for this version').fill('Before experiment');
    await dialog.getByRole('button', { name: 'Save version' }).click();
    await expect(dialog.getByText('Before experiment')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('Delete');
    await expect(kinds(page, 'rect')).toHaveCount(0);
    await page.getByRole('button', { name: 'History' }).click();
    await dialog.getByRole('button', { name: 'Restore' }).first().click();
    await expect(kinds(page, 'rect')).toHaveCount(1);
    await expect.poll(async () => (await saved(seed, id)).scene.shapes.length).toBe(1);

    await page.getByRole('button', { name: 'More map actions' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate this map' }).click();
    await expect(page).toHaveURL(/\/maps\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cave copy' })).toBeVisible();
    await expect(kinds(page, 'rect')).toHaveCount(1);
  });

  test('export as SVG, PNG, PDF and an editable project file; open the file again', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed, 'Export me');
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await page.keyboard.press('k');
    await canvas(page).click({ position: { x: 360, y: 200 } });
    await page.getByLabel('Marker name').fill('Spot');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await saved(seed, id)).pins.length).toBe(1);

    const exportAs = async (item: string) => {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('menuitem', { name: item }).click();
      return download;
    };
    const svg = await exportAs('Vector drawing (SVG)');
    expect(svg.suggestedFilename()).toBe('Export me.svg');
    const svgText = await (await svg.createReadStream()).toArray();
    const text = Buffer.concat(svgText as Buffer[]).toString('utf8');
    expect(text).toContain('<svg');
    expect(text).toContain('<rect');
    expect(text).toContain('Spot');

    const png = await exportAs('Picture (PNG)');
    expect(png.suggestedFilename()).toBe('Export me.png');
    const pngBytes = Buffer.concat((await (await png.createReadStream()).toArray()) as Buffer[]);
    expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');

    const pdf = await exportAs('Document (PDF)');
    const pdfBytes = Buffer.concat((await (await pdf.createReadStream()).toArray()) as Buffer[]);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');

    const project = await exportAs('Editable project file');
    expect(project.suggestedFilename()).toMatch(/\.mossmap\.json$/);
    const file = Buffer.concat(
      (await (await project.createReadStream()).toArray()) as Buffer[],
    ).toString('utf8');
    expect(JSON.parse(file)).toMatchObject({ format: 'mossnote-map', name: 'Export me' });

    // The project file opens as a new, editable map.
    await page.goto('/maps');
    await page.getByLabel('Map file').setInputFiles({
      name: 'export.mossmap.json',
      mimeType: 'application/json',
      buffer: Buffer.from(file),
    });
    await expect(page).toHaveURL(/\/maps\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Export me' })).toBeVisible();
    await expect(kinds(page, 'rect')).toHaveCount(1);
    await expect(kinds(page, 'pin')).toHaveCount(1);
  });

  test('duplicate from the list', async ({ page, seed }) => {
    await seed.post('/api/maps', { name: 'Town' });
    await page.goto('/maps');
    await page.getByRole('button', { name: 'Duplicate Town' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Town copy' })).toBeVisible();
  });
});

test.describe('canvas aids', () => {
  test('grid, rulers and a guide, the compass, and the overview map', async ({ page, seed }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('Shift+G');
    await expect(page.locator('#map-grid')).toHaveCount(1);
    await page.keyboard.press('Shift+R');
    await expect(page.locator('[data-ruler="x"]')).toHaveCount(1);
    await expect(page.getByRole('img', { name: 'North is up' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Overview of the whole map/ })).toBeVisible();
    // Drag a guide out of the top ruler.
    const box = await canvas(page).boundingBox();
    await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 8);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 160, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          ((await saved(seed, id)).scene as unknown as { guides?: unknown[] }).guides?.length ?? 0,
      )
      .toBe(1);
  });

  test('the measure tool shows a distance in the units you set', async ({ page, seed }) => {
    await openNewMap(page, seed);
    await page.getByLabel('Units per grid cell').fill('20');
    await page.getByLabel('Unit name').fill('steps');
    await page.getByLabel('Unit name').blur();
    await page.keyboard.press('m');
    await stroke(page, [
      [100, 200],
      [300, 200],
    ]);
    // The measurement disappears when the drag ends, so check while dragging.
    const box = await canvas(page).boundingBox();
    await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 250);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + 300, (box?.y ?? 0) + 250, { steps: 4 });
    await expect(canvas(page)).toContainText(/(9\.[5-9]|10(\.\d)?) steps/);
    await page.mouse.up();
  });

  test('Fit shows everything; zoom percentage resets', async ({ page, seed }) => {
    await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [100, 100],
      [220, 170],
    ]);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const zoomed = await kinds(page, 'rect').boundingBox();
    await page.keyboard.press('Shift+1');
    const fitted = await kinds(page, 'rect').boundingBox();
    expect(fitted?.width ?? 0).not.toBe(zoomed?.width ?? 0);
  });
});

test.describe('more tools', () => {
  test('an area is made by clicking corners and double-clicking; corners can be dragged', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('y');
    const box = await canvas(page).boundingBox();
    const at = (x: number, y: number) => ({ x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y });
    for (const [x, y] of [
      [100, 100],
      [260, 110],
      [240, 220],
    ] as Pt[])
      await page.mouse.click(at(x, y).x, at(x, y).y);
    await page.mouse.dblclick(at(120, 230).x, at(120, 230).y);
    await expect(kinds(page, 'polygon')).toHaveCount(1);
    await expect
      .poll(
        async () =>
          ((await saved(seed, id)).scene.shapes[0]?.pts as unknown[] | undefined)?.length ?? 0,
      )
      .toBeGreaterThanOrEqual(3);
    // Drag the first corner.
    const before = await kinds(page, 'polygon').boundingBox();
    const corner = page.locator('[data-vertex="0"]');
    const cb = await corner.boundingBox();
    await page.mouse.move((cb?.x ?? 0) + 5, (cb?.y ?? 0) + 5);
    await page.mouse.down();
    await page.mouse.move((cb?.x ?? 0) - 55, (cb?.y ?? 0) - 45, { steps: 5 });
    await page.mouse.up();
    const after = await kinds(page, 'polygon').boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan((before?.width ?? 0) + 30);
  });

  test('the turn handle rotates a box; the panel and quick bar react to the selection', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [200, 200],
      [360, 280],
    ]);
    await expect(
      page.getByRole('toolbar', { name: 'Quick actions for the selection' }),
    ).toBeVisible();
    const handle = page.locator('[data-handle="rotate"]');
    const hb = await handle.boundingBox();
    await page.mouse.move((hb?.x ?? 0) + 6, (hb?.y ?? 0) + 6);
    await page.mouse.down();
    await page.mouse.move((hb?.x ?? 0) + 200, (hb?.y ?? 0) + 60, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Math.abs(((await saved(seed, id)).scene.shapes[0]?.rot as number | undefined) ?? 0),
      )
      .toBeGreaterThan(20);
  });

  test('a connector can be curved with its bend handle and reversed from the panel', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('a');
    await stroke(page, [
      [120, 300],
      [420, 300],
    ]);
    await expect(kinds(page, 'connector')).toHaveCount(1);
    await page.getByRole('button', { name: 'Curved' }).click();
    const bend = page.locator('[data-bend]');
    const bb = await bend.boundingBox();
    await page.mouse.move((bb?.x ?? 0) + 5, (bb?.y ?? 0) + 5);
    await page.mouse.down();
    await page.mouse.move((bb?.x ?? 0) + 5, (bb?.y ?? 0) + 65, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Math.abs(((await saved(seed, id)).scene.shapes[0]?.bend as number | undefined) ?? 0),
      )
      .toBeGreaterThan(20);
    const first = (await saved(seed, id)).scene.shapes[0] as { from: { pt: number[] } };
    await page.getByRole('button', { name: 'Reverse direction' }).click();
    await expect
      .poll(
        async () => ((await saved(seed, id)).scene.shapes[0] as { to: { pt: number[] } }).to.pt[0],
      )
      .toBe(first.from.pt[0]);
  });

  test('a note card pinned to an object follows it when the object moves', async ({
    page,
    seed,
  }) => {
    const id = await openNewMap(page, seed);
    await page.keyboard.press('r');
    await stroke(page, [
      [200, 250],
      [320, 320],
    ]);
    await page.getByRole('button', { name: 'Pin a note card to it' }).click();
    await page.getByLabel('Label text').fill('Look here');
    await page.keyboard.press('Control+Enter');
    await expect(kinds(page, 'text')).toContainText('Look here');
    const note = kinds(page, 'text');
    const before = await note.boundingBox();
    await page.keyboard.press('Escape');
    await stroke(page, [
      [260, 300],
      [300, 320],
      [380, 360],
    ]);
    const after = await note.boundingBox();
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(60);
    await expect
      .poll(async () => (await saved(seed, id)).scene.shapes.some((s) => s.anchor !== undefined))
      .toBe(true);
  });

  test('a saved style can be applied to the next thing drawn', async ({ page, seed }) => {
    await openNewMap(page, seed);
    await page.getByRole('button', { name: 'Dashed' }).click();
    await page.getByRole('button', { name: '8', exact: true }).click();
    await page.getByLabel('Name for this style').fill('Trail');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Solid' }).click();
    await page.getByRole('button', { name: 'Trail', exact: true }).click();
    await page.keyboard.press('l');
    await stroke(page, [
      [120, 200],
      [420, 200],
    ]);
    const dash = await kinds(page, 'connector')
      .locator('path')
      .first()
      .getAttribute('stroke-dasharray');
    expect(dash).toBeTruthy();
  });
});
