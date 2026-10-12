import { useRef, useState } from 'react';
import { ApiError } from './api';

export interface Versioned<T> {
  value: T;
  updatedAt: string;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const MAX_REBASES = 5;

/**
 * Saves one field of a record without replacing a newer copy of it from another window.
 *
 * Every save carries the `updatedAt` this field's text was built on. When the server answers
 * "changed in another window", the field is compared with the copy it sent back: if this field is
 * the same there (another field, or this window's own earlier save, moved the record on), the save
 * is sent again from the new version; if it differs, nothing is sent and `conflict` holds the
 * other copy until `reload` or `keepMine` is called. Saves run one at a time.
 */
export function useGuardedSave<R, T>({
  record,
  read,
  send,
  message,
  same = sameJson,
}: {
  /** The record as it was when the field was loaded; only the first one is used. */
  record: R;
  read: (record: R) => Versioned<T>;
  send: (value: T, expectedUpdatedAt: string) => Promise<R>;
  /** What the failed save says, for a caller that shows save errors. */
  message: string;
  same?: (a: T, b: T) => boolean;
}) {
  const [first] = useState(() => read(record));
  const base = useRef(first);
  const waiting = useRef<Versioned<T> | null>(null);
  const [conflict, setConflict] = useState<T | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const attempt = async (value: T): Promise<void> => {
    if (waiting.current) throw new Error(message);
    for (let rebases = 0; ; rebases++) {
      if (same(value, base.current.value)) return;
      try {
        base.current = read(await send(value, base.current.updatedAt));
        return;
      } catch (e) {
        const current = e instanceof ApiError && e.code === 'conflict' ? e.details?.current : null;
        if (!current) throw e;
        const theirs = read(current as R);
        if (rebases < MAX_REBASES && same(theirs.value, base.current.value)) {
          base.current = { value: base.current.value, updatedAt: theirs.updatedAt };
          continue;
        }
        waiting.current = theirs;
        setConflict(theirs.value);
        throw new Error(message);
      }
    }
  };

  /** Queue a save; `latest` is read when its turn comes, so text typed meanwhile goes out too. */
  const save = (latest: () => T): Promise<void> => {
    const run = queue.current.then(() => attempt(latest()));
    queue.current = run.catch(() => undefined);
    return run;
  };

  /** Take the other copy: returns its value, and later saves build on it. */
  const reload = (): T | null => {
    const theirs = waiting.current;
    if (!theirs) return null;
    base.current = theirs;
    waiting.current = null;
    setConflict(null);
    return theirs.value;
  };

  /** Keep this window's text: the next save replaces the other copy. */
  const keepMine = (): void => {
    const theirs = waiting.current;
    if (!theirs) return;
    base.current = theirs;
    waiting.current = null;
    setConflict(null);
  };

  return { save, conflict, reload, keepMine };
}
