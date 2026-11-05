import { copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMeta } from '../../src/db/meta.ts';
import { FIXED, open, tmp } from './helpers.ts';

describe('CS-13 identity', () => {
  it('first run creates ULID workspace and device ids; reopening keeps them', () => {
    const p = join(tmp(), 'a', 'n.db');
    const s = open(p, { clock: FIXED });
    expect(s.workspaceId).toMatch(/^[0-9A-Z]{26}$/);
    expect(s.deviceId).toMatch(/^[0-9A-Z]{26}$/);
    expect(s.deviceId).not.toBe(s.workspaceId);
    expect(getMeta(s.db, 'sync_full_reconcile')).toBe('0');
    const ids = [s.workspaceId, s.deviceId];
    s.close();
    const s2 = open(p, { clock: FIXED });
    expect([s2.workspaceId, s2.deviceId]).toEqual(ids);
    expect(getMeta(s2.db, 'sync_full_reconcile')).toBe('0');
  });

  it('a copied workspace gets a new device id, the same workspace id, and a full reconcile', () => {
    const d = tmp();
    const a = open(join(d, 'a', 'n.db'), { clock: FIXED });
    const ids = [a.workspaceId, a.deviceId];
    a.close(); // checkpointed on close, so the main file alone is a complete copy
    copyFileSync(join(d, 'a', 'n.db'), join(d, 'copy.db'));
    const c = open(join(d, 'copy.db'), { clock: FIXED });
    expect(c.workspaceId).toBe(ids[0]);
    expect(c.deviceId).not.toBe(ids[1]);
    expect(getMeta(c.db, 'sync_full_reconcile')).toBe('1');
    expect(getMeta(c.db, 'device_id')).toBe(c.deviceId);
  });

  it('renaming the workspace folder does not rotate the device id (no path in the fingerprint)', () => {
    const d = tmp();
    const a = open(join(d, 'a', 'n.db'), { clock: FIXED });
    const id = a.deviceId;
    a.close();
    renameSync(join(d, 'a'), join(d, 'renamed'));
    const b = open(join(d, 'renamed', 'n.db'), { clock: FIXED });
    expect(b.deviceId).toBe(id);
    expect(getMeta(b.db, 'sync_full_reconcile')).toBe('0');
  });

  it('rotateDeviceId() issues a new id, flags reconcile, and restarts seq at 1', () => {
    const s = open(join(tmp(), 'n.db'), { clock: FIXED });
    const old = s.deviceId;
    expect(
      s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'x', op: 'update' })).ok,
    ).toBe(true);
    const r = s.rotateDeviceId();
    expect(r.ok && r.value).toBe(s.deviceId);
    expect(s.deviceId).not.toBe(old);
    expect(getMeta(s.db, 'sync_full_reconcile')).toBe('1');
    s.mutate({}, (tx) => tx.log({ entity: 'setting', entityId: 'x', op: 'update' }));
    const rows = s.db.prepare('SELECT device_id, seq FROM change_log ORDER BY rowid').all();
    expect(rows).toEqual([
      { device_id: old, seq: 1 },
      { device_id: s.deviceId, seq: 1 },
    ]);
  });
});
