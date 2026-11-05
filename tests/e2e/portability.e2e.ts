// USER-RUN (Electron cannot start in the build sandbox). PT-6..PT-8, PT-11 and the restore startup order (C1).
// Native dialogs are stubbed from the test through app.evaluate; main looks them up at call time.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launch, newDataDir } from './launch.ts';

type R = { ok: boolean; value?: any; error?: { code: string; message: string } };
type W = { mossnote: { rpc(m: string, a?: unknown): Promise<R> } };

const rpc = (win: Page, method: string, args?: unknown) =>
  win.evaluate(([m, a]) => (window as unknown as W).mossnote.rpc(m as string, a), [method, args] as const);

/** Polls portability.status until no job runs; the last job must have succeeded. */
async function jobDone(win: Page): Promise<void> {
  await expect
    .poll(async () => (await rpc(win, 'portability.status')).value?.job, { timeout: 60_000 })
    .toBeUndefined();
  const s = await rpc(win, 'portability.status');
  expect(s.value?.lastJob?.ok, JSON.stringify(s.value?.lastJob)).toBe(true);
}

async function makeNote(win: Page, body: string): Promise<string> {
  const r = await rpc(win, 'notes.create', { body });
  expect(r.ok).toBe(true);
  return r.value.id as string;
}
const bodyOf = async (win: Page, id: string) => (await rpc(win, 'notes.get', { id })).value?.body as string;

const stubDirDialog = (app: ElectronApplication, dir: string) =>
  app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as never;
  }, dir);

const closed = (app: ElectronApplication) => app.waitForEvent('close', { timeout: 60_000 });

test('backup now writes a library entry that lists and verifies', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    await makeNote(win, '# keep me');
    const start = await rpc(win, 'portability.backupNow', { to: 'library' });
    expect(start.ok).toBe(true);
    await jobDone(win);
    const list = await rpc(win, 'portability.backupList');
    expect(list.value).toHaveLength(1);
    const v = await rpc(win, 'portability.backupVerify', { id: list.value[0].id });
    expect(v.value).toMatchObject({ ok: true, damaged: 0 });
  } finally {
    await app.close();
  }
});

test('restore round trip: the app relaunches itself and the old text is back', async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  const id = await makeNote(first.win, 'before the backup');
  await rpc(first.win, 'portability.backupNow', { to: 'library' });
  await jobDone(first.win);
  const cur = await rpc(first.win, 'notes.get', { id });
  const saved = await rpc(first.win, 'notes.save', {
    id,
    body: 'after the backup',
    expectedContentHash: cur.value.contentHash,
  });
  expect(saved.ok, JSON.stringify(saved.error)).toBe(true);
  const [entry] = (await rpc(first.win, 'portability.backupList')).value;
  const gone = closed(first.app);
  expect((await rpc(first.win, 'portability.restoreStart', { source: { id: entry.id } })).ok).toBe(true);
  await gone; // main stages, quits through the flush handshake and relaunches; the pending restore is applied at start
  const second = await launch(dir);
  try {
    expect(await bodyOf(second.win, id)).toBe('before the backup');
    expect(fs.existsSync(path.join(dir, 'workspace', 'restore-pending.json'))).toBe(false);
  } finally {
    await second.app.close();
  }
});

test('export then import through dialog stubs gives the text back in "Imported <date>"', async () => {
  const exportDir = newDataDir();
  const { app, win } = await launch(newDataDir());
  try {
    await makeNote(win, '# Exported title\n\nexport body text');
    await stubDirDialog(app, exportDir);
    expect((await rpc(win, 'portability.exportStart', { scope: { kind: 'all' } })).ok).toBe(true);
    await jobDone(win);
    expect(fs.readdirSync(exportDir).length).toBeGreaterThan(0);
    // Import reads from the same folder (the stub still answers with it).
    expect((await rpc(win, 'portability.importStart')).ok).toBe(true);
    await jobDone(win);
    const all = await rpc(win, 'notes.list', {});
    const copies = (all.value as { title: string }[]).filter((n) => n.title === 'Exported title');
    expect(copies.length).toBe(2); // original plus the imported copy (ids differ, M5)
  } finally {
    await app.close();
  }
});

test('a cancelled folder dialog starts nothing', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as never;
    });
    const r = await rpc(win, 'portability.exportStart', { scope: { kind: 'all' } });
    expect(r.value).toEqual({ cancelled: true });
  } finally {
    await app.close();
  }
});

test('recovery mode: a corrupt workspace is restored from the library and the relaunch applies it', async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  const id = await makeNote(first.win, 'survives corruption');
  await rpc(first.win, 'portability.backupNow', { to: 'library' });
  await jobDone(first.win);
  await first.app.close();
  const db = path.join(dir, 'workspace', 'mossnote.db');
  fs.writeFileSync(db, Buffer.alloc(8192, 7)); // not a database
  for (const x of ['-wal', '-shm']) fs.rmSync(db + x, { force: true });

  const broken = await launch(dir);
  const status = await rpc(broken.win, 'app.status');
  expect(status.value.state).toBe('error');
  const list = await rpc(broken.win, 'portability.backupList');
  expect(list.ok).toBe(true);
  expect(list.value.length).toBeGreaterThan(0);
  const gone = closed(broken.app);
  expect((await rpc(broken.win, 'portability.restoreStart', { source: { id: list.value[0].id } })).ok).toBe(true);
  await gone;

  const healthy = await launch(dir);
  try {
    expect((await rpc(healthy.win, 'app.status')).value.state).toBe('ready');
    expect(await bodyOf(healthy.win, id)).toBe('survives corruption');
  } finally {
    await healthy.app.close();
  }
});
