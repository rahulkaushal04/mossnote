/**
 * In-process locks of the attachments module (decision C3).
 *  - per-sha: serialises add / cleanup / extraction on one blob. Held from the start of the database
 *    transaction until the file operation (rename or unlink) has finished.
 *  - job: one long-running maintenance job at a time (cleanup, verify; backup and import later).
 * Both are FIFO promise chains: no timers, no polling, and a thrown task never wedges the chain.
 */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
      const prev = tails.get(key) ?? Promise.resolve();
      const mine = prev.then(
        () => task(),
        () => task(),
      );
      const tail = mine.catch(() => undefined);
      tails.set(key, tail);
      try {
        return await mine;
      } finally {
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
    /** Keys currently held or queued (tests). */
    get size(): number {
      return tails.size;
    },
  };
}
export type KeyedLock = ReturnType<typeof createKeyedLock>;

export function createJobMutex() {
  const lock = createKeyedLock();
  return {
    run: <T>(task: () => Promise<T> | T): Promise<T> => lock.run('job', task),
    get busy(): boolean {
      return lock.size > 0;
    },
  };
}
export type JobMutex = ReturnType<typeof createJobMutex>;

export const yieldTick = (): Promise<void> => new Promise((r) => setImmediate(r));
