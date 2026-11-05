import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachmentUrl } from '../../src/attachments/links.ts';
import { blobPath, count, files, mkNote, openAtt, sha, sleep, unwrap, type Att } from './util.ts';

const content = (label: string): Buffer => Buffer.from(`blob ${label} ${'x'.repeat(100)}`);
const S = (label: string): string => sha(content(label));

async function addBlob(a: Att, noteId: string, label: string) {
  return unwrap(await a.w.attachments.addFromBytes({}, noteId, content(label), `${label}.txt`));
}
/** Leaves the blob with no reference row. */
async function orphan(a: Att, label: string) {
  const tmpNote = mkNote(a.w, `tmp-${label}`);
  const r = await addBlob(a, tmpNote, label);
  unwrap(a.w.attachments.removeRef({}, r.refId));
  return r.sha256;
}
const insertVersion = (a: Att, noteId: string, body: string): void => {
  a.w.store.db
    .prepare(
      `INSERT INTO versions(id, note_id, title, body, content_hash, reason, created_at, device_id)
       VALUES (?, ?, 't', ?, ?, 'edit', ?, 'D')`,
    )
    .run(randomUUID(), noteId, body, sha(body), a.clock.t);
};
const insertDraft = (a: Att, noteId: string, body: string): void => {
  a.w.store.db
    .prepare(
      `INSERT INTO drafts(note_id, body, base_rev, base_content_hash, saved_at) VALUES (?, ?, 1, ?, ?)`,
    )
    .run(noteId, body, sha(body), a.clock.t);
};
const link = (h: string): string => `see ![x](${attachmentUrl(h)}) here`;

