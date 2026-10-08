import fs from 'node:fs';
import path from 'node:path';
import { JOURNAL_PATTERN, LEGACY_JOURNAL_ID } from '@shared/journalId';
import { DEFAULT_TEMPLATE_ID } from '@shared/templates';
import type { BackupInfo, JournalInfo } from '@shared/types';
import { IntegrityError, openJournal, type Journal } from '../boot';
import type { Config } from '../config';
import { ensureDataDir } from '../dataDir';
import { createSnapshot, listSnapshots, type Clock } from '../db/backup';
import { inspectJournalFile, journalIds, knownMigrations } from '../db/catalog';
import type { Sqlite } from '../db/client';
import { NewerJournalError } from '../db/migrate';
import { conflict, notFound, validationFailed } from '../errors';
import type { Logger } from '../logger';
import { iso, type Ctx } from '../services/ctx';
import { renameJournal } from '../services/settings';
import {
  lockedHandle,
  newerApp,
  readClosedJournal,
  withClosedJournal,
  type ClosedEnv,
} from './closed';
import { freeJournalId } from './ids';
import { journalPaths } from './paths';
import { restoreSnapshot } from './restore';
import type { Journals } from './types';

const ACTIVE_FILE = 'active-journal';

export interface ManagerOptions {
  /** Process-level settings; the per-journal paths in it are only the starting preference. */
  config: Config;
  clock: Clock;
  logger: Logger;
  migrationsFolder: string;
  /** Process id written to lock files. Tests pass another one to simulate a second process. */
  pid?: number;
}

/**
 * Owns which journal is open. Journals sit side by side in the data folder, one `<id>.db` each;
 * exactly one is open at a time, behind the same `Ctx` the routes already use. Opening another
 * goes through the full startup sequence (lock, integrity check, migration with its snapshot),
 * and the previous journal stays open until the next one is ready, so a journal that cannot be
 * opened never leaves the app without one.
 */
