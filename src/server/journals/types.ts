import type { BackupInfo, JournalInfo } from '@shared/types';
import type { Ctx } from '../services/ctx';

/**
 * What the routes need from whatever owns the journals. `JournalManager` implements it over the
 * data folder; the browser runtime implements it over the browser's storage. At most one journal
 * is open at a time, behind the {@link Ctx} the routes share.
 */
export interface Journals {
  /** The id of the open journal, or null before the first one is made. */
  readonly activeId: string | null;
  /** Connect to the context the routes use, and attach the open journal to it. */
  bind(ctx: Ctx): void;
  list(): JournalInfo[];
  /** The facts about one journal, or a 404. */
  get(id: string): JournalInfo;
  /** Make a journal from a template and switch to it. */
  create(input: { name: string; template: string }): Promise<JournalInfo>;
  activate(id: string): Promise<JournalInfo>;
  rename(id: string, name: string): Promise<JournalInfo>;
  remove(
    id: string,
    input: { confirmName: string; finalSnapshot: boolean },
  ): Promise<{ active: string | null; snapshot: string | null }>;
  /** Run `build` against any journal, to export it. */
  exportFrom<T>(id: string, build: (ctx: Ctx) => T): Promise<T>;
  /** Put one of the open journal's snapshots back as the journal. */
  restoreSnapshot(name: string): Promise<{ restored: BackupInfo; safety: BackupInfo }>;
}
