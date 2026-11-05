import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeAttachFs } from '../../src/attachments/fsport.ts';
import { attachmentUrl } from '../../src/attachments/links.ts';
import {
  blobPath,
  closeAtt,
  count,
  faultFs,
  files,
  makePdf,
  mkNote,
  MiB,
  openAtt,
  PNG,
  put,
  sha,
  unwrap,
} from './util.ts';

describe('AT-1 content-addressed store', () => {
  it('stores by sha256 under attachments/ab/cd/<sha>, dedupes, and keeps one ref per note and name', async () => {
    const a = openAtt();
    const n1 = mkNote(a.w, 'One');
    const n2 = mkNote(a.w, 'Two');
    const p1 = put(a, 'first.png', PNG);
    const p2 = put(a, 'second-name.png', PNG);
    const r1 = unwrap(await a.w.attachments.addFromPath({}, n1, p1));
    const r2 = unwrap(await a.w.attachments.addFromPath({}, n2, p2));
    const h = sha(PNG);
    expect(r1.sha256).toBe(h);
    expect(r2.sha256).toBe(h);
    expect(r1.refId).not.toBe(r2.refId);
    expect([r1.name, r2.name]).toEqual(['first.png', 'second-name.png']);
    expect(r1).toMatchObject({ kind: 'image', mime: 'image/png', size: PNG.length, verifyState: 'ok', textState: 'none' });
    expect(r1.url).toBe(attachmentUrl(h));
    expect(r1.markdown).toBe(`![first.png](mossnote-attachment://a/${h})`);
    // exactly one file, in the sharded location
    expect(files(a.root)).toEqual([`${h.slice(0, 2)}/${h.slice(2, 4)}/${h}`]);
    expect(readFileSync(blobPath(a, h)).equals(PNG)).toBe(true);
    expect(count(a.w, 'attachments')).toBe(1);
    expect(count(a.w, 'note_attachments')).toBe(2);
    // the same blob again for the same note: the existing ref comes back, no new row, no new log row
    const logs = count(a.w, 'change_log');
    const again = unwrap(await a.w.attachments.addFromPath({}, n1, p1));
    expect(again.refId).toBe(r1.refId);
    expect(count(a.w, 'note_attachments')).toBe(2);
    expect(count(a.w, 'change_log')).toBe(logs);
    expect(files(a.root)).toEqual([`${h.slice(0, 2)}/${h.slice(2, 4)}/${h}`]); // no temp residue either
  });

  it('writes one attachment_ref create row per new ref, carrying the sha as content hash and no text', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const r = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'p.png', PNG)));
    const row = a.w.store.db
      .prepare("SELECT entity, entity_id, op, content_hash, fields FROM change_log WHERE entity = 'attachment_ref'")
      .get() as { entity: string; entity_id: string; op: string; content_hash: string; fields: string };
    expect(row).toMatchObject({ entity: 'attachment_ref', entity_id: r.refId, op: 'create', content_hash: sha(PNG) });
    expect(JSON.parse(row.fields)).toEqual({ noteId: n, sha256: sha(PNG), name: 'p.png', size: PNG.length, mime: 'image/png' });
  });

  it('addFromBytes stores the same blob as addFromPath', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const viaPath = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'x.png', PNG)));
    const viaBytes = unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w, 'B'), PNG, 'clip.png'));
    expect(viaBytes.sha256).toBe(viaPath.sha256);
    expect(files(a.root)).toHaveLength(1);
  });

  it('the stored file is owner read/write only, never executable', async () => {
    const a = openAtt();
    const r = unwrap(await a.w.attachments.addFromPath({}, mkNote(a.w), put(a, 'tool.sh', '#!/bin/sh\necho hi\n')));
    expect(statSync(blobPath(a, r.sha256)).mode & 0o111).toBe(0);
    expect(r.kind).toBe('executable');
  });

  it('refuses a missing, trashed or unknown note and leaves nothing behind', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const p = put(a, 'x.png', PNG);
    expect(await a.w.attachments.addFromPath({}, 'nope', p)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    unwrap(a.w.trash.trashNote({}, n));
    expect(await a.w.attachments.addFromPath({}, n, p)).toMatchObject({ ok: false, error: { code: 'trashed' } });
    expect(files(a.root)).toEqual([]);
    expect(count(a.w, 'attachments')).toBe(0);
  });

  it('a zero-byte file is a valid attachment', async () => {
    const a = openAtt();
    const r = unwrap(await a.w.attachments.addFromPath({}, mkNote(a.w), put(a, 'empty.txt', '')));
    expect(r).toMatchObject({ size: 0, kind: 'text' });
    expect(r.sha256).toBe(sha(''));
  });
});