export class JournalManager implements Journals {
  private current: Journal | null = null;
  private ctx: Ctx | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ManagerOptions) {}

  private get config(): Config {
    return this.options.config;
  }

  get activeId(): string | null {
    return this.current?.id ?? null;
  }

  /** Connect the manager to the context the routes use. Attaches the open journal, if any. */
  bind(ctx: Ctx): void {
    this.ctx = ctx;
    if (this.current) this.attach(this.current);
  }

  private attach(journal: Journal): void {
    this.ctx?.attach({
      db: journal.database.db,
      sqlite: journal.database.sqlite,
      journal: journal.id,
      dbPath: journalPaths(this.config.dataDir, journal.id).dbPath,
    });
  }

  /** Run one change at a time: switching, deleting and restoring never overlap. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }

  private configFor(id: string): Config {
    return { ...this.config, ...journalPaths(this.config.dataDir, id) };
  }

  private closedEnv(): ClosedEnv {
    const { clock, migrationsFolder, pid } = this.options;
    return { config: this.config, clock, migrationsFolder, pid };
  }

  private open(id: string, init?: { name: string; template: string }): Promise<Journal> {
    const { clock, logger, migrationsFolder, pid } = this.options;
    return openJournal({
      config: this.configFor(id),
      clock,
      logger,
      migrationsFolder,
      ...(pid === undefined ? {} : { pid }),
      ...(init ? { init } : {}),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Start and stop
  // ---------------------------------------------------------------------------------------------

  /** The journals to try at start, best first: the named one, the last used, the legacy one, the rest. */
  private startOrder(): string[] {
    const ids = journalIds(this.config.dataDir);
    const order: string[] = [];
    const add = (id: string | null | undefined) => {
      if (id && ids.includes(id) && !order.includes(id)) order.push(id);
    };
    if (this.config.journalExplicit) add(this.config.journal);
    add(this.savedActive());
    add(LEGACY_JOURNAL_ID);
    const recent = [...ids].sort((a, b) => this.modifiedMs(b) - this.modifiedMs(a));
    for (const id of recent) add(id);
    return order;
  }

  /**
   * Open the journal to start with. A first run (no journal files, no `MOSS_JOURNAL`) opens none:
   * the web app asks which template to use and creates it. A journal that cannot be opened is
   * skipped for the next one, and only when none can be opened is the first problem raised.
   */
  async start(): Promise<void> {
    await this.exclusive(async () => {
      ensureDataDir(this.config);
      const ids = journalIds(this.config.dataDir);
      if (this.config.journalExplicit && !ids.includes(this.config.journal)) {
        this.current = await this.open(this.config.journal, {
          name: this.config.journal,
          template: DEFAULT_TEMPLATE_ID,
        });
        return;
      }
      let firstError: unknown;
      for (const id of this.startOrder()) {
        try {
          this.current = await this.open(id);
          return;
        } catch (error) {
          if (!(error instanceof NewerJournalError) && !(error instanceof IntegrityError)) {
            throw error;
          }
          this.options.logger.warn('skipped a journal that cannot be opened', { journal: id });
          firstError ??= error;
        }
      }
      if (firstError instanceof Error) throw firstError;
    });
  }

  close(): void {
    this.current?.close();
    this.current = null;
    this.ctx?.detach();
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  private savedActive(): string | null {
    try {
      const id = fs.readFileSync(path.join(this.config.dataDir, ACTIVE_FILE), 'utf8').trim();
      return JOURNAL_PATTERN.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  private saveActive(id: string | null): void {
    const file = path.join(this.config.dataDir, ACTIVE_FILE);
    if (id === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
  }

  private modifiedMs(id: string): number {
    const { dbPath } = journalPaths(this.config.dataDir, id);
    let latest = 0;
    for (const file of [dbPath, `${dbPath}-wal`]) {
      try {
        latest = Math.max(latest, fs.statSync(file).mtimeMs);
      } catch {
        // No such file.
      }
    }
    return latest;
  }

  private infoFor(id: string): JournalInfo {
    const { dbPath } = journalPaths(this.config.dataDir, id);
    const found = inspectJournalFile(dbPath, id, knownMigrations(this.options.migrationsFolder));
    let bytes = 0;
    try {
      bytes = fs.statSync(dbPath).size;
    } catch {
      // Removed while listing.
    }
    return {
      id,
      name: found.name,
      template: found.template,
      active: id === this.activeId,
      status: found.unreadable ? 'unreadable' : found.schema === 'newer' ? 'needs_newer_app' : 'ok',
      bytes,
      createdAt: found.createdAt === null ? null : iso(found.createdAt),
      modifiedAt: iso(this.modifiedMs(id)),
      counts: found.counts,
      backups: listSnapshots(this.config.backupsDir, id).length,
    };
  }

  /** Every journal file in the data folder, by name. Works without any journal being open. */
  list(): JournalInfo[] {
    return journalIds(this.config.dataDir)
      .map((id) => this.infoFor(id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** The facts about one journal, or a 404. */
  get(id: string): JournalInfo {
    if (!journalIds(this.config.dataDir).includes(id))
      throw notFound("That journal doesn't exist.");
    return this.infoFor(id);
  }

  // ---------------------------------------------------------------------------------------------
  // Create and switch
  // ---------------------------------------------------------------------------------------------

  /** Make a journal from a template and switch to it. */
  create(input: { name: string; template: string }): Promise<JournalInfo> {
    return this.exclusive(async () => {
      const id = freeJournalId(this.config, input.name);
      const next = await this.open(id, { name: input.name, template: input.template });
      this.swapTo(next);
      return this.infoFor(id);
    });
  }

  /** Switch to another journal. The current one stays open if the other cannot be opened. */
  activate(id: string): Promise<JournalInfo> {
    return this.exclusive(async () => {
      if (!journalIds(this.config.dataDir).includes(id)) {
        throw notFound("That journal doesn't exist.");
      }
      if (id === this.activeId) return this.infoFor(id);
      const next = await this.openForApi(id);
      this.swapTo(next);
      return this.infoFor(id);
    });
  }

  /** Open a journal for a request, turning startup failures into plain API errors. */
  private async openForApi(id: string): Promise<Journal> {
    try {
      return await this.open(id);
    } catch (error) {
      if (error instanceof NewerJournalError) throw newerApp();
      if (error instanceof IntegrityError) {
        throw conflict(
          'That journal is damaged, so it was not opened. Nothing was changed. Restore it from a snapshot in the backups folder.',
          { reason: 'damaged' },
        );
      }
      throw error;
    }
  }

  private swapTo(next: Journal): void {
    const previous = this.current;
    this.current = next;
    this.attach(next);
    previous?.close();
    this.saveActive(next.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Rename and delete
  // ---------------------------------------------------------------------------------------------

  rename(id: string, name: string): Promise<JournalInfo> {
    return this.exclusive(() => {
      this.get(id);
      if (this.current?.id === id) {
        renameJournal(this.current.database, name, this.options.clock);
      } else {
        withClosedJournal(this.closedEnv(), id, (database) => {
          renameJournal(database, name, this.options.clock);
        });
      }
      return Promise.resolve(this.infoFor(id));
    });
  }

  /**
   * Delete a journal after its name was typed back. A final snapshot can be kept in the backups
   * folder first; it is never removed with the journal. When the open journal is deleted the most
   * recently used other journal opens, or none when it was the last one.
   */
  remove(
    id: string,
    input: { confirmName: string; finalSnapshot: boolean },
  ): Promise<{ active: string | null; snapshot: string | null }> {
    return this.exclusive(async () => {
      const info = this.get(id);
      if (input.confirmName.trim() !== info.name) {
        throw validationFailed("Type the journal's name exactly to delete it.", {
          confirmName: "That doesn't match the journal's name.",
        });
      }
      const { clock, config } = { clock: this.options.clock, config: this.config };
      const makeSnapshot = (sqlite: Sqlite) =>
        createSnapshot({
          sqlite,
          backupsDir: config.backupsDir,
          journal: id,
          reason: 'manual',
          clock,
          autoKeep: config.backupKeep,
        });

      let snapshot: string | null = null;
      const wasActive = this.current?.id === id;
      if (input.finalSnapshot) {
        if (this.current && wasActive) {
          snapshot = (await makeSnapshot(this.current.database.sqlite)).name;
        } else {
          const handle = lockedHandle(this.closedEnv(), id);
          try {
            snapshot = (await makeSnapshot(handle.sqlite)).name;
          } finally {
            handle.release();
          }
        }
      }

      if (wasActive) {
        this.current?.close();
        this.current = null;
        this.ctx?.detach();
      } else {
        // Make sure nothing else has it open before the files go.
        lockedHandle(this.closedEnv(), id).release();
      }
      const { dbPath, lockPath } = journalPaths(config.dataDir, id);
      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, lockPath]) {
        fs.rmSync(file, { force: true });
      }

      if (wasActive) {
        this.saveActive(null);
        await this.openFallback();
      }
      return { active: this.activeId, snapshot };
    });
  }

  /** After the open journal went away, open the most recently used one that can be opened. */
  private async openFallback(): Promise<void> {
    const candidates = journalIds(this.config.dataDir).sort(
      (a, b) => this.modifiedMs(b) - this.modifiedMs(a),
    );
    for (const id of candidates) {
      try {
        const next = await this.open(id);
        this.current = next;
        this.attach(next);
        this.saveActive(id);
        return;
      } catch (error) {
        if (!(error instanceof NewerJournalError) && !(error instanceof IntegrityError))
          throw error;
      }
    }
  }

  /**
   * Run `build` against any journal, to export it: the open journal through the live context,
   * another one read-only (see `readClosedJournal`).
   */
  exportFrom<T>(id: string, build: (ctx: Ctx) => T): Promise<T> {
    return this.exclusive(() => {
      this.get(id);
      if (this.current?.id === id && this.ctx) return Promise.resolve(build(this.ctx));
      return Promise.resolve(readClosedJournal(this.closedEnv(), id, build));
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Snapshots of the open journal
  // ---------------------------------------------------------------------------------------------

  /** Put a snapshot back as the open journal; see `restoreSnapshot` for the safeguards. */
  restoreSnapshot(name: string): Promise<{ restored: BackupInfo; safety: BackupInfo }> {
    return this.exclusive(async () => {
      const journal = this.current;
      if (!journal) throw conflict('No journal is open.', { reason: 'no_journal' });
      return restoreSnapshot(
        {
          config: this.config,
          clock: this.options.clock,
          migrationsFolder: this.options.migrationsFolder,
          journal: { id: journal.id, sqlite: journal.database.sqlite },
          release: () => {
            journal.close();
            this.current = null;
            this.ctx?.detach();
          },
          reopen: async () => {
            this.current = await this.open(journal.id);
            this.attach(this.current);
          },
        },
        name,
      );
    });
  }
}
