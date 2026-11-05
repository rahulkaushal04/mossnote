// @vitest-environment jsdom
// PT-1..PT-13 (UI part): Data and backups dialog, recovery screen, multi-select + bulk actions.
// Real workspace + dispatcher + structuredClone loopback; the main-process dialogs are answered by
// env.picks. REAL timers (axe hangs under fake ones); the app under test uses manual timers.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDispatcher, openWorkspace } from '@mossnote/core';
import type { BackupSummary, JobResult, PortabilityStatus } from '@mossnote/core/rpc';
import { App } from '../src/app/App';
import { commands } from '../src/commands/manifest';
import { createSelection, rangeIds } from '../src/portability/selection';
import {
  checkPassphrase,
  importLines,
  parseSchedule,
  SCHEDULE_MESSAGE,
} from '../src/portability/summary';
import { applyTheme } from '../src/theme/applyTheme';
import {
  bootApp,
  noteOptions,
  runAxe,
  seed,
  serious,
  text,
  typeInto,
  type Booted,
} from './helpers/app';
import { click, mount, press, waitFor, type Mounted } from './helpers/dom';
import { createLoopback } from './helpers/loopback';
import { choose } from './helpers/search';
import { manualTimers } from './helpers/timers';
import { makeEnv, type Env } from './helpers/workspace';

const envs: Env[] = [];
const apps: (Booted | Mounted)[] = [];
const fresh = (): Env => {
  const e = makeEnv();
  envs.push(e);
  return e;
};
const tmp = () => mkdtempSync(join(tmpdir(), 'mossnote-pt-'));
let env: Env;
let b: Booted;
beforeEach(() => {
  env = fresh();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await ('m' in a ? a.m : a).unmount();
  for (const e of envs.splice(0)) e.cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

async function boot(e: Env = env, o: Parameters<typeof bootApp>[1] = {}): Promise<Booted> {
  const x = await bootApp(e, o);
  apps.push(x);
  return x;
}
const command = (id: string, e: Env = env) =>
  act(async () => e.bridge.emit({ type: 'command', id }));
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
const alertDialog = () => document.querySelector<HTMLElement>('[role=alertdialog]');
const btn = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label,
  );
const input = (label: string) =>
  [...document.querySelectorAll<HTMLLabelElement>('label')]
    .find((l) => l.textContent?.trim().startsWith(label))
    ?.querySelector<HTMLInputElement>('input') as HTMLInputElement;
const bars = () => [...document.querySelectorAll<HTMLElement>('[role=progressbar]')];
const emitJob = (e: Env, j: Record<string, unknown>) =>
  act(async () => e.bridge.emit({ type: 'job', ...j } as never));
const jobDone = (x: Booted, kind: string) =>
  waitFor(() => x.model().jobs.get().last?.kind === kind, `${kind} job final event`);
const lastResult = (x: Booted) => x.model().jobs.get().last?.result as JobResult;

const status = (over: Partial<PortabilityStatus> = {}): PortabilityStatus => ({
  schedule: { auto: true, intervalHours: 24, keep: 7 },
  lastAutoBackupAt: null,
  libraryBytes: 1536,
  pendingImport: false,
  restorePending: false,
  ...over,
});
const backup = (over: Partial<BackupSummary> = {}): BackupSummary => ({
  id: 'b1',
  kind: 'manual',
  createdAt: Date.UTC(2026, 10, 5, 12, 0, 0),
  size: 2048,
  encrypted: false,
  valid: true,
  restorable: true,
  noteCount: 3,
  ...over,
});
const noCount = (b: BackupSummary): BackupSummary => {
  delete b.noteCount;
  return b;
};
const injectList = (e: Env, list: BackupSummary[]) =>
  e.bridge.inject('portability.backupList', { ok: true, value: list }, 20);

describe('manifest', () => {
  it('adds the portability and bulk commands without shortcuts (no clash possible)', () => {
    const mine = commands.filter((c) => /^(portability|bulk)\./.test(c.id));
    expect(mine.map((c) => c.id).sort()).toEqual([
      'bulk.export',
      'bulk.move',
      'bulk.select',
      'bulk.selectAll',
      'bulk.tag',
      'bulk.trash',
      'bulk.untag',
      'portability.backup',
      'portability.export',
      'portability.import',
      'portability.open',
      'portability.restore',
    ]);
    expect(mine.every((c) => !c.shortcut)).toBe(true);
  });
});

describe('pure helpers', () => {
  it('passphrase rules: empty is fine, otherwise 8+ characters that match', () => {
    expect(checkPassphrase('', '')).toEqual({ ok: true });
    expect(checkPassphrase('short', 'short')).toMatchObject({ ok: false });
    expect(checkPassphrase('long enough', 'long enoug')).toMatchObject({ ok: false });
    expect(checkPassphrase('long enough', 'long enough')).toEqual({ ok: true });
  });
  it('schedule bounds: hours 1..168, keep 1..100, whole numbers', () => {
    expect(parseSchedule(true, '24', '7')).toEqual({ auto: true, intervalHours: 24, keep: 7 });
    for (const [i, k] of [
      ['0', '7'],
      ['169', '7'],
      ['24', '0'],
      ['24', '101'],
      ['1.5', '7'],
      ['x', '7'],
      ['24', ''],
    ] as const)
      expect(parseSchedule(false, i, k), `${i}/${k}`).toBeUndefined();
  });
  it('the import report shows the first lines and counts the rest', () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      rel: `f${i}`,
      status: 'skipped' as const,
      reason: 'x',
    }));
    expect(importLines(files)).toMatchObject({ more: 5 });
    expect(importLines(files).shown).toHaveLength(20);
  });
});

