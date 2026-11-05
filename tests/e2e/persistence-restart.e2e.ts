// USER-RUN. AS-5 / CS-12: typed text survives quit and relaunch (quit goes through the flush handshake).
import { expect, test } from '@playwright/test';
import { launch, mod, newDataDir } from './launch.ts';

test('text typed just before quit is present after relaunch', async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  await first.win.keyboard.press(`${mod}+n`);
  const editor = first.win.locator('.cm-content');
  await editor.click();
  await first.win.keyboard.type('persist me across restart');
  await first.app.close(); // no wait: the quit must flush drafts and save within 2 s
  const second = await launch(dir);
  try {
    await expect(second.win.locator('body')).toContainText('persist me across restart');
    // The note itself holds the text (saved by the quit handshake), so there is nothing to recover.
    await second.win.getByRole('option').first().click();
    await expect(second.win.locator('.cm-content')).toContainText('persist me across restart');
    await expect(second.win.getByLabel('Recovered text')).toHaveCount(0);
    await expect(second.win.getByLabel('Unsaved text')).toHaveCount(0);
  } finally {
    await second.app.close();
  }
});
