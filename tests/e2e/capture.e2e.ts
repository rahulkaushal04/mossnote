// USER-RUN. A real OS keypress for the global shortcut cannot be simulated: NEEDS HUMAN
// (press Cmd/Ctrl+Shift+Alt+N with the main window closed and confirm the capture window appears).
import { expect, test } from '@playwright/test';
import { launch, mod, newDataDir } from './launch.ts';

test('AS-11 quick capture via the menu command, shortcut registered', async () => {
  const { app } = await launch(newDataDir());
  try {
    expect(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered('CommandOrControl+Shift+Alt+N'),
      ),
    ).toBe(true);
    if (process.platform === 'darwin') {
      // macOS keeps the app alive with no windows (decision 2); other platforms quit.
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.close();
      });
      await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBe(0);
    }
    const capturePromise = app.waitForEvent('window');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('capture.open')?.click(),
    );
    const cap = await capturePromise;
    expect(cap.url()).toContain('#capture');
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.getBounds().width),
      ),
    ).toContain(480);
    await cap.getByRole('textbox').fill('captured from e2e');
    await cap.keyboard.press(`${mod}+Enter`);
    await expect(cap.locator('body')).toContainText('Saved to Inbox');
    // The capture window may call only its allowlisted methods.
    const blocked = await cap.evaluate(async () => {
      const r = await (
        window as unknown as { mossnote: { rpc(m: string, a: unknown): Promise<{ ok: boolean }> } }
      ).mossnote.rpc('notes.list', {});
      return r.ok;
    });
    expect(blocked).toBe(false);
    // Re-opening reuses the one window.
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('capture.open')?.click(),
    );
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((w) => w.getBounds().width === 480).length,
      ),
    ).toBe(1);
  } finally {
    await app.close();
  }
});
