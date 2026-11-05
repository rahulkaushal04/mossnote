import type { ErrorCode, RpcResult, SaveReply } from '@mossnote/core/rpc';

/**
 * The save machine for one open note. Pure: timers and the RPC calls are injected.
 *
 * Data-safety rules (decisions C1/C2):
 * - changes journal the latest text with `drafts.write`, throttled (leading + trailing, 100 ms; it
 *   cannot starve) and read at send time, so a keystroke copies nothing; core coalesces 300/800 ms;
 * - the save body is read through `getText()` at send time, never from a queued copy;
 * - one save in flight; typing during it re-journals the text with the NEW base when the reply lands;
 * - a conflict or trashed error blocks further saves; the text stays in the journal, nothing is discarded.
 */
export type SaveState =
  | { kind: 'saved' }
  /** Typed, not yet sent: the save timer is pending. */
  | { kind: 'dirty' }
  /** A save request is in flight. */
  | { kind: 'saving' }
  | { kind: 'error'; code: ErrorCode; message: string };

export interface Base {
  rev: number;
  contentHash: string;
}
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
export interface AutosaveOptions {
  noteId: string;
  base: Base;
  /** The text that equals the saved note (the editor's initial text). */
  initialText: string;
  getText(): string;
  writeDraft(noteId: string, text: string, base: Base): Promise<RpcResult<unknown>>;
  /** Proves a journal write reached disk (drafts.flush); clears a journal error. */
  flushDrafts?(noteId: string): Promise<RpcResult<unknown>>;
  /**
   * The editor opened with journaled text the user has not touched: the journal row already protects it,
   * so nothing saves (or re-journals) it until the first change().
   */
  journaled?: boolean;
  /** Journal throttle, default 100 ms. */
  journalMs?: number;
  save(noteId: string, body: string, expectedContentHash: string): Promise<RpcResult<SaveReply>>;
  timers: Timers;
  quietMs?: number;
  maxMs?: number;
  onState(s: SaveState): void;
  onSaved?(reply: SaveReply): void;
}
export interface Autosave {
  change(): void;
  /** Resolves when nothing is in flight and the text is saved, or when a save failed (text stays journaled). */
  flushAll(): Promise<void>;
  /** Manual retry after an error. */
  retry(): Promise<void>;
  /** A draftError event: the journal could not be written. The status stays an error until a journal write succeeds. */
  fail(message: string): void;
  /** The editor text differs from the saved text. */
  dirty(): boolean;
  /** Resolves when every journal write already sent has been answered (also after dispose). */
  settled(): Promise<void>;
  state(): SaveState;
  dispose(): void;
}

