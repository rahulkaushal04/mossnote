// USER-RUN. AS-14: nothing leaves the machine. DNS is unresolvable and the proxy is a dead port, so any
// attempt fails loudly. Background Chromium traffic (DNS prefetch, updater) is invisible to these checks:
// NEEDS HUMAN spot check with Little Snitch or `nettop`.
import { expect, test } from '@playwright/test';
import { launch, mod, newDataDir } from './launch.ts';

test('app works offline with zero blocked or foreign requests', async () => {
  const { app, win } = await launch(newDataDir(), [
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--proxy-server=127.0.0.1:9',
  ]);
  const foreign: string[] = [];
  win.on('request', (r) => {
    if (!r.url().startsWith('file:')) foreign.push(r.url());
  });
  try {
    await win.keyboard.press(`${mod}+n`);
    await win.locator('.cm-content').click();
    await win.keyboard.type('# offline\n\n![x](https://example.com/a.png)\n');
    await win.keyboard.press(`${mod}+k`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(1500);
    expect(foreign).toEqual([]);
    expect(
      await app.evaluate(() => (globalThis as { __blockedRequests?: number }).__blockedRequests),
    ).toBe(0);
  } finally {
    await app.close();
  }
});