describe('selection logic', () => {
  const order = Array.from({ length: 10_050 }, (_, i) => `n${i}`);
  it('ranges run in view order in either direction and ignore unknown ids', () => {
    expect(rangeIds(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(['a', 'b'], 'zz', 'b')).toEqual(['b']);
    expect(rangeIds(['a', 'b'], 'a', 'zz')).toEqual([]);
  });
  it('toggle, extend from the anchor, and prune to the view', () => {
    const s = createSelection();
    s.enter();
    s.toggle('n1');
    s.extend(order, 'n4');
    expect([...s.get().ids]).toEqual(['n1', 'n2', 'n3', 'n4']);
    s.toggle('n2');
    expect(s.get().ids.has('n2')).toBe(false);
    s.prune(['n1', 'n4', 'n9']);
    expect([...s.get().ids].sort()).toEqual(['n1', 'n4']);
    s.exit();
    expect(s.get()).toMatchObject({ on: false, anchor: null });
    expect(s.get().ids.size).toBe(0);
  });
  it('select all stops at 10,000 and says so; adding past the cap is refused', () => {
    const s = createSelection();
    s.enter();
    s.selectAll(order);
    expect(s.get().ids.size).toBe(10_000);
    expect(s.get().capped).toBe(true);
    s.toggle('n10040');
    expect(s.get().ids.size).toBe(10_000);
    expect(s.get().ids.has('n10040')).toBe(false);
    s.selectAll(order.slice(0, 5));
    expect(s.get()).toMatchObject({ capped: false });
    expect(s.get().ids.size).toBe(5);
  });
});

describe('Data and backups: export and import', () => {
  it('exports from one workspace and imports into a fresh one through the UI, with progress events and a report', async () => {
    await seed(env, '# Alpha\nbody a', '# Beta\nbody b');
    const out = tmp();
    env.picks.exportDir = out;
    b = await boot();
    await command('portability.export');
    await waitFor(() => !!dialog(), 'dialog opens');
    await jobDone(b, 'export');
    expect(env.asked).toEqual(['export']);
    expect(text()).toContain('Exported 2 notes');
    const exported = lastResult(b);
    if (exported.kind !== 'export') throw new Error('not an export result');
    expect(existsSync(join(out, exported.folderName))).toBe(true);
    await b.m.unmount();
    apps.length = 0;

    const env2 = fresh();
    env2.picks.importDir = join(out, exported.folderName);
    const b2 = await boot(env2, { ready: () => /No notes yet/.test(text()) });
    await command('portability.import', env2);
    await jobDone(b2, 'import');
    expect(env2.asked).toEqual(['import']);
    const imp = lastResult(b2);
    if (imp.kind !== 'import') throw new Error('not an import result');
    expect(imp.added).toBe(2);
    expect(text()).toMatch(/Imported into “Imported .+”: 2 added, 0 skipped, 0 repaired\./);
    await click(btn('Close'));
    await waitFor(() => noteOptions().length === 2, 'imported notes listed');
    expect(
      noteOptions()
        .map((o) => o.textContent)
        .sort(),
    ).toEqual(['Alpha', 'Beta']);
  });

  it('shows progress as a progressbar with values and disables every start button while a job runs', async () => {
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    expect(bars()).toHaveLength(0);
    expect(btn('Export all notes…')!.disabled).toBe(false);
    await emitJob(env, { jobId: 'j1', kind: 'export', phase: 'writing', done: 3, total: 10 });
    const bar = bars()[0]!;
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBe('Export progress');
    for (const l of [
      'Export all notes…',
      'Import notes…',
      'Back up now',
      'Save backup as…',
      'Restore from a file…',
    ])
      expect(btn(l)!.disabled, l).toBe(true);
    await emitJob(env, { jobId: 'j1', kind: 'export', phase: 'writing', done: 7, total: 10 });
    expect(bars()[0]!.getAttribute('aria-valuenow')).toBe('7');
    // A second start while one runs is refused without reaching the dispatcher.
    await click(btn('Export all notes…'));
    expect(env.bridge.count('portability.exportStart')).toBe(0);
    await emitJob(env, {
      jobId: 'j1',
      kind: 'export',
      phase: 'done',
      done: 10,
      total: 10,
      result: {
        kind: 'export',
        folderName: 'Out',
        notes: 4,
        attachments: 0,
        warnings: ['skipped one <b>odd</b> file'],
      },
    });
    expect(bars()).toHaveLength(0);
    expect(btn('Export all notes…')!.disabled).toBe(false);
    expect(text()).toContain('Exported 4 notes');
    expect(dialog()!.querySelector('b')).toBeNull();
    expect(text()).toContain('skipped one <b>odd</b> file');
  });

  it('picks up a job that was already running when the dialog opened (status.job)', async () => {
    b = await boot();
    env.bridge.inject('portability.status', {
      ok: true,
      value: status({ job: { jobId: 'j9', kind: 'import', phase: 'reading', done: 1, total: 4 } }),
    });
    await command('portability.open');
    await waitFor(() => bars().length === 1, 'running job shown');
    expect(btn('Import notes…')!.disabled).toBe(true);
    expect(bars()[0]!.getAttribute('aria-valuenow')).toBe('1');
  });

  it('a cancelled picker and an "already running" refusal are messages, not failures', async () => {
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    await click(btn('Export all notes…'));
    await waitFor(() => /Cancelled\. Nothing was changed\./.test(text()), 'cancel message');
    env.bridge.inject('portability.importStart', {
      ok: false,
      error: {
        code: 'unavailable',
        message: 'Another export, import or backup is already running.',
      },
    });
    await click(btn('Import notes…'));
    await waitFor(() => /already running/.test(text()), 'busy message');
    expect(document.querySelector('[role=alert]')!.textContent).toContain('already running');
    await click(btn('Retry'));
    await waitFor(() => env.bridge.count('portability.importStart') === 2, 'retried');
  });

  it('a failed job shows the reason with Retry that starts the same action again', async () => {
    env.picks.exportDir = tmp();
    b = await boot();
    await command('portability.open');
    await click(btn('Export all notes…'));
    await jobDone(b, 'export');
    await emitJob(env, {
      jobId: 'j2',
      kind: 'export',
      phase: 'failed',
      done: 0,
      total: 0,
      error: { code: 'internal', message: 'disk full' },
    });
    expect(document.querySelector('[role=alert]')!.textContent).toContain(
      'Export failed: disk full',
    );
    await click(btn('Retry'));
    await waitFor(() => env.bridge.count('portability.exportStart') === 2, 'export started again');
  });

  it('offers "Resume import" for an interrupted import', async () => {
    b = await boot();
    env.bridge.inject('portability.status', { ok: true, value: status({ pendingImport: true }) });
    await command('portability.open');
    await waitFor(() => !!btn('Resume import'), 'resume button');
    expect(text()).toContain('An earlier import was interrupted');
    expect(btn('Import notes…')).toBeUndefined();
  });

  it('renders the import report and warnings as text only (hostile names stay inert), first lines only', async () => {
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    const evil = '<img src=x onerror="window.__pwned=1">';
    const files = Array.from({ length: 23 }, (_, i) => ({
      rel: i === 0 ? evil : `file-${i}.md`,
      status: 'skipped' as const,
      reason: i === 0 ? '<script>window.__pwned=2</script>' : 'unreadable',
    }));
    await emitJob(env, {
      jobId: 'j3',
      kind: 'import',
      phase: 'done',
      done: 1,
      total: 1,
      result: {
        kind: 'import',
        added: 5,
        skipped: 23,
        repaired: 1,
        folderName: evil,
        files,
        truncated: true,
        reportFile: 'report.txt',
        resumed: true,
      },
    });
    const d = dialog()!;
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('script')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(d.textContent).toContain(evil);
    expect(d.textContent).toContain('Resumed import');
    expect(d.textContent).toContain('5 added, 23 skipped, 1 repaired');
    const items = [...d.querySelectorAll('[aria-label="Import report"] li')];
    expect(items).toHaveLength(20);
    expect(d.textContent).toContain('3 more not shown');
    expect(d.textContent).toContain('report.txt');
  });
});

describe('Data and backups: backups, schedule, restore', () => {
  it('Back up now writes a library backup that appears in the list, is verified, and shows disk use', async () => {
    await seed(env, 'one', 'two');
    b = await boot();
    await command('portability.backup');
    await waitFor(() => !!dialog(), 'dialog');
    await jobDone(b, 'backup');
    expect(text()).toContain('Backup saved and checked: 2 notes');
    await waitFor(
      () => document.querySelectorAll('[aria-label=Backups] > li').length === 1,
      'backup listed',
    );
    const li = document.querySelector('[aria-label=Backups] > li')!;
    expect(li.textContent).toContain('2 notes');
    expect(li.textContent).toContain('Looks valid');
    expect(li.textContent).not.toContain('Encrypted');
    expect(text()).toMatch(/Backups use [\d.]+ (KB|MB) on disk/);
    await click(li.querySelector('button[aria-label^="Verify backup"]'));
    await waitFor(
      () => /all data is intact \(2 notes\)/.test(li.textContent ?? ''),
      'verify result',
    );
  });

  it('shows date, kind, size and the encrypted / valid / restorable / damaged badges as text', async () => {
    b = await boot();
    injectList(env, [
      backup({ id: 'a', encrypted: true, damaged: 2 }),
      noCount(backup({ id: 'b', kind: 'pre-migration', valid: false, restorable: false })),
      backup({ id: 'c', kind: '<i>evil</i>' as never }),
    ]);
    await command('portability.open');
    await waitFor(
      () => document.querySelectorAll('[aria-label=Backups] > li').length === 3,
      'three backups',
    );
    const [a, bb, c] = [...document.querySelectorAll('[aria-label=Backups] > li')];
    expect(a!.textContent).toContain('Manual, 2.0 KB, 3 notes');
    expect(a!.textContent).toContain('Encrypted');
    expect(a!.textContent).toContain('Incomplete: 2 damaged files');
    expect(bb!.textContent).toContain('Before an update');
    expect(bb!.textContent).toContain('Not valid');
    expect(bb!.textContent).toContain('Cannot be restored');
    expect(bb!.querySelector('button[aria-label^="Restore backup"]')).toBeNull();
    expect(c!.querySelector('i')).toBeNull();
    expect(c!.textContent).toContain('<i>evil</i>');
  });

  it('a failing backup list shows an error with Retry', async () => {
    b = await boot();
    env.bridge.inject('portability.backupList', {
      ok: false,
      error: { code: 'internal', message: 'library unreadable' },
    });
    await command('portability.open');
    await waitFor(() => /library unreadable/.test(text()), 'list error');
    await click(btn('Retry'));
    await waitFor(() => /No backups yet/.test(text()), 'list after retry');
  });

  it('Save backup as…: passphrase needs 8+ characters and a matching confirmation; it is cleared after use and never in the state', async () => {
    await seed(env, 'secret note');
    const file = join(tmp(), 'x.mossbak');
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    const pass = () => input('Passphrase (optional)');
    const conf = () => input('Confirm passphrase');
    expect(pass().type).toBe('password');
    expect(conf().type).toBe('password');
    expect(pass().getAttribute('autocomplete')).toBe('off');
    expect(conf().getAttribute('autocomplete')).toBe('off');

    await typeInto(pass(), 'short');
    await typeInto(conf(), 'short');
    await click(btn('Save backup as…'));
    expect(document.querySelector('[role=alert]')!.textContent).toMatch(/at least 8/);
    expect(env.bridge.count('portability.backupNow')).toBe(0);

    await typeInto(pass(), 'correct horse');
    await typeInto(conf(), 'correct hors');
    await click(btn('Save backup as…'));
    expect(document.querySelector('[role=alert]')!.textContent).toMatch(/do not match/);
    expect(env.bridge.count('portability.backupNow')).toBe(0);

    await typeInto(conf(), 'correct horse');
    env.picks.save = file;
    await click(btn('Save backup as…'));
    await jobDone(b, 'backup');
    expect(env.bridge.calls.find((c) => c.method === 'portability.backupNow')!.args).toEqual({
      to: 'file',
      passphrase: 'correct horse',
    });
    expect(pass().value).toBe('');
    expect(conf().value).toBe('');
    expect(existsSync(file)).toBe(true);
    expect(env.asked[0]).toMatch(/^save:Mossnote backup .+\.mossbak$/);
    expect(text()).toContain('encrypted');
    expect(JSON.stringify(b.model().jobs.get())).not.toContain('correct horse');
  });

  it('Save backup as… without a passphrase sends none; a cancelled save dialog changes nothing', async () => {
    b = await boot();
    await command('portability.open');
    await click(btn('Save backup as…'));
    await waitFor(() => /Cancelled\. Nothing was changed\./.test(text()), 'cancelled');
    expect(env.bridge.calls.find((c) => c.method === 'portability.backupNow')!.args).toEqual({
      to: 'file',
    });
  });

  it('schedule: validates before saving, then persists through setSchedule', async () => {
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    await waitFor(() => /Backups use/.test(text()), 'status loaded');
    await typeInto(input('Every (hours, 1 to 168)'), '0');
    await click(btn('Save schedule'));
    expect(document.querySelector('[role=alert]')!.textContent).toBe(SCHEDULE_MESSAGE);
    expect(env.bridge.count('portability.setSchedule')).toBe(0);
    await typeInto(input('Every (hours, 1 to 168)'), '12');
    await typeInto(input('Keep the newest (1 to 100)'), '300');
    await click(btn('Save schedule'));
    expect(env.bridge.count('portability.setSchedule')).toBe(0);
    await typeInto(input('Keep the newest (1 to 100)'), '3');
    await click(input('Back up automatically'));
    await click(btn('Save schedule'));
    await waitFor(() => /Saved\./.test(text()), 'saved');
    const st = await env.bridge.rpc('portability.status', {});
    expect(st).toMatchObject({
      ok: true,
      value: { schedule: { auto: false, intervalHours: 12, keep: 3 } },
    });
  });

  it('Restore: the confirm names the date and note count, says current data is kept aside, and Cancel changes nothing', async () => {
    await seed(env, 'one', 'two');
    b = await boot();
    await command('portability.backup');
    await jobDone(b, 'backup');
    await waitFor(
      () => document.querySelectorAll('[aria-label=Backups] > li').length === 1,
      'listed',
    );
    await click(document.querySelector('button[aria-label^="Restore backup"]'));
    const d = alertDialog()!;
    expect(d.getAttribute('aria-labelledby')).toBeTruthy();
    expect(d.querySelector('h2')!.textContent).toMatch(/^Restore the backup from /);
    expect(d.textContent).toContain('2 notes');
    expect(d.textContent).toMatch(/current notes are kept aside/);
    expect(d.textContent).not.toContain('incomplete');
    expect(document.activeElement).toBe(btn('Cancel'));
    await press(d, 'Escape');
    expect(alertDialog()).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(env.bridge.count('portability.restoreStart')).toBe(0);

    await click(document.querySelector('button[aria-label^="Restore backup"]'));
    await click(btn('Restore this backup'));
    await jobDone(b, 'restore');
    expect(env.bridge.calls.find((c) => c.method === 'portability.restoreStart')!.args).toEqual({
      source: { id: expect.any(String) },
    });
    await waitFor(() => /Restarting Mossnote/.test(text()), 'restarting state');
    for (const l of ['Export all notes…', 'Import notes…', 'Back up now', 'Restore from a file…'])
      expect(btn(l)!.disabled, l).toBe(true);
    await waitFor(() => env.restarts.length === 1, 'desktop asked to relaunch');
  });

  it('Restore of a damaged backup warns before the user confirms', async () => {
    b = await boot();
    injectList(env, [backup({ id: 'd', damaged: 2, noteCount: 1 })]);
    await command('portability.open');
    await waitFor(() => !!document.querySelector('button[aria-label^="Restore backup"]'), 'row');
    await click(document.querySelector('button[aria-label^="Restore backup"]'));
    const d = alertDialog()!;
    expect(d.textContent).toContain('this backup is incomplete');
    expect(d.textContent).toContain('2 attachment files were already damaged');
    expect(d.textContent).toContain('1 note');
    await click(btn('Cancel'));
    expect(env.bridge.count('portability.restoreStart')).toBe(0);
  });

  it('Restore from a file asks for an optional passphrase, clears it, and a cancelled file dialog is a message', async () => {
    b = await boot();
    await command('portability.restore');
    await waitFor(() => !!dialog(), 'dialog');
    await click(btn('Restore from a file…'));
    const p = input('Passphrase (only if the file is encrypted)');
    expect(p.type).toBe('password');
    expect(p.getAttribute('autocomplete')).toBe('off');
    await typeInto(p, 'hunter2hunter2');
    await click(btn('Choose file and restore'));
    await waitFor(() => /Restore cancelled\. Nothing was changed\./.test(text()), 'cancelled');
    expect(env.asked).toContain('open');
    expect(env.bridge.calls.find((c) => c.method === 'portability.restoreStart')!.args).toEqual({
      source: { file: true },
      passphrase: 'hunter2hunter2',
    });
    await click(btn('Restore from a file…'));
    expect(input('Passphrase (only if the file is encrypted)').value).toBe('');
  });

  it('Verify of an encrypted backup asks for the passphrase (password field, autocomplete off) and clears it', async () => {
    b = await boot();
    injectList(env, [backup({ id: 'enc', encrypted: true })]);
    env.bridge.inject('portability.backupVerify', {
      ok: true,
      value: { ok: true, damaged: 1, noteCount: 3 },
    });
    await command('portability.open');
    await waitFor(() => !!document.querySelector('button[aria-label^="Verify backup"]'), 'row');
    await click(document.querySelector('button[aria-label^="Verify backup"]'));
    expect(env.bridge.count('portability.backupVerify')).toBe(0);
    const p = input('Passphrase for this backup');
    expect(p.type).toBe('password');
    expect(p.getAttribute('autocomplete')).toBe('off');
    await typeInto(p, 'open sesame');
    await click(btn('Check backup'));
    await waitFor(
      () => /readable, but 1 attachment file was already damaged/.test(text()),
      'verdict',
    );
    expect(env.bridge.calls.find((c) => c.method === 'portability.backupVerify')!.args).toEqual({
      id: 'enc',
      passphrase: 'open sesame',
    });
    expect(input('Passphrase for this backup')).toBeUndefined();
  });

  it('keyboard: Esc closes, Tab stays inside the dialog, the opener command can reopen it', async () => {
    b = await boot();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'dialog');
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 40; i++) {
      await press(dialog()!, 'Tab');
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    }
    await press(dialog()!, 'Escape');
    expect(dialog()).toBeNull();
    await command('portability.open');
    await waitFor(() => !!dialog(), 'reopened');
  });
});