describe('AT-4 hostile names and types', () => {
  it('stores a sanitized display name; the file on disk is named by hash only', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const r = unwrap(await a.w.attachments.addFromBytes({}, n, PNG, '../../../etc/evil‮gnp.exe'));
    expect(r.name).toBe('evilgnp.exe');
    expect(r.kind).toBe('executable'); // the .exe extension upgrades a PNG-looking blob to reveal-only
    expect(files(a.root)).toEqual([`${r.sha256.slice(0, 2)}/${r.sha256.slice(2, 4)}/${r.sha256}`]);
    // the markdown cannot break out of the link
    const m = unwrap(await a.w.attachments.addFromBytes({}, n, Buffer.from('hello'), 'x](javascript:alert(1))'));
    expect(m.markdown).toBe(`[x\\]\\(javascript_alert\\(1\\)\\)](mossnote-attachment://a/${m.sha256})`);
  });

  it('types come from the bytes: PNG named .txt is an image, Mach-O named .jpg is reveal-only', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const img = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'looks.txt', PNG)));
    expect(img).toMatchObject({ kind: 'image', mime: 'image/png' });
    const macho = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]), Buffer.alloc(64)]);
    const exe = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'photo.jpg', macho)));
    expect(exe.kind).toBe('executable');
    const script = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'readme.txt', '#!/usr/bin/env python\nprint(1)\n')));
    expect(script.kind).toBe('executable');
    const html = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'banner.png', '<!doctype html><script>1</script>')));
    expect(html.kind).toBe('html');
  });

  it('the same bytes added once as .txt and once as .sh end up reveal-only (stricter wins, never downgraded)', async () => {
    const a = openAtt();
    const n1 = mkNote(a.w);
    const n2 = mkNote(a.w, 'B');
    const n3 = mkNote(a.w, 'C');
    const body = 'echo hello\n';
    expect(unwrap(await a.w.attachments.addFromBytes({}, n1, Buffer.from(body), 'a.txt')).kind).toBe('text');
    expect(unwrap(await a.w.attachments.addFromBytes({}, n2, Buffer.from(body), 'a.sh')).kind).toBe('executable');
    expect(unwrap(await a.w.attachments.addFromBytes({}, n3, Buffer.from(body), 'again.txt')).kind).toBe('executable');
    expect(unwrap(a.w.attachments.listForNote(n1))[0]!.kind).toBe('executable');
  });

  it('refuses directories and FIFOs without hanging, and a missing file with not_found', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const dir = join(a.srcDir, 'folder');
    mkdirSync(dir);
    expect(await a.w.attachments.addFromPath({}, n, dir)).toMatchObject({ ok: false, error: { code: 'validation' } });
    if (process.platform !== 'win32') {
      const fifo = join(a.srcDir, 'pipe');
      execFileSync('mkfifo', [fifo]);
      expect(await a.w.attachments.addFromPath({}, n, fifo)).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(await a.w.attachments.addFromPath({}, n, join(a.srcDir, 'missing.png'))).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(files(a.root)).toEqual([]);
  });

  it('a path that is not a plain non-empty string is a validation error', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    for (const bad of ['', 'x'.repeat(5000), 5 as unknown as string])
      expect(await a.w.attachments.addFromPath({}, n, bad)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('AT-3 streaming, size limit, disk full', () => {
  it('copies in chunks of at most the chunk size and never reads the whole file at once', async () => {
    const f = faultFs();
    const a = openAtt({ fs: f.fs, chunkSize: MiB });
    const big = Buffer.alloc(3 * MiB + 123, 7);
    unwrap(await a.w.attachments.addFromPath({}, mkNote(a.w), put(a, 'big.bin', big)));
    expect(Math.max(...f.state.reads)).toBeLessThanOrEqual(MiB);
    expect(f.state.reads.filter((n) => n > 0).length).toBeGreaterThanOrEqual(4);
    expect(f.state.writes).toBeGreaterThanOrEqual(4);
  });

  it('ENOSPC on the 3rd write: io error that says so, no file, no temp file, no row', async () => {
    const f = faultFs();
    const a = openAtt({ fs: f.fs, chunkSize: MiB });
    const n = mkNote(a.w);
    const p = put(a, 'big.bin', Buffer.alloc(4 * MiB, 1));
    f.failOnWrite(3);
    const r = await a.w.attachments.addFromPath({}, n, p);
    expect(r).toMatchObject({ ok: false, error: { code: 'io' } });
    if (!r.ok) expect(r.error.message).toMatch(/disk space/i);
    expect(files(a.root)).toEqual([]);
    expect(count(a.w, 'attachments')).toBe(0);
    expect(count(a.w, 'note_attachments')).toBe(0);
    // and it works once there is space again
    f.failOnWrite(0);
    expect((await a.w.attachments.addFromPath({}, n, p)).ok).toBe(true);
  });

  it('EIO on the very first write is handled the same way', async () => {
    const f = faultFs();
    const a = openAtt({ fs: f.fs });
    f.failOnWrite(1, 'EIO');
    const r = await a.w.attachments.addFromBytes({}, mkNote(a.w), PNG, 'p.png');
    expect(r).toMatchObject({ ok: false, error: { code: 'io' } });
    expect(files(a.root)).toEqual([]);
  });

  it('size limit: exactly the limit passes, limit + 1 is refused with no residue', async () => {
    const a = openAtt({ maxBytes: () => MiB });
    const n = mkNote(a.w);
    const ok = await a.w.attachments.addFromPath({}, n, put(a, 'exact.bin', Buffer.alloc(MiB, 2)));
    expect(ok.ok).toBe(true);
    const before = files(a.root);
    const r = await a.w.attachments.addFromPath({}, n, put(a, 'over.bin', Buffer.alloc(MiB + 1, 3)));
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    if (!r.ok) expect(r.error.message).toMatch(/larger than the limit/);
    expect(files(a.root)).toEqual(before);
    expect(count(a.w, 'attachments')).toBe(1);
  });

  it('the limit is also enforced while streaming, when the file grows after it was measured', async () => {
    const lying = { ...nodeAttachFs, fstat: (fd: number) => ({ ...nodeAttachFs.fstat(fd), size: 10 }) };
    const a = openAtt({ fs: lying, maxBytes: () => MiB });
    const r = await a.w.attachments.addFromPath({}, mkNote(a.w), put(a, 'grows.bin', Buffer.alloc(MiB + 5, 4)));
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(files(a.root)).toEqual([]);
  });

  it('defaults to 200 MB, follows the pref, and cannot exceed the 1 GB hard cap', () => {
    const a = openAtt();
    expect(a.w.attachments.maxBytes()).toBe(200 * MiB);
    a.w.store.db
      .prepare("INSERT INTO meta(key, value) VALUES ('ui_prefs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ attachmentMaxBytes: 5 * MiB }));
    expect(a.w.attachments.maxBytes()).toBe(5 * MiB);
    const b = openAtt({ maxBytes: () => 50 * 1024 * MiB });
    expect(b.w.attachments.maxBytes()).toBe(1024 * MiB);
  });

  it('addFromBytes refuses more than 32 MiB whatever the limit', async () => {
    const a = openAtt({ maxBytes: () => 100 * MiB });
    const r = await a.w.attachments.addFromBytes({}, mkNote(a.w), Buffer.alloc(32 * MiB + 1), 'huge.bin');
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(files(a.root)).toEqual([]);
  });

  it('a database failure after the rename leaves an untracked file that Cleanup lists', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    a.w.store.db.exec('CREATE TRIGGER boom BEFORE INSERT ON note_attachments BEGIN SELECT RAISE(ABORT, \'boom\'); END');
    const r = await a.w.attachments.addFromPath({}, n, put(a, 'x.png', PNG));
    expect(r.ok).toBe(false);
    a.w.store.db.exec('DROP TRIGGER boom');
    expect(count(a.w, 'note_attachments')).toBe(0);
    expect(count(a.w, 'attachments')).toBe(0); // the attachments insert rolled back with the ref
    const pv = unwrap(await a.w.attachments.cleanupPreview());
    expect(pv.items).toEqual([expect.objectContaining({ sha256: sha(PNG), untracked: true, size: PNG.length })]);
  });
});

describe('startup sweep', () => {
  it('removes leftover temp files of an interrupted add', async () => {
    const a = openAtt();
    unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w), PNG, 'p.png'));
    const tmpDir = join(a.root, '.tmp');
    writeFileSync(join(tmpDir, 'LEFTOVER'), 'half a file');
    closeAtt(a);
    const b = openAtt({ dir: a.dir });
    expect(existsSync(join(tmpDir, 'LEFTOVER'))).toBe(false);
    expect(files(b.root)).toHaveLength(1);
  });
});

