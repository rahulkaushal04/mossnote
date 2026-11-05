import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatcher, openWorkspace, type Dispatcher, type Workspace } from '@mossnote/core';
import { createLoopback, type Loopback } from './loopback';

/** What the main-process dialogs answer (absolute path, or null = the user cancelled). Mutate between steps. */
export interface Picks {
  exportDir: string | null;
  importDir: string | null;
  save: string | null;
  open: string | null;
}

export interface Env {
  picks: Picks;
  /** Names the dialogs were asked for, in order ("export", "import", "save:<name>", "open"). */
  asked: string[];
  /** How many times the restore asked the desktop to relaunch. */
  restarts: number[];
  dir: string;
  ws: Workspace;
  dispatcher: Dispatcher;
  bridge: Loopback;
  /** Flush + close, then reopen the same directory: a simulated app restart. */
  /** Writes a file as the main process would after a picker/drop and returns its upload token. */
  upload(name: string, content: Uint8Array | string): string;
  restart(): Env;
  cleanup(): void;
}

/** A REAL temp-dir workspace behind the real dispatcher and the structuredClone loopback. */
export function makeEnv(dir = mkdtempSync(join(tmpdir(), 'mossnote-ui-'))): Env {
  // Cheap scrypt and tiny chunks so encrypted backups stay fast in tests.
  const r = openWorkspace(join(dir, 'w.db'), {
    portability: { crypto: { logN: 14, chunkSize: 1024 } },
  });
  if (!r.ok) throw new Error(r.error.message);
  const uploads = new Map<string, string>();
  const picks: Picks = { exportDir: null, importDir: null, save: null, open: null };
  const asked: string[] = [];
  const restarts: number[] = [];
  const dispatcher = createDispatcher(r, {
    platform: 'test',
    dbPath: join(dir, 'w.db'),
    pickExportDir: async () => (asked.push('export'), picks.exportDir),
    pickImportDir: async () => (asked.push('import'), picks.importDir),
    pickBackupSavePath: async (name) => (asked.push(`save:${name}`), picks.save),
    pickBackupOpenPath: async () => (asked.push('open'), picks.open),
    restartForRestore: () => void restarts.push(1),
    resolveUploadPath: (t) => uploads.get(t),
  });
  const env: Env = {
    picks,
    asked,
    restarts,
    dir,
    ws: r.value,
    dispatcher,
    bridge: createLoopback(dispatcher),
    upload(name, content) {
      // One folder per upload so the file keeps exactly the requested base name.
      const sub = join(dir, 'uploads', String(uploads.size));
      mkdirSync(sub, { recursive: true });
      const p = join(sub, name.replace(/[\\/\0]/g, '_'));
      writeFileSync(p, content);
      const token = `tok-${uploads.size}`;
      uploads.set(token, p);
      return token;
    },
    restart() {
      const c = dispatcher.close();
      if (!c.ok) throw new Error(c.error.message);
      return makeEnv(dir);
    },
    cleanup() {
      dispatcher.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return env;
}