/** A workspace whose database is garbage: only the recovery-mode methods work. */
async function corruptBridge(e: Env) {
  const started = await e.bridge.rpc('portability.backupNow', { to: 'library' });
  expect(started.ok).toBe(true);
  await e.dispatcher.drain();
  e.dispatcher.close();
  writeFileSync(join(e.dir, 'w.db'), Buffer.alloc(8192, 9));
  const r = openWorkspace(join(e.dir, 'w.db'));
  expect(r.ok).toBe(false);
  const restarts: number[] = [];
  const d = createDispatcher(r, {
    platform: 'test',
    restartForRestore: () => void restarts.push(1),
  });
  return { d, bridge: createLoopback(d), restarts };
}

describe('recovery screen', () => {
  it('lists backups and restores using only the recovery-mode methods', async () => {
    await seed(env, 'precious');
    const c = await corruptBridge(env);
    const quits: number[] = [];
    const m = await mount(
      <App bridge={c.bridge} timers={manualTimers()} onQuit={() => void quits.push(1)} />,
    );
    apps.push(m);
    await waitFor(
      () => document.querySelectorAll('[aria-label=Backups] > li').length === 1,
      'backups listed',
    );
    expect(m.el.querySelector('h1')!.textContent).toContain('can’t open your notes');
    expect(m.el.querySelector('[role=alert]')!.textContent).not.toBe('');
    await click(document.querySelector('button[aria-label^="Verify backup"]'));
    await waitFor(() => /all data is intact/.test(text()), 'verified');
    await click(document.querySelector('button[aria-label^="Restore backup"]'));
    expect(alertDialog()!.textContent).toContain('1 note');
    await click(btn('Restore this backup'));
    await waitFor(() => /Restarting Mossnote/.test(text()), 'restarting');
    await waitFor(() => c.restarts.length === 1, 'relaunch requested');
    const allowed = new Set([
      'app.status',
      'portability.backupList',
      'portability.backupVerify',
      'portability.restoreStart',
      'app.quit',
    ]);
    const used = c.bridge.calls.map((x) => x.method);
    expect(used.filter((x) => !allowed.has(x))).toEqual([]);
    expect(used).toContain('portability.restoreStart');
    expect(btn('Restore from a file…')!.disabled).toBe(true);
    await click(btn('Quit'));
    expect(quits).toEqual([1]);
    c.d.close();
  });

  it('an injected corrupt status shows the recovery screen; a failing list has Retry; other failures keep the plain screen', async () => {
    env.bridge.inject('app.status', {
      ok: true,
      value: {
        state: 'error',
        code: 'corrupt',
        message: 'database disk image is malformed',
        platform: 'test',
      },
    });
    env.bridge.inject('portability.backupList', {
      ok: false,
      error: { code: 'internal', message: 'no library' },
    });
    const m = await mount(<App bridge={env.bridge} timers={manualTimers()} />);
    apps.push(m);
    await waitFor(() => /no library/.test(text()), 'list error');
    expect(text()).toContain('database disk image is malformed');
    await click(btn('Retry'));
    await waitFor(
      () => !/no library/.test(text()) && !!document.querySelector('[aria-label=Backups]'),
      'list after retry',
    );
    await m.unmount();
    apps.pop();

    env.bridge.inject('app.status', {
      ok: true,
      value: {
        state: 'error',
        code: 'locked',
        message: 'in use by another window',
        platform: 'test',
      },
    });
    const m2 = await mount(<App bridge={env.bridge} timers={manualTimers()} />);
    apps.push(m2);
    await waitFor(() => /in use by another window/.test(text()), 'plain fatal screen');
    expect(document.querySelector('[aria-label=Backups]')).toBeNull();
    expect(btn('Quit')).toBeDefined();
  });
});

