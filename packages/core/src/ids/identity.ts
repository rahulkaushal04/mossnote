import { sha256 } from '../db/hash.ts';
import type { FsPort } from '../db/fs.ts';
import { getMeta, setMeta } from '../db/meta.ts';
import type { Db } from '../db/types.ts';

export interface Identity {
  workspaceId: string;
  deviceId: string;
  /** True when a new device id was issued by this call. */
  rotated: boolean;
}

/** Copy detection: (inode, birthtime) of the db file, deliberately without the path so renaming the
 *  folder keeps the device id, and without st_dev, which changes when an external or network volume
 *  is remounted (that would rotate the device id and force a full reconcile each time). A copy to
 *  another volume still differs by inode/birthtime almost surely. Cannot detect VM/snapshot reverts
 *  (peers detect seq regression). */
export const fingerprint = (fs: FsPort, dbPath: string): string => {
  const s = fs.stat(dbPath);
  return sha256(`${s.ino}:${s.birthtimeMs}`);
};

/** Caller runs this inside a transaction. First run creates ids; a fingerprint mismatch
 *  (backup restored / workspace copied) rotates the device id and flags a full reconcile. */
export function ensureIdentity(db: Db, fs: FsPort, dbPath: string, newId: () => string): Identity {
  const fp = fingerprint(fs, dbPath);
  let workspaceId = getMeta(db, 'workspace_id');
  let deviceId = getMeta(db, 'device_id');
  if (!workspaceId || !deviceId) {
    workspaceId = newId();
    deviceId = newId();
    setMeta(db, 'workspace_id', workspaceId);
    setMeta(db, 'device_id', deviceId);
    setMeta(db, 'file_fingerprint', fp);
    return { workspaceId, deviceId, rotated: false };
  }
  if (getMeta(db, 'file_fingerprint') !== fp) {
    deviceId = rotateDevice(db, newId, fp);
    return { workspaceId, deviceId, rotated: true };
  }
  return { workspaceId, deviceId, rotated: false };
}

/** New device id, and sync must do a full reconcile. The seq counter restarts at 1 under the new id. */
export function rotateDevice(db: Db, newId: () => string, fp?: string): string {
  const deviceId = newId();
  setMeta(db, 'device_id', deviceId);
  setMeta(db, 'sync_full_reconcile', '1');
  if (fp) setMeta(db, 'file_fingerprint', fp);
  return deviceId;
}
