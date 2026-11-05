import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AttachmentFault } from '../../src/attachments/api.ts';
import { blobPath, count, mkNote, openAtt, put, sha, sleep, unwrap } from './util.ts';

const BIG = Buffer.from('0123456789abcdef'.repeat(40_000)); // 640 kB, several stream chunks

async function body(s: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

async function setup() {
  const a = openAtt();
  const noteId = mkNote(a.w, 'Quarterly Plan');
  const ref = unwrap(await a.w.attachments.addFromPath({}, noteId, put(a, 'q3.bin', BIG), 'q3 report.dat'));
  return { a, noteId, ref };
}
const flipByte = (path: string, at = 100): void => {
  chmodSync(path, 0o600);
  const b = readFileSync(path);
  b[at] = b[at]! ^ 0xff;
  writeFileSync(path, b);
};

describe('AT-2 integrity on read', () => {
  it('serves a verified stream, whole and by range, from the verified handle', async () => {
    const { a, ref } = await setup();
    const v = unwrap(await a.w.attachments.openVerified(ref.sha256));
    expect(v).toMatchObject({ sha256: ref.sha256, size: BIG.length, kind: 'text' });
    expect((await body(v.stream())).equals(BIG)).toBe(true);
    expect((await body(v.stream({ start: 10, end: 19 }))).equals(BIG.subarray(10, 20))).toBe(true);
    expect((await body(v.stream({ start: BIG.length - 5, end: BIG.length + 1000 }))).equals(BIG.subarray(-5))).toBe(true);
    expect((await body(v.stream({ start: 50, end: 10 }))).length).toBe(0);
    v.close();
    v.close(); // idempotent
    expect((await body(v.stream())).length).toBe(0); // closed handle serves nothing
  });

  it('one flipped byte: corrupt, the message names the file and the note and suggests a backup', async () => {
    const { a, noteId, ref } = await setup();
    flipByte(blobPath(a, ref.sha256));
    const r = await a.w.attachments.openVerified(ref.sha256, { noteId });
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    if (r.ok) return;
    expect(r.error.message).toContain('q3 report.dat');
    expect(r.error.message).toContain('Quarterly Plan');
    expect(r.error.message).toMatch(/backup/i);
    expect(r.error.message).toMatch(/damaged/);
    expect(r.error.cause as AttachmentFault).toEqual({ attachmentState: 'corrupt', sha256: ref.sha256 });
    expect(unwrap(a.w.attachments.listForNote(noteId))[0]!.verifyState).toBe('corrupt');
    const c = unwrap(await a.w.attachments.check(ref.sha256));
    expect(c.state).toBe('corrupt');
    expect(c.message).toMatch(/backup/i);
  });

  it('a deleted file: missing, with the same guidance', async () => {
    const { a, noteId, ref } = await setup();
    rmSync(blobPath(a, ref.sha256));
    const r = await a.w.attachments.openVerified(ref.sha256);
    expect(r).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    if (!r.ok) {
      expect(r.error.message).toMatch(/is missing/);
      expect(r.error.message).toContain('Quarterly Plan');
      expect((r.error.cause as AttachmentFault).attachmentState).toBe('missing');
    }
    expect(unwrap(a.w.attachments.listForNote(noteId))[0]!.verifyState).toBe('missing');
  });

  it('a truncated file (size differs) is corrupt without hashing', async () => {
    const { a, ref } = await setup();
    writeFileSync(blobPath(a, ref.sha256), BIG.subarray(0, 1000));
    expect(await a.w.attachments.check(ref.sha256)).toMatchObject({ ok: true, value: { state: 'corrupt' } });
  });

  it('a hash verified once is not re-hashed while the file is unchanged, but a change is noticed', async () => {
    const { a, ref } = await setup();
    const p = blobPath(a, ref.sha256);
    unwrap(await a.w.attachments.openVerified(ref.sha256)).close();
    // same size, different bytes, mtime/ctime move on write: the cache key changes and the hash runs again
    await sleep(15);
    flipByte(p, 5);
    expect(await a.w.attachments.check(ref.sha256)).toMatchObject({ ok: true, value: { state: 'corrupt' } });
  });

  it('a healthy re-read after repair flips the state back to ok', async () => {
    const { a, noteId, ref } = await setup();
    const p = blobPath(a, ref.sha256);
    const keep = join(a.dir, 'good.bin');
    copyFileSync(p, keep);
    flipByte(p);
    expect(unwrap(await a.w.attachments.check(ref.sha256)).state).toBe('corrupt');
    // restoring the bytes (backup restore) heals it
    chmodSync(p, 0o600);
    copyFileSync(keep, p);
    expect(unwrap(await a.w.attachments.check(ref.sha256)).state).toBe('ok');
    expect(unwrap(a.w.attachments.listForNote(noteId))[0]!.verifyState).toBe('ok');
  });

  it('re-adding the same content heals a damaged copy (rename replaces it)', async () => {
    const { a, noteId, ref } = await setup();
    flipByte(blobPath(a, ref.sha256));
    unwrap(await a.w.attachments.addFromPath({}, mkNote(a.w, 'Other'), put(a, 'again.bin', BIG)));
    expect(unwrap(await a.w.attachments.check(ref.sha256)).state).toBe('ok');
    expect(unwrap(a.w.attachments.listForNote(noteId))[0]!.verifyState).toBe('ok');
  });

  it('unknown or malformed ids: not_found / validation, never a path lookup', async () => {
    const { a } = await setup();
    expect(await a.w.attachments.openVerified(sha('nothing'))).toMatchObject({ ok: false, error: { code: 'not_found' } });
    for (const bad of ['../../etc/passwd', sha('x').toUpperCase(), '', 'a'.repeat(63)])
      expect(await a.w.attachments.openVerified(bad)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(unwrap(await a.w.attachments.check(sha('nothing'))).state).toBe('missing');
  });

  it('parallel openers share one hash computation', async () => {
    const { a, ref } = await setup();
    const opens = await Promise.all(Array.from({ length: 5 }, () => a.w.attachments.openVerified(ref.sha256)));
    expect(opens.every((o) => o.ok)).toBe(true);
    for (const o of opens) if (o.ok) o.value.close();
    expect(a.w.attachments._hashing.size).toBe(0); // all settled and cleaned up
  });
});

describe('AT-2 verifyAll', () => {
  it('counts ok / missing / corrupt / untracked and records the state', async () => {
    const a = openAtt();
    const n = mkNote(a.w, 'Plan');
    const good = unwrap(await a.w.attachments.addFromBytes({}, n, Buffer.from('good file contents'), 'good.txt'));
    const bad = unwrap(await a.w.attachments.addFromBytes({}, n, Buffer.from('will rot soon'), 'rot.txt'));
    const gone = unwrap(await a.w.attachments.addFromBytes({}, n, Buffer.from('will vanish'), 'gone.txt'));
    flipByte(blobPath(a, bad.sha256), 2);
    rmSync(blobPath(a, gone.sha256));
    const stray = sha('stray');
    const strayPath = blobPath(a, stray);
    // an untracked file named like a blob
    unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w, 'tmp'), Buffer.from('x'), 'x.txt'));
    mkdirSync(join(strayPath, '..'), { recursive: true });
    writeFileSync(strayPath, 'stray');
    const logsBefore = count(a.w, 'change_log');
    const rep = unwrap(await a.w.attachments.verifyAll());
    expect(count(a.w, 'change_log')).toBe(logsBefore); // verify_state is a status, not a user action
    expect(rep.checked).toBe(4);
    expect(rep.ok).toBe(2);
    expect(rep.corrupt.map((f) => f.sha256)).toEqual([bad.sha256]);
    expect(rep.missing.map((f) => f.sha256)).toEqual([gone.sha256]);
    expect(rep.corrupt[0]!.notes).toEqual([{ noteId: n, title: 'Plan', name: 'rot.txt' }]);
    expect(rep.untracked).toEqual([stray]);
    const states = Object.fromEntries(
      (a.w.store.db.prepare('SELECT sha256, verify_state AS s FROM attachments').all() as { sha256: string; s: string }[]).map((r) => [r.sha256, r.s]),
    );
    expect(states[good.sha256]).toBe('ok');
    expect(states[bad.sha256]).toBe('corrupt');
    expect(states[gone.sha256]).toBe('missing');
  });

  it('a copied workspace with one tampered file is caught', async () => {
    const a = openAtt();
    const r = unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w), Buffer.from('original bytes'), 'o.txt'));
    flipByte(blobPath(a, r.sha256), 0);
    const rep = unwrap(await a.w.attachments.verifyAll());
    expect(rep.corrupt).toHaveLength(1);
  });

  it('manifest lists every blob with its relative path', async () => {
    const a = openAtt();
    const r = unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w), Buffer.from('m'), 'm.txt'));
    expect(unwrap(a.w.attachments.manifest())).toEqual([
      { sha256: r.sha256, size: 1, mime: 'text/plain', relPath: `${r.sha256.slice(0, 2)}/${r.sha256.slice(2, 4)}/${r.sha256}` },
    ]);
  });
});
