import { pickFreeJournalId } from '@shared/journalId';
import type { BackupInfo, JournalInfo } from '@shared/types';
import type { AppConfig } from '@server/app';
import {
  inspectJournal,
  knownMigrationsOf,
  schemaStateOf,
  unreadableInspection,
  type KnownMigrations,
} from '@server/db/inspect';
import { NEWER_JOURNAL_MESSAGE, NewerJournalError, type Migration } from '@server/db/migrations';
import { createDb } from '@server/db/orm';
import { integrityCheck, type Snapshot, type SnapshotStore } from '@server/db/snapshots';
import type { Clock, Sqlite } from '@server/db/types';
import { AppError, conflict, notFound, validationFailed } from '@server/errors';
import type { Journals } from '@server/journals/types';
import { createCtx, iso, type Ctx } from '@server/services/ctx';
import { renameJournal } from '@server/services/settings';
import type { Storage } from '@server/services/storage';
import type { Catalog } from './catalog';
import { journalFile, journalIdOfFile } from './names';
import { DamagedJournalError, openBrowserJournal, type OpenedJournal } from './open';
import type { FilePool } from './pool/types';

const newerApp = () => conflict(NEWER_JOURNAL_MESSAGE, { reason: 'needs_newer_app' });

const damaged = () =>
  conflict(
    'That journal is damaged, so it was not opened. Nothing was changed. Restore it from a snapshot in Settings.',
    { reason: 'damaged' },
  );

export interface BrowserJournalsOptions {
  pool: FilePool;
  catalog: Catalog;
  snapshots: SnapshotStore;
  /** Reads the open journal for {@link Storage}; set by the runtime once it exists. */
  storage: () => Storage;
  migrations: readonly Migration[];
  clock: Clock;
  /** Process-level settings; only the backup retention is read. */
  config: AppConfig;
}

/** The newest `updated_at` of any record, in milliseconds; 0 when there are none. */
const NEWEST_CHANGE_SQL = `
  SELECT max(m) AS newest FROM (
    SELECT max(updated_at) AS m FROM notes
    UNION ALL SELECT max(updated_at) FROM people
    UNION ALL SELECT max(updated_at) FROM plantings
    UNION ALL SELECT max(updated_at) FROM maps
    UNION ALL SELECT max(updated_at) FROM settings
  )`;

function newestChange(sqlite: Sqlite): number {
  try {
    const row = sqlite.prepare(NEWEST_CHANGE_SQL).get() as { newest: number | null } | undefined;
    return row?.newest ?? 0;
  } catch {
    return 0;
  }
}

function databaseBytes(sqlite: Sqlite): number {
  return (
    Number(sqlite.pragma('page_count', { simple: true })) *
    Number(sqlite.pragma('page_size', { simple: true }))
  );
}

/**
 * Owns which journal is open in browser storage: the browser runtime's counterpart of the
 * folder-based `JournalManager`, behind the same {@link Journals} interface. Journals are files
 * in the pool, one open at a time behind the context the routes share. Opening another goes
 * through the full startup sequence, and the previous journal stays open until the next one is
 * ready, so a journal that cannot be opened never leaves the app without one.
 */
export class BrowserJournals implements Journals {
  private current: OpenedJournal | null = null;
  private ctx: Ctx | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private readonly known: KnownMigrations;

  constructor(private readonly options: BrowserJournalsOptions) {
    this.known = knownMigrationsOf(options.migrations);
  }

  get activeId(): string | null {
    return this.current?.id ?? null;
  }

  /** The open journal's id and connection, for {@link Storage}. */
  get open(): { id: string; sqlite: Sqlite } | null {
    return this.current ? { id: this.current.id, sqlite: this.current.database.sqlite } : null;
  }

  bind(ctx: Ctx): void {
    this.ctx = ctx;
    if (this.current) this.attach(this.current);
  }

