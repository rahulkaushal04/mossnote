/**
 * Asking the browser not to clear the journal. Without this a browser may delete a site's data
 * when the device is short of space, and Safari may do so for a site that was not visited for a
 * while. Whether the request is granted is up to the browser; installing the app to the Home
 * Screen or the dock improves the odds.
 */

export interface StorageProtection {
  persisted: boolean;
  /** Bytes in use and bytes the browser allows, when it says. */
  usage: number | null;
  quota: number | null;
}

/** Ask for persistent storage. True when the browser now protects the journal. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function readStorageProtection(): Promise<StorageProtection> {
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted(),
      navigator.storage.estimate(),
    ]);
    return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { persisted: false, usage: null, quota: null };
  }
}
