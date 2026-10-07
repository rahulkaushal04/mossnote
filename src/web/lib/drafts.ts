import { useCallback, useEffect, useRef, useState } from 'react';
import { readStorage, writeStorage } from './storage';

/** Storage key for an unsaved draft: `moss:draft:<scope>`. */
export const draftKey = (scope: string): string => `moss:draft:${scope}`;

export function readDraft<T>(scope: string, valid: (value: unknown) => value is T): T | null {
  const raw = readStorage(draftKey(scope));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function removeDraft(scope: string): void {
  try {
    localStorage.removeItem(draftKey(scope));
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

/** True when `localStorage` can be written (false in some private windows). */
export function draftsAvailable(): boolean {
  return writeStorage('moss:probe', '1');
}

const DEBOUNCE_MS = 300;

/**
 * Draft state that survives a refresh or crash: restored on load, written 300 ms after the last
 * change, and cleared on a successful save. Scope is `home`, `day:<key>` or `quick`.
 */
export function useDraft<T>(
  scope: string,
  empty: () => T,
  valid: (value: unknown) => value is T,
  isEmpty: (value: T) => boolean,
  /** Applied to the starting draft, for example to add a preset link chip. */
  adjust: (value: T) => T = (value) => value,
) {
  const [draft, setDraftState] = useState<T>(() => adjust(readDraft(scope, valid) ?? empty()));
  const [storageOk, setStorageOk] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(draft);

  const flush = useCallback(
    (value: T) => {
      if (isEmpty(value)) {
        removeDraft(scope);
        return;
      }
      if (!writeStorage(draftKey(scope), JSON.stringify(value))) setStorageOk(false);
    },
    [scope, isEmpty],
  );

  const setDraft = useCallback(
    (value: T) => {
      latest.current = value;
      setDraftState(value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        flush(value);
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /** Clear after a successful save. */
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const fresh = empty();
    latest.current = fresh;
    setDraftState(fresh);
    removeDraft(scope);
  }, [scope, empty]);

  /**
   * A save started: write `value` to storage now and empty the composer, but leave the stored
   * draft in place. Only `settle` removes it, once the save succeeded, so a failure, an outage or
   * a reload in between can never lose the text.
   */
  const beginSave = useCallback(
    (value: T) => {
      clearTimeout(timer.current);
      timer.current = undefined;
      writeStorage(draftKey(scope), JSON.stringify(value));
      const fresh = empty();
      latest.current = fresh;
      setDraftState(fresh);
    },
    [scope, empty],
  );

  /** The save succeeded: drop the stored draft, unless the user has since typed something new. */
  const settle = useCallback(() => {
    if (isEmpty(latest.current)) removeDraft(scope);
  }, [scope, isEmpty]);

  // Write any pending change when leaving, so a quick refresh never loses typed text.
  useEffect(() => {
    const save = () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
        flush(latest.current);
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [flush]);

  return { draft, setDraft, clear, beginSave, settle, storageOk };
}