describe('listing and removing references', () => {
  it('lists refs in creation order, removes one, keeps the file, and logs a purge', async () => {
    const a = openAtt();
    const n = mkNote(a.w);
    const r1 = unwrap(await a.w.attachments.addFromBytes({}, n, PNG, 'one.png'));
    a.clock.t += 1000;
    const r2 = unwrap(await a.w.attachments.addFromBytes({}, n, makePdf('hello'), 'two.pdf'));
    expect(unwrap(a.w.attachments.listForNote(n)).map((r) => r.refId)).toEqual([r1.refId, r2.refId]);
    expect(unwrap(a.w.attachments.removeRef({}, r1.refId))).toEqual({ noteId: n });
    expect(unwrap(a.w.attachments.listForNote(n)).map((r) => r.refId)).toEqual([r2.refId]);
    expect(existsSync(blobPath(a, r1.sha256))).toBe(true);
    const last = a.w.store.db
      .prepare("SELECT op, entity_id FROM change_log WHERE entity = 'attachment_ref' ORDER BY seq DESC LIMIT 1")
      .get() as { op: string; entity_id: string };
    expect(last).toEqual({ op: 'purge', entity_id: r1.refId });
    expect(
      a.w.store.db.prepare('SELECT 1 FROM tombstones WHERE entity_id = ?').get(r1.refId),
    ).toBeDefined();
    expect(a.w.attachments.removeRef({}, r1.refId)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(a.w.attachments.listForNote('nope')).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
