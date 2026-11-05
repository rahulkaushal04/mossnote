// Shared helper for the Electron e2e files. USER-RUN: Electron cannot start in the build sandbox.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const desktopDir = path.resolve('packages/desktop');
export const newDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mossnote-e2e-'));

/** MOSSNOTE_DATA_DIR relocates userData (db, window state, instance lock), so runs never touch real notes. MOSSNOTE_E2E=1 enables the smoke probes and the blocked-request counter. */
export async function launch(
  dataDir: string,
  extraArgs: string[] = [],
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: [...extraArgs, desktopDir],
    env: { ...process.env, MOSSNOTE_DATA_DIR: dataDir, MOSSNOTE_E2E: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
