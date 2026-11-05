import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openWorkspace, type Result } from '../../src/index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mossnote-ws-'));
  dirs.push(d);
  return d;
};
function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const openOk = (path: string) => must(openWorkspace(path));
const bytes = (p: string) => (existsSync(p) ? readFileSync(p).toString('latin1') : '');

describe('workspace', () => {
  it('keeps notes, folders and tags across a close and reopen (CS-12 at core level)', () => {
    const path = join(tmp(), 'mossnote.db');
    const a = openOk(path);
    const folder = must(a.folders.create({}, { name: 'Projects' }));
    const note = must(
      a.notes.create({}, { title: 'Plan', body: '# Plan\n- [ ] ship', folderId: folder.id }),
    );
    const tag = must(a.tags.create({}, 'work'));
    must(a.tags.tagNote({}, note.id, tag.id));
    a.close();

    const b = openOk(path);
    expect(must(b.notes.get(note.id)).body).toBe('# Plan\n- [ ] ship');
    expect(must(b.folders.get(folder.id)).name).toBe('Projects');
    expect(must(b.tags.listForNote(note.id)).map((t: { name: string }) => t.name)).toEqual([
      'work',
    ]);
    b.close();
  });

  it('refuses a second open of the same workspace without calling it corrupt (CS-10)', () => {
    const path = join(tmp(), 'mossnote.db');
    const a = openOk(path);
    const second = openWorkspace(path);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('unavailable');
    a.close();
    openOk(path).close();
  });

  it('leaves no trace of purged text in the database or WAL after a checkpoint', () => {
    const path = join(tmp(), 'mossnote.db');
    const marker = 'ZXQ-UNIQUE-PURGE-MARKER-7731';
    const ws = openOk(path);
    const note = must(ws.notes.create({}, { title: 'Secret', body: `first ${marker}` }));
    must(ws.notes.update({}, note.id, { body: `second ${marker} edited` }));
    ws.store.db.pragma('wal_checkpoint(TRUNCATE)');
    // sanity: the marker really is on disk before the purge, so the later absence means something
    expect(bytes(path).includes(marker) || bytes(`${path}-wal`).includes(marker)).toBe(true);

    const { batchId } = must(ws.trash.trashNote({}, note.id));
    must(ws.trash.purgeBatch({}, batchId, { confirmed: true }));
    ws.store.db.pragma('wal_checkpoint(TRUNCATE)');
    ws.close();

    expect(bytes(path).includes(marker)).toBe(false);
    expect(bytes(`${path}-wal`).includes(marker)).toBe(false);
  });
});
