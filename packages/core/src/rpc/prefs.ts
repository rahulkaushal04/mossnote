import { getMeta, setMeta } from '../db/meta.ts';
import { ok, type Result } from '../result.ts';
import type { Store } from '../store/store.ts';
import { DEFAULT_PREFS, prefsSchema, type Prefs } from './contract.ts';

const KEY = 'ui_prefs';

/** Corrupt JSON or an out-of-range field falls back to that field's default. */
export function readPrefs(store: Pick<Store, 'db'>): Prefs {
  let raw: unknown;
  try {
    raw = JSON.parse(getMeta(store.db, KEY) ?? '{}');
  } catch {
    raw = {};
  }
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const f = prefsSchema.shape[k].safeParse(o[k]);
    if (f.success) out[k] = f.data;
  }
  return out as unknown as Prefs;
}

export function writePrefs(
  store: Pick<Store, 'mutate' | 'db'>,
  patch: Partial<Prefs>,
): Result<Prefs> {
  return store.mutate({}, (tx) => {
    const next = { ...readPrefs(store), ...patch };
    setMeta(tx.db, KEY, JSON.stringify(next));
    return ok(next);
  });
}
