import { z } from 'zod';
import { getMeta, setMeta } from '../db/meta.ts';
import { err, ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { parse, safe } from '../trash/derive.ts';
import { specSchema, storedSpecSchema, type SearchSpec } from './params.ts';

/** Saved searches are local settings (like ui_prefs): JSON in meta, no change-log rows. */
const KEY = 'saved_searches';
const BACKUP_KEY = 'saved_searches_damaged';
export const MAX_SAVED = 100;

export interface SavedSearch {
  id: string;
  name: string;
  spec: SearchSpec;
  createdAt: number;
  updatedAt: number;
}

const entrySchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    spec: storedSpecSchema, // lenient on read: unknown keys are kept, never hide the entry
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .loose();
const nameSchema = z.string().trim().min(1).max(80);
const idSchema = z.string().min(1).max(64);

const DAMAGED = 'Saved searches could not be read. Reset them to continue.';

export function createSavedSearches(store: Store) {
  /** Entries that do not parse (e.g. written by a newer version) stay in the array untouched. */
  const read = (): Result<unknown[]> => {
    const raw = getMeta(store.db, KEY);
    if (raw === undefined) return ok([]);
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return ok(v);
    } catch {
      /* damaged: reported below, the raw value is left alone */
    }
    return err('corrupt', DAMAGED);
  };
  const valid = (all: unknown[]): SavedSearch[] =>
    all.flatMap((e) => {
      const p = entrySchema.safeParse(e);
      return p.success ? [p.data] : [];
    });
  const idOf = (e: unknown): unknown => (e as { id?: unknown } | null)?.id;

  const edit = <T>(fn: (all: unknown[], now: number, ulid: () => string) => Result<T>) =>
    store.mutate({}, (tx) => {
      const cur = read();
      if (!cur.ok) return cur;
      const all = [...cur.value];
      const r = fn(all, tx.now, tx.ulid);
      if (r.ok) setMeta(tx.db, KEY, JSON.stringify(all));
      return r;
    });

  return {
    list: (): Result<SavedSearch[]> =>
      safe(() => {
        const r = read();
        return r.ok ? ok(valid(r.value)) : r;
      }),

    create(name: string, spec: unknown): Result<SavedSearch> {
      const n = parse(nameSchema, name);
      if (!n.ok) return n;
      const s = parse(specSchema, spec);
      if (!s.ok) return s;
      return edit((all, now, ulid) => {
        if (all.length >= MAX_SAVED)
          return err('validation', `At most ${MAX_SAVED} saved searches.`);
        const e: SavedSearch = {
          id: ulid(),
          name: n.value,
          spec: s.value,
          createdAt: now,
          updatedAt: now,
        };
        all.push(e);
        return ok(e);
      });
    },

    rename(id: string, name: string): Result<SavedSearch> {
      const i = parse(idSchema, id);
      if (!i.ok) return i;
      const n = parse(nameSchema, name);
      if (!n.ok) return n;
      return edit((all, now) => {
        const at = all.findIndex((e) => idOf(e) === id && entrySchema.safeParse(e).success);
        if (at < 0) return err('not_found', 'saved search not found');
        const e = { ...(all[at] as SavedSearch), name: n.value, updatedAt: now };
        all[at] = e;
        return ok(e);
      });
    },

    delete(id: string): Result<void> {
      const i = parse(idSchema, id);
      if (!i.ok) return i;
      return edit((all) => {
        const at = all.findIndex((e) => idOf(e) === id && entrySchema.safeParse(e).success);
        if (at < 0) return err('not_found', 'saved search not found');
        all.splice(at, 1);
        return ok(undefined);
      });
    },

    /** Explicit recovery from a damaged value: the raw text is kept under another key, the list restarts empty. */
    reset(): Result<void> {
      return store.mutate({}, (tx) => {
        const raw = getMeta(tx.db, KEY);
        if (raw !== undefined) setMeta(tx.db, BACKUP_KEY, raw);
        setMeta(tx.db, KEY, '[]');
        return ok(undefined);
      });
    },
  };
}