describe('AT-6 cleanup preview lists exactly the unused files', () => {
  async function scenario() {
    const a = openAtt();
    const live = mkNote(a.w, 'Live');
    const X = (await addBlob(a, live, 'X')).sha256; // live reference
    const holder = mkNote(a.w, 'Holder', 'plain');
    // Y: only inside a version body
    const Y = await orphan(a, 'Y');
    insertVersion(a, holder, link(Y));
    // Z: reference on a trashed note
    const zNote = mkNote(a.w, 'Trashed');
    const Z = (await addBlob(a, zNote, 'Z')).sha256;
    unwrap(a.w.trash.trashNote({}, zNote));
    // W: only inside a draft
    const W = await orphan(a, 'W');
    insertDraft(a, holder, link(W));
    // L: linked in a current note body, no reference row
    const L = await orphan(a, 'L');
    unwrap(a.w.notes.create({}, { title: 'Linker', body: link(L) }));
    // O: a true orphan; U: a file no row describes
    const O = await orphan(a, 'O');
    const U = S('U');
    mkdirSync(dirname(blobPath(a, U)), { recursive: true });
    writeFileSync(blobPath(a, U), content('U'));
    return { a, X, Y, Z, W, L, O, U, zNote };
  }

  it('preview shows O and U with sizes, nothing else', async () => {
    const { a, O, U } = await scenario();
    const pv = unwrap(await a.w.attachments.cleanupPreview());
    expect(pv.items.map((i) => i.sha256).sort()).toEqual([O, U].sort());
    expect(pv.items.find((i) => i.sha256 === O)).toMatchObject({ size: content('O').length, untracked: false, kind: 'text' });
    expect(pv.items.find((i) => i.sha256 === U)).toMatchObject({ size: content('U').length, untracked: true, kind: 'unknown' });
    expect(pv.totalBytes).toBe(content('O').length + content('U').length);
    structuredClone(pv);
  });

  it('run without confirmation or with a bad list is a validation error and deletes nothing', async () => {
    const { a, O } = await scenario();
    const before = files(a.root);
    for (const opts of [{}, { confirmed: false }, { confirmed: 'yes' }, { confirmed: true, extra: 1 }])
      expect(await a.w.attachments.cleanupRun([O], opts)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await a.w.attachments.cleanupRun(['../../x'], { confirmed: true })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await a.w.attachments.cleanupRun([O.toUpperCase()], { confirmed: true })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(files(a.root)).toEqual(before);
  });

  it('run deletes O and U and skips every file that is referenced, linked, versioned, drafted or on a trashed note', async () => {
    const { a, X, Y, Z, W, L, O, U } = await scenario();
    const all = [X, Y, Z, W, L, O, U];
    const r = unwrap(await a.w.attachments.cleanupRun(all, { confirmed: true }));
    expect(r.deleted).toBe(2);
    expect(r.bytes).toBe(content('O').length + content('U').length);
    expect(r.skipped.sort()).toEqual([X, Y, Z, W, L].sort());
    for (const keep of [X, Y, Z, W, L]) expect(existsSync(blobPath(a, keep)), keep).toBe(true);
    for (const gone of [O, U]) expect(existsSync(blobPath(a, gone)), gone).toBe(false);
    expect(
      a.w.store.db.prepare('SELECT 1 FROM attachments WHERE sha256 = ?').get(O),
    ).toBeUndefined();
    // everything still in use verifies
    for (const keep of [X, Z]) expect(unwrap(await a.w.attachments.check(keep)).state).toBe('ok');
    // a second run has nothing to do
    expect(unwrap(await a.w.attachments.cleanupRun([O, U], { confirmed: true }))).toMatchObject({ deleted: 0 });
  });

  it('only what the user selected is deleted', async () => {
    const { a, O, U } = await scenario();
    const r = unwrap(await a.w.attachments.cleanupRun([O], { confirmed: true }));
    expect(r.deleted).toBe(1);
    expect(existsSync(blobPath(a, U))).toBe(true);
  });

  it('after purging the note that held Z, Z is listed (and its file stays until the user cleans up)', async () => {
    const { a, Z, zNote } = await scenario();
    const batch = unwrap(a.w.trash.list()).find((i) => i.id === zNote)!.batchId;
    unwrap(a.w.trash.purgeBatch({}, batch, { confirmed: true }));
    expect(existsSync(blobPath(a, Z))).toBe(true);
    const pv = unwrap(await a.w.attachments.cleanupPreview());
    expect(pv.items.map((i) => i.sha256)).toContain(Z);
  });

  it('a direct database delete of a referenced blob fails on the foreign key', async () => {
    const { a, X } = await scenario();
    expect(() => a.w.store.db.prepare('DELETE FROM attachments WHERE sha256 = ?').run(X)).toThrow(/FOREIGN KEY/i);
  });

  it('a body edited AFTER the scan and now linking the file keeps it (re-validated inside the transaction)', async () => {
    const a = openAtt();
    const O = await orphan(a, 'late');
    const holder = mkNote(a.w, 'Holder', 'plain');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = a.w.attachments._locks.run(O, () => gate);
    const run = a.w.attachments.cleanupRun([O], { confirmed: true });
    await sleep(60); // the body scan is over; cleanup now waits for the per-sha lock
    a.clock.t += 5000;
    unwrap(a.w.notes.save({}, holder, { title: 'Holder', body: link(O) }));
    release();
    await held;
    const r = unwrap(await run);
    expect(r.deleted).toBe(0);
    expect(r.skipped).toEqual([O]);
    expect(existsSync(blobPath(a, O))).toBe(true);
  });

  it('a file only mentioned as a longer hex run or in upper case is still kept (false positives keep files)', async () => {
    const a = openAtt();
    const O = await orphan(a, 'shout');
    mkNote(a.w, 'Shouty', `ref ${O.toUpperCase()} and 0${O}`);
    const pv = unwrap(await a.w.attachments.cleanupPreview());
    expect(pv.items.map((i) => i.sha256)).not.toContain(O);
  });
});

describe('C3 per-sha lock: add and cleanup never leave a reference to a missing file', () => {
  it('cleanup waits for a held lock, then deletes', async () => {
    const a = openAtt();
    const O = await orphan(a, 'held');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = a.w.attachments._locks.run(O, () => gate);
    const run = a.w.attachments.cleanupRun([O], { confirmed: true });
    await sleep(60);
    expect(existsSync(blobPath(a, O))).toBe(true); // blocked behind the lock
    release();
    await held;
    expect(unwrap(await run).deleted).toBe(1);
    expect(existsSync(blobPath(a, O))).toBe(false);
  });

  it('an add waits for a held lock, and the reference then exists with a good file', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const h = S('late-add');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = a.w.attachments._locks.run(h, () => gate);
    const add = a.w.attachments.addFromBytes({}, n, content('late-add'), 'x.txt');
    await sleep(60);
    expect(count(a.w, 'note_attachments')).toBe(0);
    release();
    await held;
    expect(unwrap(await add).sha256).toBe(h);
    expect(unwrap(await a.w.attachments.check(h)).state).toBe('ok');
  });

  it('cleanup racing adds of the same content: every reference that exists points at a verified file', async () => {
    for (let round = 0; round < 15; round++) {
      const a = openAtt();
      const O = await orphan(a, 'race');
      const notes = [mkNote(a.w, 'A'), mkNote(a.w, 'B')];
      const jobs: Promise<unknown>[] = [
        a.w.attachments.cleanupRun([O], { confirmed: true }),
        a.w.attachments.addFromBytes({}, notes[0]!, content('race'), 'one.txt'),
      ];
      if (round % 2) jobs.reverse();
      jobs.push(a.w.attachments.addFromBytes({}, notes[1]!, content('race'), 'two.txt'));
      await Promise.all(jobs);
      const refs = count(a.w, 'note_attachments');
      expect(refs).toBe(2);
      expect(unwrap(await a.w.attachments.check(O)).state).toBe('ok');
      expect(existsSync(blobPath(a, O))).toBe(true);
    }
  });

  it('cleanup and verify never overlap (one job at a time)', async () => {
    const a = openAtt();
    await orphan(a, 'job');
    let inside = 0;
    let max = 0;
    const track = () =>
      a.w.attachments._jobs.run(async () => {
        inside++;
        max = Math.max(max, inside);
        await sleep(10);
        inside--;
      });
    await Promise.all([track(), a.w.attachments.verifyAll(), track(), a.w.attachments.cleanupPreview(), track()]);
    expect(max).toBe(1);
  });
});