export function createAutosave(o: AutosaveOptions): Autosave {
  const quietMs = o.quietMs ?? 1000;
  const maxMs = o.maxMs ?? 5000;
  let base = o.base;
  let savedText = o.initialText;
  let state: SaveState = { kind: 'saved' };
  let quietTimer: unknown;
  let maxTimer: unknown;
  let inFlight: Promise<void> | undefined;
  let again = false;
  let blocked = false;
  let disposed = false;
  let touched = !o.journaled;
  const unsaved = () => touched && o.getText() !== savedText;
  const journalMs = o.journalMs ?? 100;
  let journalError: string | undefined;
  let jTimer: unknown;
  let jPending = false;
  const writes = new Set<Promise<unknown>>();

  // A broken journal keeps the status an error: 'Saved' over it would be a lie about the next keystroke.
  const shown = (): SaveState =>
    journalError !== undefined && state.kind !== 'error'
      ? { kind: 'error', code: 'io', message: journalError }
      : state;
  const set = (s: SaveState) => {
    state = s;
    if (!disposed) o.onState(shown());
  };
  const clearTimers = () => {
    if (quietTimer !== undefined) o.timers.clearTimeout(quietTimer);
    if (maxTimer !== undefined) o.timers.clearTimeout(maxTimer);
    quietTimer = maxTimer = undefined;
  };
  const clearJournalTimer = () => {
    if (jTimer !== undefined) o.timers.clearTimeout(jTimer);
    jTimer = undefined;
  };
  const journalFailed = (message: string) => {
    journalError = message;
    set(state);
  };
  const journal = (text: string) => {
    const p = o
      .writeDraft(o.noteId, text, base)
      .then(async (r) => {
        if (disposed) return;
        if (!r.ok) return journalFailed(r.error.message);
        if (journalError === undefined || !o.flushDrafts) return;
        const f = await o.flushDrafts(o.noteId);
        if (!disposed && f.ok) {
          journalError = undefined;
          set(state);
        }
      })
      .finally(() => writes.delete(p));
    writes.add(p);
  };
  const journalNow = () => {
    jPending = false;
    journal(o.getText());
  };
  const journalTick = () => {
    jTimer = undefined;
    if (!jPending || disposed) return;
    journalNow();
    jTimer = o.timers.setTimeout(journalTick, journalMs);
  };
  /** Leading + trailing throttle: the first change writes at once, the rest collapse into one write per window. */
  const journalThrottled = () => {
    if (jTimer !== undefined) {
      jPending = true;
      return;
    }
    journalNow();
    jTimer = o.timers.setTimeout(journalTick, journalMs);
  };
  const schedule = () => {
    if (quietTimer !== undefined) o.timers.clearTimeout(quietTimer);
    quietTimer = o.timers.setTimeout(fire, quietMs);
    maxTimer ??= o.timers.setTimeout(fire, maxMs);
  };
  function fire() {
    clearTimers();
    void save();
  }

  async function sendOnce(): Promise<void> {
    const text = o.getText(); // read now, not when the change happened
    if (text === savedText) return set({ kind: 'saved' });
    set({ kind: 'saving' });
    const r = await o.save(o.noteId, text, base.contentHash);
    if (disposed) return;
    if (!r.ok) {
      blocked = r.error.code === 'conflict' || r.error.code === 'trashed';
      return set({ kind: 'error', code: r.error.code, message: r.error.message });
    }
    base = { rev: r.value.rev, contentHash: r.value.contentHash };
    savedText = text;
    o.onSaved?.(r.value);
    const now = o.getText();
    if (now === text) return set({ kind: 'saved' });
    set({ kind: 'dirty' }); // no request is in flight any more
    journal(now); // typed during the save: the journal row still carries the old base
    if (quietTimer === undefined) schedule();
  }

  function save(): Promise<void> {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          again = false;
          await sendOnce();
        } while (again && !blocked && state.kind !== 'error' && !disposed);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  return {
    change() {
      if (disposed) return;
      touched = true;
      journalThrottled();
      if (blocked) return;
      if (state.kind !== 'saving' && state.kind !== 'dirty') set({ kind: 'dirty' });
      schedule();
    },
    async flushAll() {
      // Rounds: text typed while the journal writes are awaited gets another save pass (bounded).
      for (let round = 0; round < 3 && !disposed; round++) {
        clearTimers();
        clearJournalTimer();
        for (let i = 0; i < 5 && !disposed; i++) {
          if (inFlight) await inFlight;
          if (blocked || !unsaved()) break;
          await save();
          if (state.kind === 'error') break;
        }
        // Whatever is still unsaved (or held back by the throttle) must reach the journal now.
        if (!disposed && touched && (jPending || unsaved())) journalNow();
        await Promise.all([...writes]);
        if (blocked || state.kind === 'error' || !unsaved()) break;
      }
    },
    retry: async () => {
      if (blocked) return;
      clearTimers();
      if (journalError !== undefined) journalNow(); // a successful journal write clears the error
      await save();
    },
    fail: journalFailed,
    dirty: unsaved,
    settled: async () => void (await Promise.all([...writes])),
    state: shown,
    dispose() {
      disposed = true;
      clearTimers();
      clearJournalTimer();
    },
  };
}