  private attach(journal: OpenedJournal): void {
    this.ctx?.attach({
      db: journal.database.db,
      sqlite: journal.database.sqlite,
      journal: journal.id,
      dbPath: journalFile(journal.id),
    });
  }

  /** Run one change at a time: switching, deleting and restoring never overlap. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }

  private configFor(id: string): AppConfig {
    return { ...this.options.config, journal: id, dbPath: journalFile(id) };
  }

  private openJournal(id: string, init?: { name: string; template: string }) {
    const { pool, clock, migrations, snapshots } = this.options;
    return openBrowserJournal({
      pool,
      id,
      clock,
      migrations,
      snapshots,
      config: this.configFor(id),
      ...(init ? { init } : {}),
    });
  }

  private ids(): string[] {
    return this.options.pool
      .names()
      .flatMap((file) => {
        const id = journalIdOfFile(file);
        return id === null ? [] : [id];
      })
      .sort();
  }

  // ---------------------------------------------------------------------------------------------
  // Start and stop
  // ---------------------------------------------------------------------------------------------

  /**
   * Open the journal to start with: the one used last, else the most recently changed. A first
   * run (no journals) opens none; the web app asks which template to use and creates it. A
   * journal that cannot be opened is skipped for the next, and only when none can be opened is
   * the first problem raised.
   */
  async start(): Promise<void> {
    await this.exclusive(async () => {
      const ids = this.ids();
      const saved = this.options.catalog.activeJournal();
      const order = [
        ...(saved !== null && ids.includes(saved) ? [saved] : []),
        ...this.byRecentChange(ids.filter((id) => id !== saved)),
      ];
      let firstError: unknown;
      for (const id of order) {
        try {
          this.current = await this.openJournal(id);
          return;
        } catch (error) {
          if (!(error instanceof NewerJournalError) && !(error instanceof DamagedJournalError)) {
            throw error;
          }
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

  /** Run `use` on a journal's connection: the open one, or a short-lived one for the others. */
  private withConnection<T>(id: string, use: (sqlite: Sqlite) => T): T {
    if (this.current?.id === id) return use(this.current.database.sqlite);
    const sqlite = this.options.pool.open(journalFile(id));
    try {
      return use(sqlite);
    } finally {
      sqlite.close();
    }
  }

  private byRecentChange(ids: string[]): string[] {
    const changed = new Map(ids.map((id) => [id, this.withConnection(id, newestChange)] as const));
    return [...ids].sort((a, b) => (changed.get(b) ?? 0) - (changed.get(a) ?? 0));
  }

  private infoFor(id: string): JournalInfo {
    const found = (() => {
      try {
        return this.withConnection(id, (sqlite) => ({
          inspection: inspectJournal(sqlite, id, this.known),
          bytes: databaseBytes(sqlite),
          changedAt: newestChange(sqlite),
        }));
      } catch {
        return { inspection: unreadableInspection(id), bytes: 0, changedAt: 0 };
      }
    })();
    const { inspection } = found;
    return {
      id,
      name: inspection.name,
      template: inspection.template,
      active: id === this.activeId,
      status: inspection.unreadable
        ? 'unreadable'
        : inspection.schema === 'newer'
          ? 'needs_newer_app'
          : 'ok',
      bytes: found.bytes,
      createdAt: inspection.createdAt === null ? null : iso(inspection.createdAt),
      modifiedAt: iso(found.changedAt > 0 ? found.changedAt : (inspection.createdAt ?? 0)),
      counts: inspection.counts,
      backups: this.options.snapshots.list(id).length,
    };
  }

  list(): JournalInfo[] {
    return this.ids()
      .map((id) => this.infoFor(id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  get(id: string): JournalInfo {
    if (!this.ids().includes(id)) throw notFound("That journal doesn't exist.");
    return this.infoFor(id);
  }

  // ---------------------------------------------------------------------------------------------
  // Create and switch
  // ---------------------------------------------------------------------------------------------

  create(input: { name: string; template: string }): Promise<JournalInfo> {
    return this.exclusive(async () => {
      const { pool, snapshots, catalog } = this.options;
      const taken = new Set(this.ids());
      const id = pickFreeJournalId(
        input.name,
        // An id that already has snapshots (from a deleted journal) would adopt them.
        (candidate) => !taken.has(candidate) && snapshots.list(candidate).length === 0,
      );
      let next: OpenedJournal;
      try {
        next = await this.openJournal(id, input);
      } catch (error) {
        pool.remove(journalFile(id));
        throw error;
      }
      this.swapTo(next);
      catalog.setActiveJournal(id);
      return this.infoFor(id);
    });
  }

  activate(id: string): Promise<JournalInfo> {
    return this.exclusive(async () => {
      if (!this.ids().includes(id)) throw notFound("That journal doesn't exist.");
      if (id === this.activeId) return this.infoFor(id);
      const next = await this.openForApi(id);
      this.swapTo(next);
      this.options.catalog.setActiveJournal(id);
      return this.infoFor(id);
    });
  }

  /** Open a journal for a request, turning startup failures into plain API errors. */
  private async openForApi(id: string): Promise<OpenedJournal> {
    try {
      return await this.openJournal(id);
    } catch (error) {
      if (error instanceof NewerJournalError) throw newerApp();
      if (error instanceof DamagedJournalError) throw damaged();
      throw error;
    }
  }

  private swapTo(next: OpenedJournal): void {
    const previous = this.current;
    this.current = next;
    this.attach(next);
    previous?.close();
  }

  // ---------------------------------------------------------------------------------------------
  // Rename and delete
  // ---------------------------------------------------------------------------------------------

  rename(id: string, name: string): Promise<JournalInfo> {
    return this.exclusive(() => {
      this.get(id);
      const { clock } = this.options;
      if (this.current?.id === id) {
        renameJournal(this.current.database, name, clock);
      } else {
        this.refuseNewer(id);
        this.withConnection(id, (sqlite) => {
          renameJournal({ sqlite, db: createDb(sqlite) }, name, clock);
        });
      }
      return Promise.resolve(this.infoFor(id));
    });
  }

  private refuseNewer(id: string): void {
    const state = this.withConnection(id, (sqlite) => schemaStateOf(sqlite, this.known));
    if (state === 'newer') throw newerApp();
  }

  /**
   * Delete a journal after its name was typed back. A final snapshot can be kept first; it is
   * never removed with the journal. When the open journal is deleted the most recently changed
   * other journal opens, or none when it was the last one.
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
      const { pool, snapshots, catalog, clock, config } = this.options;
      const wasActive = this.current?.id === id;

      let snapshot: string | null = null;
      if (input.finalSnapshot) {
        const sqlite = wasActive && this.current ? this.current.database.sqlite : null;
        const made = sqlite
          ? await snapshots.create({
              sqlite,
              journal: id,
              reason: 'manual',
              clock,
              autoKeep: config.backupKeep,
            })
          : await this.snapshotClosed(id);
        snapshot = made.name;
      }

      if (wasActive) {
        this.current?.close();
        this.current = null;
        this.ctx?.detach();
      }
      pool.remove(journalFile(id));

      if (wasActive) {
        catalog.setActiveJournal(null);
        await this.openFallback();
      }
      return { active: this.activeId, snapshot };
    });
  }

  private async snapshotClosed(id: string): Promise<Snapshot> {
    const { pool, snapshots, clock, config } = this.options;
    const sqlite = pool.open(journalFile(id));
    try {
      return await snapshots.create({
        sqlite,
        journal: id,
        reason: 'manual',
        clock,
        autoKeep: config.backupKeep,
      });
    } finally {
      sqlite.close();
    }
  }

  /** After the open journal went away, open the most recently changed one that can be opened. */
  private async openFallback(): Promise<void> {
    for (const id of this.byRecentChange(this.ids())) {
      try {
        const next = await this.openJournal(id);
        this.current = next;
        this.attach(next);
        this.options.catalog.setActiveJournal(id);
        return;
      } catch (error) {
        if (!(error instanceof NewerJournalError) && !(error instanceof DamagedJournalError)) {
          throw error;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Export and restore
  // ---------------------------------------------------------------------------------------------

  /**
   * Run `build` against any journal, to export it: the open journal through the live context,
   * another one through a short-lived connection. Only a journal already at this build's schema
   * is read; one from an older version is brought up to date by opening it, not by exporting it.
   */
  exportFrom<T>(id: string, build: (ctx: Ctx) => T): Promise<T> {
    return this.exclusive(() => {
      this.get(id);
      if (this.current?.id === id && this.ctx) return Promise.resolve(build(this.ctx));
      const { clock, storage } = this.options;
      return Promise.resolve(
        this.withConnection(id, (sqlite) => {
          const state = schemaStateOf(sqlite, this.known);
          if (state === 'newer') throw newerApp();
          if (state !== 'current') {
            throw conflict(
              'Open that journal once so Mossnote can bring it up to date, then export it.',
              { reason: 'needs_upgrade' },
            );
          }
          return build(
            createCtx({
              db: createDb(sqlite),
              sqlite,
              clock,
              config: this.configFor(id),
              storage: storage(),
            }),
          );
        }),
      );
    });
  }

  /**
   * Put a snapshot back as the open journal. The snapshot is checked first, the journal as it is
   * now is saved as a `pre-restore` snapshot, and only then is it replaced. A snapshot from an
   * older version is migrated forward as usual when the journal reopens; if reopening fails the
   * journal is put back as it was.
   */
  restoreSnapshot(name: string): Promise<{ restored: BackupInfo; safety: BackupInfo }> {
    return this.exclusive(async () => {
      const journal = this.current;
      if (!journal) throw conflict('No journal is open.', { reason: 'no_journal' });
      const { pool, snapshots, clock, config } = this.options;

      const snapshot = snapshots.list(journal.id).find((s) => s.name === name);
      if (!snapshot) throw notFound("That snapshot doesn't exist.");
      this.assertRestorable(snapshot);

      const safety = await snapshots.create({
        sqlite: journal.database.sqlite,
        journal: journal.id,
        reason: 'pre-restore',
        clock,
        autoKeep: config.backupKeep,
      });

      const file = journalFile(journal.id);
      journal.close();
      this.current = null;
      this.ctx?.detach();
      try {
        await pool.write(file, pool.read(snapshot.path));
        this.current = await this.openJournal(journal.id);
      } catch (error) {
        await pool.write(file, pool.read(safety.path));
        this.current = await this.openJournal(journal.id);
        throw error instanceof AppError
          ? error
          : conflict("That snapshot couldn't be restored. Your journal is as it was.", {
              reason: 'restore_failed',
            });
      } finally {
        if (this.current) this.attach(this.current);
      }
      return { restored: toBackupInfo(snapshot), safety: toBackupInfo(safety) };
    });
  }

  /** Refuse a snapshot from a newer build or one that fails `integrity_check`. */
  private assertRestorable(snapshot: Snapshot): void {
    const { pool } = this.options;
    let sound: boolean;
    try {
      const sqlite = pool.open(snapshot.path);
      try {
        if (schemaStateOf(sqlite, this.known) === 'newer') throw newerApp();
        sound = integrityCheck(sqlite).length === 0;
      } finally {
        sqlite.close();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      sound = false;
    }
    if (!sound) {
      throw conflict("That snapshot is damaged, so it can't be restored. Nothing was changed.", {
        reason: 'damaged',
      });
    }
  }
}

const toBackupInfo = (s: Snapshot): BackupInfo => ({
  name: s.name,
  reason: s.reason,
  size: s.size,
  takenAt: iso(s.takenAt),
});