describe('axe: no serious or critical violations in either theme', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`dialog states and the recovery screen (${theme})`, async () => {
      applyTheme(theme);
      b = await boot(env, { theme });
      injectList(env, [
        backup({ id: 'a', encrypted: true, damaged: 1 }),
        backup({ id: 'b', valid: false, restorable: false }),
      ]);
      await command('portability.open');
      await waitFor(
        () => document.querySelectorAll('[aria-label=Backups] > li').length === 2,
        'rows',
      );
      expect(serious(await runAxe())).toEqual([]);

      await emitJob(env, { jobId: 'j', kind: 'import', phase: 'reading', done: 2, total: 9 });
      expect(serious(await runAxe())).toEqual([]);
      await emitJob(env, {
        jobId: 'j',
        kind: 'import',
        phase: 'done',
        done: 9,
        total: 9,
        result: {
          kind: 'import',
          added: 1,
          skipped: 1,
          repaired: 0,
          folderName: 'I',
          files: [{ rel: 'a.md', status: 'skipped', reason: 'empty' }],
          truncated: false,
          reportFile: 'r.txt',
          resumed: false,
        },
      });
      expect(serious(await runAxe())).toEqual([]);
      await emitJob(env, {
        jobId: 'k',
        kind: 'export',
        phase: 'failed',
        done: 0,
        total: 0,
        error: { code: 'internal', message: 'boom' },
      });
      expect(serious(await runAxe())).toEqual([]);

      await click(document.querySelectorAll('button[aria-label^="Verify backup"]')[0]);
      expect(serious(await runAxe())).toEqual([]);
      await click(btn('Cancel'));
      await click(document.querySelectorAll('button[aria-label^="Restore backup"]')[0]);
      expect(alertDialog()).not.toBeNull();
      expect(serious(await runAxe())).toEqual([]);
    });

    it(`recovery screen (${theme})`, async () => {
      applyTheme(theme);
      const c = await corruptBridge(env);
      const m = await mount(<App bridge={c.bridge} timers={manualTimers()} />);
      apps.push(m);
      await waitFor(
        () => document.querySelectorAll('[aria-label=Backups] > li').length === 1,
        'rows',
      );
      expect(serious(await runAxe())).toEqual([]);
      await click(document.querySelector('button[aria-label^="Restore backup"]'));
      expect(serious(await runAxe())).toEqual([]);
      c.d.close();
    });

    it(`multi-select bar and bulk dialogs (${theme})`, async () => {
      applyTheme(theme);
      await seed(env, 'Note A', 'Note B');
      b = await boot(env, { theme });
      await click(btn('Select notes'));
      await click(noteOptions()[0]);
      expect(serious(await runAxe())).toEqual([]);
      await click(btn('Move to…'));
      await waitFor(() => !!dialog(), 'move dialog');
      expect(serious(await runAxe())).toEqual([]);
    });
  }
});

