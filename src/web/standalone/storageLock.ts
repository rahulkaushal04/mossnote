/**
 * Only one tab can use the journal's files at a time: the browser gives a file to a single
 * owner. This holds a lock for the life of the page, so a second tab finds out at once and can
 * say so, instead of failing somewhere deep inside the storage code.
 */

const LOCK_NAME = 'mossnote-storage';

export type StorageLock = 'held' | 'busy';

/**
 * Take the lock if nobody has it. A browser without the Web Locks API gets `held`; the worker
 * then finds out for itself if the files are in use.
 */
export function holdStorageLock(locks: LockManager | undefined): Promise<StorageLock> {
  if (locks === undefined) return Promise.resolve('held');
  return new Promise((resolve) => {
    locks
      .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve('busy');
          return undefined;
        }
        resolve('held');
        // A promise that never settles keeps the lock until the page goes away.
        return new Promise<never>(() => undefined);
      })
      .catch(() => {
        resolve('held');
      });
  });
}
