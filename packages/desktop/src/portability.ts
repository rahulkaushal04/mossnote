/**
 * Main-process glue for the portability module (PT-6..PT-8, PT-11). Pure: Electron objects are injected so
 * everything here is tested with fakes. Paths picked here are absolute and never come from the renderer.
 */
import path from 'node:path';

/** One native dialog at a time, across every channel that opens one (a hostile page cannot stack them). */
export type DialogGate = <T>(busy: T, fn: () => Promise<T>) => Promise<T>;
export function createDialogGate(): DialogGate {
  let open = false;
  return async (busy, fn) => {
    if (open) return busy;
    open = true;
    try {
      return await fn();
    } finally {
      open = false;
    }
  };
}

export interface PickDialogs {
  open(o: {
    title: string;
    properties: ('openFile' | 'openDirectory' | 'createDirectory')[];
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  save(o: {
    title: string;
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

const BACKUP_FILTER = [{ name: 'Mossnote backup', extensions: ['mossbak'] }];
const okPath = (p: unknown): string | null =>
  typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.includes('\0') && path.isAbsolute(p) ? p : null;

/** The dispatcher options `pickExportDir` etc.: an absolute path, or null on cancel (or when a dialog is already open). */
export function createPickers(d: PickDialogs, gate: DialogGate = createDialogGate()) {
  const dir = (title: string) => () =>
    gate<string | null>(null, async () => {
      const r = await d.open({ title, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : okPath(r.filePaths[0]);
    });
  return {
    pickExportDir: dir('Choose a folder for the export'),
    pickImportDir: dir('Choose the folder to import'),
    pickBackupOpenPath: () =>
      gate<string | null>(null, async () => {
        const r = await d.open({ title: 'Choose a backup', properties: ['openFile'], filters: BACKUP_FILTER });
        return r.canceled ? null : okPath(r.filePaths[0]);
      }),
    pickBackupSavePath: (suggestedName: string) =>
      gate<string | null>(null, async () => {
        const r = await d.save({
          title: 'Save backup as',
          defaultPath: path.basename(String(suggestedName)) || 'Mossnote backup.mossbak',
          filters: BACKUP_FILTER,
        });
        return r.canceled ? null : okPath(r.filePath);
      }),
  };
}

/**
 * `restartForRestore`: relaunch is registered first, then a normal quit, so the flush handshake and the drain
 * run before exit and the new process applies the pending restore. Idempotent. Works in recovery mode too
 * (no workspace: the lifecycle still runs, the dispatcher has nothing to flush).
 */
export function createRestart(d: { relaunch(): void; quit(): void }): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    d.relaunch();
    d.quit();
  };
}

/** Warnings raised before the dispatcher exists (scheduler, restore notices) are queued, then delivered. */
export function createWarnSink() {
  const queue: string[] = [];
  let emit: ((message: string) => void) | undefined;
  return {
    warn(message: string): void {
      if (emit) emit(message);
      else queue.push(message);
    },
    bind(e: (message: string) => void): void {
      emit = e;
      for (const m of queue.splice(0)) e(m);
    },
  };
}

export interface StartupDeps {
  dbPath: string;
  apply(dbPath: string): { ok: true; value: { applied: boolean; discarded?: string } } | { ok: false; error: { message: string } };
  showError(title: string, message: string): void;
  warn(message: string): void;
}
/**
 * Runs BEFORE openWorkspace. false means: do not open the workspace (never a fresh one), the caller quits.
 * A discarded restore leaves live data untouched, so the app goes on and says why.
 */
export function runPendingRestore(d: StartupDeps): boolean {
  const r = d.apply(d.dbPath);
  if (!r.ok) {
    d.showError('Mossnote could not finish restoring your backup', `${r.error.message}\n\nYour notes were not opened. Mossnote will quit.`);
    return false;
  }
  if (r.value.discarded) d.warn(`The pending restore was not applied: ${r.value.discarded}`);
  return true;
}