describe('multi-select and bulk actions', () => {
  const row = (t: string) => noteOptions().find((o) => o.textContent?.includes(t))!;
  const countText = () => document.querySelector('.bulkbar-count')?.textContent ?? '';
  const clickWith = (el: Element, init: MouseEventInit) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    });
  const toast = () =>
    b
      .model()
      .toasts.get()
      .toasts.map((t) => t.message);
  const listCount = async () => {
    const r = await env.bridge.rpc('notes.list', {});
    return r.ok ? (r.value as unknown[]).length : -1;
  };
  const folderOf = async (id: string) => {
    const r = await env.bridge.rpc('notes.get', { id });
    return r.ok ? (r.value as { folderId: string | null }).folderId : 'error';
  };
  let ids: string[];
  beforeEach(async () => {
    ids = await seed(env, 'Note A', 'Note B', 'Note C', 'Note D');
    b = await boot();
  });

  it('the Select button toggles checkbox mode; plain click selects instead of opening; Shift and Ctrl click make ranges', async () => {
    expect(btn('Select notes')).toBeDefined();
    await click(btn('Select notes'));
    expect(countText()).toBe('No notes selected');
    expect(
      document.querySelector('ul[aria-label=Notes]')!.getAttribute('aria-multiselectable'),
    ).toBe('true');
    const order = noteOptions().map((o) => o.textContent!.replace(/^[☐☑]/, ''));
    await click(noteOptions()[0]);
    expect(countText()).toBe('1 note selected');
    expect(b.model().store.get().openId).toBeNull();
    await clickWith(noteOptions()[2]!, { shiftKey: true });
    expect(countText()).toBe('3 notes selected');
    expect(noteOptions().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'true',
      'true',
      'true',
      'false',
    ]);
    await clickWith(noteOptions()[3]!, { ctrlKey: true });
    expect(countText()).toBe('4 notes selected');
    await clickWith(noteOptions()[1]!, { metaKey: true });
    expect(countText()).toBe('3 notes selected');
    expect(order).toHaveLength(4);
    await click(btn('Done'));
    expect(btn('Select notes')).toBeDefined();
    expect(noteOptions()[0]!.textContent).not.toMatch(/[☐☑]/);
  });

  it('keyboard: Space toggles, Shift+Arrow extends, Ctrl+A selects all in view, Esc leaves the mode', async () => {
    await command('bulk.select');
    noteOptions()[0]!.focus();
    await press(noteOptions()[0]!, ' ');
    expect(countText()).toBe('1 note selected');
    await press(noteOptions()[0]!, 'ArrowDown', { shiftKey: true });
    expect(countText()).toBe('2 notes selected');
    await press(document.activeElement!, 'ArrowDown', { shiftKey: true });
    expect(countText()).toBe('3 notes selected');
    await press(document.activeElement!, 'a', { ctrlKey: true });
    expect(countText()).toBe('4 notes selected');
    await press(document.activeElement!, ' ');
    expect(countText()).toBe('3 notes selected');
    await press(document.activeElement!, 'Escape');
    expect(btn('Select notes')).toBeDefined();
    expect(b.model().selection.get().ids.size).toBe(0);
  });

  it('Select all in view announces the count; a command from the palette path does the same', async () => {
    await click(btn('Select notes'));
    await click(btn('Select all in view'));
    expect(countText()).toBe('4 notes selected');
    expect(document.querySelector('.bulkbar-count')!.getAttribute('role')).toBe('status');
    await command('bulk.select'); // toggles the mode off
    expect(btn('Select notes')).toBeDefined();
    await command('bulk.select');
    await command('bulk.selectAll');
    expect(countText()).toBe('4 notes selected');
  });

  it('actions are disabled with nothing selected, and bulk commands are not enabled', async () => {
    await click(btn('Select notes'));
    for (const l of ['Move to…', 'Tag…', 'Untag…', 'Move to Trash', 'Export selection…'])
      expect(btn(l)!.disabled, l).toBe(true);
    await command('bulk.trash');
    expect(env.bridge.count('bulk.trash')).toBe(0);
  });

  it('Move to Trash is one action with one Undo that restores every note', async () => {
    await click(btn('Select notes'));
    await click(row('Note A'));
    await clickWith(row('Note C'), { shiftKey: true });
    await click(btn('Move to Trash'));
    await waitFor(() => noteOptions().length === 1, 'notes left the list');
    expect(env.bridge.count('bulk.trash')).toBe(1);
    expect(toast()).toEqual(['Moved 3 notes to Trash.']);
    expect(b.model().selection.get().ids.size).toBe(0);
    expect(document.activeElement).toBe(btn('Done'));
    await click(btn('Undo delete'));
    await waitFor(() => noteOptions().length === 4, 'notes back');
    expect(env.bridge.count('bulk.untrash')).toBe(1);
    expect(toast()).toEqual(['Restored 3 notes.']);
    expect(await listCount()).toBe(4);
  });

  it('closes the open note when it is trashed with the selection', async () => {
    await click(row('Note B'));
    expect(b.model().store.get().openId).toBe(ids[1]);
    await click(btn('Select notes'));
    await click(row('Note B'));
    await click(btn('Move to Trash'));
    await waitFor(() => b.model().store.get().openId === null, 'editor closed');
  });

  it('Move to… moves them all in one call; Undo moves them back and reports the ones that changed meanwhile', async () => {
    const f = await env.bridge.rpc('folders.create', { name: 'Dest' });
    const folderId = (f.ok ? f.value : { id: '' }) as { id: string };
    await waitFor(() => /Dest/.test(document.body.textContent ?? ''), 'folder in tree');
    await click(btn('Select notes'));
    await click(row('Note A'));
    await click(row('Note B'));
    await click(btn('Move to…'));
    await waitFor(() => !!dialog(), 'dialog');
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Move 2 notes to…');
    await waitFor(() => [...dialog()!.querySelectorAll('option')].length === 2, 'folders loaded');
    await choose(dialog()!.querySelector('select')!, folderId.id);
    await click(btn('Move'));
    await waitFor(() => !dialog(), 'dialog closed');
    await waitFor(() => toast().length === 1, 'toast');
    expect(env.bridge.count('bulk.move')).toBe(1);
    expect(toast()[0]).toBe('Moved 2 notes to “Dest”.');
    expect(await folderOf(ids[0]!)).toBe(folderId.id);
    expect(await folderOf(ids[1]!)).toBe(folderId.id);
    await env.bridge.rpc('notes.trash', { id: ids[1] });
    await click(btn('Undo move'));
    await waitFor(() => toast().some((t) => /back/.test(t)), 'undo toast');
    expect(toast().at(-1)).toBe('Moved 1 note back. 1 skipped because they changed since.');
    expect(await folderOf(ids[0]!)).toBeNull();
    expect(env.bridge.calls.filter((c) => c.method === 'bulk.move').at(-1)!.args).toMatchObject({
      undo: true,
    });
  });

  it('Tag… and Untag… apply to the selection and Undo reverses exactly the notes that changed', async () => {
    const t = await env.bridge.rpc('tags.create', { name: 'work' });
    const tagId = (t.ok ? t.value : { id: '' }) as { id: string };
    const tagsOf = async (id: string) => {
      const r = await env.bridge.rpc('tags.forNote', { noteId: id });
      return r.ok ? (r.value as { id: string }[]).map((x) => x.id) : [];
    };
    await click(btn('Select notes'));
    await click(row('Note A'));
    await click(row('Note B'));
    await click(btn('Tag…'));
    await waitFor(() => !!dialog()?.querySelector('option'), 'tags loaded');
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Tag 2 notes');
    await click(btn('Tag'));
    await waitFor(() => toast().length === 1, 'toast');
    expect(toast()[0]).toBe('Tagged 2 notes with “work”.');
    expect(await tagsOf(ids[0]!)).toEqual([tagId.id]);
    await click(btn('Undo tag'));
    await waitFor(() => toast().some((m) => /Undone/.test(m)), 'undone');
    expect(await tagsOf(ids[0]!)).toEqual([]);
    expect(await tagsOf(ids[1]!)).toEqual([]);

    await env.bridge.rpc('bulk.tag', { ids: [ids[0]], tagId: tagId.id, on: true });
    await click(row('Note A'));
    await click(btn('Untag…'));
    await waitFor(() => !!dialog()?.querySelector('option'), 'tags loaded');
    await click(btn('Untag'));
    await waitFor(() => toast().some((m) => /Removed “work” from 1 note/.test(m)), 'untag toast');
    expect(await tagsOf(ids[0]!)).toEqual([]);
  });

  it('Tag… with no tags says so and offers no action', async () => {
    await click(btn('Select notes'));
    await click(row('Note A'));
    await click(btn('Tag…'));
    await waitFor(() => /no tags yet/.test(text()), 'empty tags');
    expect(btn('Tag')!.disabled).toBe(true);
    await click(btn('Cancel'));
    expect(dialog()).toBeNull();
    expect(env.bridge.count('bulk.tag')).toBe(0);
  });

  it('Export selection… starts bulk.export with exactly the selected ids; a cancelled dialog is reported', async () => {
    await click(btn('Select notes'));
    await click(row('Note A'));
    await click(btn('Export selection…'));
    await waitFor(() => toast().some((m) => /Export cancelled/.test(m)), 'cancel toast');
    expect(env.bridge.calls.find((c) => c.method === 'bulk.export')!.args).toEqual({
      ids: [ids[0]],
    });
    env.picks.exportDir = tmp();
    await click(btn('Export selection…'));
    await waitFor(
      () => toast().some((m) => /^Exported 1 note and 0 attachments/.test(m)),
      'finished toast',
    );
  });

  it('a failed bulk call is reported and nothing is selected away', async () => {
    await click(btn('Select notes'));
    await click(row('Note A'));
    env.bridge.inject('bulk.trash', { ok: false, error: { code: 'internal', message: 'db busy' } });
    await click(btn('Move to Trash'));
    await waitFor(() => toast().length === 1, 'toast');
    expect(toast()[0]).toBe('Couldn’t move to Trash: db busy');
    expect(b.model().selection.get().ids.size).toBe(1);
    expect(noteOptions()).toHaveLength(4);
  });

  it('selection follows the view: ids that leave the list are dropped', async () => {
    await click(btn('Select notes'));
    await click(btn('Select all in view'));
    await env.bridge.rpc('notes.trash', { id: ids[0] });
    await waitFor(() => noteOptions().length === 3, 'list refreshed');
    await waitFor(() => countText() === '3 notes selected', 'selection pruned');
  });
});
