import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachmentUrl } from '../../src/attachments/links.ts';
import { tmp } from '../store/helpers.ts';
import { faultFs } from '../attachments/util.ts';
import { closeFx, count, openFx, must, PNG, seed, sha, snapshotNotes, T0, treeHash, write, type Fx } from './util.ts';

const exportTo = async (f: Fx, scope: { kind: 'all' } | { kind: 'notes'; ids: string[] } = { kind: 'all' }) => {
  const out = tmp();
  const r = must(await f.w.portability.export({ dir: out, scope }));
  return { out, r, root: join(out, r.folderName) };
};
const find = (dir: string, name: string): string[] => {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === name) hits.push(p);
      if (lstatSync(p).isDirectory()) walk(p);
    }
  };
  walk(dir);
  return hits;
};

describe('export (PT-1, PT-2, PT-9, PT-12)', () => {
  it('writes markdown with frontmatter, folders as directories, tags sorted, trashed items excluded, deterministic bytes', async () => {
    const f = openFx();
    const { noteIds, folderIds } = seed(f.w, 12);
    const trashedNote = must(f.w.notes.create({}, { title: 'Trashed one', body: 'gone' }));
    must(f.w.trash.trashNote({}, trashedNote.id));
    const trashedFolder = must(f.w.folders.create({}, { name: 'Gone folder' }));
    must(f.w.notes.create({}, { title: 'inside gone', body: 'x', folderId: trashedFolder.id }));
    must(f.w.trash.trashFolder({}, trashedFolder.id));
    must(f.w.folders.create({}, { name: 'Empty folder' }));
    const a = await exportTo(f);
    const b = await exportTo(f);
    expect(a.r.folderName).toBe('Mossnote export 2023-11-14');
    expect(a.r.notes).toBe(12);
    expect(treeHash(a.root)).toEqual(treeHash(b.root)); // same data, same bytes
    expect(readdirSync(a.out)).toEqual(['Mossnote export 2023-11-14']); // no temp left, nothing else
    const names = readdirSync(a.root).sort();
    expect(names).toContain('Projects');
    expect(names).toContain('Empty folder');
    expect(names).not.toContain('Gone folder');
    expect(names).toContain('mossnote-export.json');
    expect(find(a.root, 'Trashed one.md')).toEqual([]);
    expect(find(a.root, 'inside gone.md')).toEqual([]);
    expect(existsSync(join(a.root, 'Projects', 'Deep'))).toBe(true);
    const n0 = readFileSync(join(a.root, 'Note 0.md'), 'utf8'); // root note, tagged, favorite
    expect(n0).toBe(
      `---\nid: ${noteIds[0]}\ntitle: "Note 0"\ntags: ["alpha"]\nfavorite: true\ncreated: ${new Date(T0).toISOString()}\nupdated: ${new Date(T0).toISOString()}\n---\n# Note 0\nbody 0\n`,
    );
    expect(statSync(join(a.root, 'Note 0.md')).mtimeMs).toBe(T0);
    const manifest = JSON.parse(readFileSync(join(a.root, 'mossnote-export.json'), 'utf8')) as { folders: { path: string; id: string }[]; notes: number };
    expect(manifest.notes).toBe(12);
    expect(manifest.folders.map((x) => x.path)).toEqual(['Empty folder', 'Projects', 'Projects/Deep']);
    expect(manifest.folders.find((x) => x.path === 'Projects')!.id).toBe(folderIds[0]);
    // a second export of the same day does not overwrite the first
    expect(a.out).not.toBe(b.out);
    const again = must(await f.w.portability.export({ dir: a.out, scope: { kind: 'all' } }));
    expect(again.folderName).toBe('Mossnote export 2023-11-14 (2)');
  });

  it('filenames: separators, ".." , reserved names and collisions are sanitized; nothing escapes the export folder', async () => {
    const f = openFx();
    for (const title of ['../../etc/passwd', 'a/b', 'CON', 'Same', 'same', 'SAME', '_attachments', 'mossnote-export', '.hidden', '', 'x'.repeat(400)])
      must(f.w.notes.create({}, { title, body: `body of ${title.slice(0, 8)}` }));
    const parent = tmp();
    const out = join(parent, 'dest');
    mkdirSync(out);
    const r = must(await f.w.portability.export({ dir: out, scope: { kind: 'all' } }));
    const root = join(out, r.folderName);
    const files = readdirSync(root).sort();
    expect(files.filter((n) => n.endsWith('.md'))).toHaveLength(11);
    for (const n of files) {
      expect(n).not.toMatch(/[\\/]/);
      expect(Buffer.byteLength(n)).toBeLessThanOrEqual(255);
    }
    expect(files).toContain('_CON.md');
    // names are assigned in (title, id) order: 'SAME' < 'Same' < 'same'
    expect(files).toContain('SAME.md');
    expect(files).toContain('Same (2).md');
    expect(files).toContain('same (3).md');
    expect(files).toContain('a-b.md');
    expect(readdirSync(out)).toEqual([r.folderName]);
    expect(readdirSync(parent)).toEqual(['dest']);
  });

  it('attachments: links are rewritten to relative _attachments paths and the files are copied verified; launchable extensions never appear', async () => {
    const f = openFx();
    const n = must(f.w.notes.create({}, { title: 'With files', body: 'x' }));
    const png = must(await f.w.attachments.addFromBytes({}, n.id, PNG, 'pic.png'));
    const script = must(await f.w.attachments.addFromBytes({}, n.id, Buffer.from('#!/bin/sh\necho hi\n'), 'run.command'));
    must(f.w.notes.update({}, n.id, { body: `![pic](${png.url})\n[tool](${script.url})\n[missing](${attachmentUrl('b'.repeat(64))})` }));
    const sub = must(f.w.folders.create({}, { name: 'Sub' }));
    const m = must(f.w.notes.create({}, { title: 'Nested', body: `![pic](${png.url})`, folderId: sub.id }));
    const { root, r } = await exportTo(f);
    expect(r.attachments).toBe(2);
    const top = readFileSync(join(root, 'With files.md'), 'utf8');
    expect(top).toContain(`![pic](_attachments/${png.sha256}.png)`);
    expect(top).toContain(`[tool](_attachments/${script.sha256}.dat)`);
    expect(top).toContain(attachmentUrl('b'.repeat(64))); // unknown blob: left as is
    expect(readFileSync(join(root, 'Sub', 'Nested.md'), 'utf8')).toContain(`![pic](../_attachments/${png.sha256}.png)`);
    expect(sha(readFileSync(join(root, '_attachments', `${png.sha256}.png`)))).toBe(png.sha256);
    expect(readdirSync(join(root, '_attachments')).some((x) => x.endsWith('.command'))).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
    void m;
  });

  it('scope notes exports only the chosen notes (with the folders they need)', async () => {
    const f = openFx();
    const { noteIds } = seed(f.w, 9);
    const chosen = [noteIds[1]!, noteIds[2]!];
    const { root, r } = await exportTo(f, { kind: 'notes', ids: chosen });
    expect(r.notes).toBe(2);
    const all = find(root, 'Note 1.md').concat(find(root, 'Note 2.md'));
    expect(all).toHaveLength(2);
    expect(find(root, 'Note 3.md')).toEqual([]);
  });

  it('refuses a target inside the workspace folder and a relative target', async () => {
    const f = openFx();
    seed(f.w, 1);
    expect(await f.w.portability.export({ dir: f.dir, scope: { kind: 'all' } })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await f.w.portability.export({ dir: join(f.dir, 'backups'), scope: { kind: 'all' } })).toMatchObject({ ok: false });
    expect(await f.w.portability.export({ dir: 'relative', scope: { kind: 'all' } })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(readdirSync(f.dir).filter((n) => n.startsWith('.export'))).toEqual([]);
  });

  it('PT-12: disk-full and permission errors at several write steps leave no output and a clear message', async () => {
    for (const n of [1, 3, 7]) {
      for (const code of ['ENOSPC', 'EACCES']) {
        const ff = faultFs();
        const f = openFx({ portability: { fs: ff.fs } });
        seed(f.w, 6);
        const out = tmp();
        ff.failOnWrite(n, code);
        const r = await f.w.portability.export({ dir: out, scope: { kind: 'all' } });
        expect(r, `${code} at write ${n}`).toMatchObject({ ok: false, error: { code: 'io' } });
        expect(!r.ok && r.error.message).toMatch(code === 'ENOSPC' ? /disk space/i : /permission/i);
        expect(readdirSync(out)).toEqual([]);
        expect(readdirSync(f.dir).filter((x) => x.startsWith('.export'))).toEqual([]);
      }
    }
  });
});

describe('round trip (PT-3)', () => {
  it('1k notes: text, titles, folders, tags, favorites and timestamps survive export + import into an empty workspace', async () => {
    const a = openFx();
    const folderA = must(a.w.folders.create({}, { name: 'Café' }));
    const folderB = must(a.w.folders.create({}, { name: 'cafe?*', parentId: folderA.id }));
    const folderC = must(a.w.folders.create({}, { name: 'Other' }));
    const tags = ['alpha', 'Beta tag', 'ü'].map((t) => must(a.w.tags.create({}, t)));
    const bodies = ['', 'plain', 'CRLF\r\nline\r\nend\r\n', 'trailing spaces   \n\n  ', '---\nlooks like front matter\n---\n', 'émoji 😀 tab\there?', '# Heading\n\n- [ ] task\n'];
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      a.clock.t = T0 + i * 1000;
      const title = i % 50 === 0 ? `Dup title` : i % 7 === 0 ? `Title "q" \\ / ${i}` : `Note ${i} ✓`;
      const folderId = [null, folderA.id, folderB.id, folderC.id][i % 4]!;
      const note = must(a.w.notes.create({}, { title, body: bodies[i % bodies.length]! + String(i), folderId }));
      ids.push(note.id);
      if (i % 3 === 0) must(a.w.tags.tagNote({}, note.id, tags[i % 3]!.id));
      if (i % 5 === 0) must(a.w.tags.tagNote({}, note.id, tags[2]!.id));
      if (i % 6 === 0) must(a.w.notes.setFavorite({}, note.id, true));
    }
    const { root } = await exportTo(a);

    const b = openFx({ clock: { t: T0 + 2 * 86_400_000 } });
    const r = must(await b.w.portability.import({ dir: root }));
    expect(r).toMatchObject({ added: 1000, skipped: 0, resumed: false, folderName: 'Imported 2023-11-16' });
    const top = b.w.store.db.prepare("SELECT id, name FROM folders WHERE parent_id IS NULL").all() as { id: string; name: string }[];
    expect(top.map((x) => x.name)).toEqual(['Imported 2023-11-16']);
    expect(snapshotNotes(b.w, 'Imported 2023-11-16')).toEqual(snapshotNotes(a.w));
    const idsB = new Set((b.w.store.db.prepare('SELECT id FROM notes').all() as { id: string }[]).map((x) => x.id));
    expect(ids.some((i) => idsB.has(i))).toBe(false); // always new ULIDs
    expect(count(b.w, 'notes')).toBe(1000);
    // one change-log row per entity changed, nothing else
    const log = b.w.store.db.prepare("SELECT entity, count(*) AS n FROM change_log GROUP BY entity ORDER BY entity").all() as { entity: string; n: number }[];
    expect(Object.fromEntries(log.map((x) => [x.entity, x.n]))).toMatchObject({ note: 1000, folder: 4, tag: 3 });
    // the rest of the workspace works: search is consistent after the import
    expect(must(b.w.search.verify()).ok).toBe(true);
    expect(b.w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
    // the report file and no staging file are left
    expect(existsSync(join(b.dir, 'import-report.json'))).toBe(true);
    expect(readdirSync(b.dir).filter((n) => n.startsWith('.import-'))).toEqual([]);
    expect(b.w.store.db.prepare("SELECT 1 FROM meta WHERE key LIKE 'import_%'").get()).toBeUndefined();
  }, 180_000);
});

describe('import hostile input (PT-4)', () => {
  it('skips or repairs with a per-file report; never follows symlinks, never writes outside the workspace', async () => {
    const outside = tmp();
    write(outside, 'secret.md', 'SECRET OUTSIDE');
    write(outside, 'dir/also.md', 'SECRET DIR');
    const src = tmp();
    write(src, 'ok.md', '# Fine\nbody');
    write(src, 'bad-utf8.md', Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x41]));
    write(src, 'bom.md', '﻿# With BOM\nx');
    write(src, 'malformed.md', '---\nnot yaml at all\n---\nbody stays');
    write(src, 'unknown.md', '---\ntitle: "Known"\nlayout: post\n---\nbody');
    write(src, 'big.md', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    write(src, '.hidden.md', 'hidden');
    write(src, '.git/x.md', 'git');
    write(src, 'sub/ok2.md', 'second');
    write(src, 'we ird: name?.md', 'odd name');
    write(src, '_attachments/pic.png', PNG);
    write(src, 'withimg.md', '# withimg\n![x](_attachments/pic.png)\n![o](../../outside.png)\n![a](/etc/passwd)\n[w](https://example.com/a.png)\n');
    symlinkSync(join(outside, 'secret.md'), join(src, 'escape.md'));
    symlinkSync(join(outside, 'dir'), join(src, 'linkdir'));
    symlinkSync('..', join(src, 'up'));
    let fifo = true;
    try {
      execFileSync('mkfifo', [join(src, 'pipe.md')]);
    } catch {
      fifo = false;
    }
    let deep = src;
    for (let i = 0; i < 60; i++) deep = join(deep, `d${i}`);
    write(deep, 'deep.md', 'too deep');
    write(join(src, 'd0', 'd1', 'd2'), 'shallow.md', 'shallow');
    const before = treeHash(src);
    const outsideBefore = treeHash(outside);

    const f = openFx();
    const r = must(await f.w.portability.import({ dir: src }));
    expect(treeHash(src)).toEqual(before);
    expect(treeHash(outside)).toEqual(outsideBefore);
    const row = (rel: string) => r.files.find((x) => x.rel === rel);
    expect(row('ok.md')).toMatchObject({ status: 'added' });
    expect(row('bad-utf8.md')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/UTF-8/) });
    expect(row('bom.md')).toMatchObject({ status: 'added' });
    expect(row('malformed.md')).toMatchObject({ status: 'repaired' });
    expect(row('unknown.md')).toMatchObject({ status: 'added' });
    expect(row('big.md')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/10 MB/) });
    expect(row('.hidden.md')).toMatchObject({ status: 'skipped' });
    expect(row('.git')).toMatchObject({ status: 'skipped' });
    for (const link of ['escape.md', 'linkdir', 'up']) expect(row(link), link).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/symbolic/) });
    if (fifo) expect(row('pipe.md')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/regular/) });
    expect(row('d0/d1/d2/shallow.md')).toMatchObject({ status: 'added' });
    expect(r.files.some((x) => x.rel.endsWith('deep.md') && x.status !== 'skipped')).toBe(false);
    expect(r.files.some((x) => /too deeply/.test(x.reason))).toBe(true);

    const q = (sql: string, ...p: unknown[]) => f.w.store.db.prepare(sql).all(...p) as Record<string, unknown>[];
    expect(q("SELECT 1 FROM notes WHERE body LIKE '%SECRET%'")).toEqual([]);
    expect(q("SELECT body FROM notes WHERE title = 'With BOM'")).toEqual([{ body: '# With BOM\nx' }]);
    expect(q("SELECT 1 FROM notes WHERE body = 'too deep'")).toEqual([]);
    expect(q("SELECT title FROM notes WHERE body = 'body stays'").length).toBe(0); // body is the whole text, front matter included
    expect(q("SELECT 1 FROM notes WHERE body LIKE '%body stays%'")).toHaveLength(1);
    expect(q("SELECT title FROM notes WHERE body LIKE '%layout: post%'")).toEqual([{ title: 'Known' }]);
    // depth stays inside the 50-level limit including the Imported folder
    const depth = (f.w.store.db.prepare(`WITH RECURSIVE t(id, d) AS (SELECT id, 1 FROM folders WHERE parent_id IS NULL UNION ALL SELECT f.id, t.d + 1 FROM folders f JOIN t ON f.parent_id = t.id) SELECT max(d) AS m FROM t`).get() as { m: number }).m;
    expect(depth).toBeLessThanOrEqual(50);

    // attachments: only the link inside the root was resolved, hash-checked and stored through the API
    const img = q("SELECT id, body FROM notes WHERE title = 'withimg'")[0] as { id: string; body: string };
    expect(img.body).toContain(`![x](${attachmentUrl(sha(PNG))})`);
    expect(img.body).toContain('![o](../../outside.png)');
    expect(img.body).toContain('![a](/etc/passwd)');
    expect(img.body).toContain('(https://example.com/a.png)');
    expect(must(f.w.attachments.listForNote(img.id)).map((x) => x.sha256)).toEqual([sha(PNG)]);
    expect(readdirSync(f.dir).filter((n) => n.startsWith('.import-'))).toEqual([]);
  }, 120_000);

  it('caps: file, folder and depth limits stop the scan with a report instead of crashing', async () => {
    const src = tmp();
    for (let i = 0; i < 8; i++) write(src, `n${i}.md`, `note ${i}`);
    const f = openFx({ portability: { importLimits: { maxFiles: 5 } } });
    const r = must(await f.w.portability.import({ dir: src }));
    expect(r.stoppedEarly).toMatch(/5 files/);
    expect(r.added).toBe(5);
    expect(r.files.some((x) => x.rel === '.' && x.status === 'skipped')).toBe(true);
    const g = openFx({ portability: { importLimits: { maxDirs: 2, maxDepth: 2 } } });
    const s2 = tmp();
    write(s2, 'a/b/c/deep.md', 'x');
    write(s2, 'a/ok.md', 'y');
    write(s2, 'b/ok.md', 'z');
    write(s2, 'c/ok.md', 'w');
    const r2 = must(await g.w.portability.import({ dir: s2 }));
    expect(r2.stoppedEarly ?? r2.files.map((x) => x.reason).join()).toMatch(/folders|deeply/);
  });

  it('refuses the workspace folder and a folder that contains it', async () => {
    const f = openFx();
    expect(await f.w.portability.import({ dir: f.dir })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await f.w.portability.import({ dir: join(f.dir, '..') })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await f.w.portability.import({})).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await f.w.portability.import({ dir: 'relative' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('plain markdown with and without frontmatter, nested folders, timestamps from frontmatter', async () => {
    const src = tmp();
    write(src, 'plain.md', '# Plain title\ntext');
    write(src, 'Folder One/with fm.md', '---\nid: 01HZXK7Y3Q9V5N2M4P6R8T0WAB\ntitle: "From FM"\ntags: ["x", "Y"]\nfavorite: true\ncreated: 2020-01-02T03:04:05.000Z\nupdated: 2021-02-03T04:05:06.000Z\n---\nthe body\n');
    const f = openFx();
    must(await f.w.portability.import({ dir: src }));
    const n = f.w.store.db.prepare("SELECT id, title, favorite, created_at, updated_at, body FROM notes WHERE title = 'From FM'").get() as { id: string; favorite: number; created_at: number; updated_at: number; body: string };
    expect(n).toMatchObject({ favorite: 1, created_at: Date.parse('2020-01-02T03:04:05.000Z'), updated_at: Date.parse('2021-02-03T04:05:06.000Z'), body: 'the body\n' });
    expect(n.id).not.toBe('01HZXK7Y3Q9V5N2M4P6R8T0WAB'); // M5: new ids always
    expect(must(f.w.tags.listForNote(n.id)).map((t) => t.name)).toEqual(['x', 'Y']);
    expect(f.w.store.db.prepare("SELECT title FROM notes WHERE body = '# Plain title\ntext'").get()).toEqual({ title: 'Plain title' });
  });
});

describe('import resume (PT-5, M4, M5)', () => {
  for (const crashAt of ['folders', 'batch:0', 'batch:2', 'attachment:1']) {
    it(`a crash at ${crashAt} resumes without duplicates`, async () => {
      const src = tmp();
      for (let i = 0; i < 35; i++) write(src, `${i % 3 === 0 ? 'sub/' : ''}n${i}.md`, `---\ntitle: "Note ${i}"\ntags: ["t${i % 4}"]\n---\nbody ${i}${i === 7 ? '\n![p](_attachments/pic.png)' : ''}`);
      write(src, '_attachments/pic.png', PNG);
      const f = openFx({ portability: { importLimits: { batchNotes: 10 } } });
      let fired = false;
      const first = await f.w.portability.import({
        dir: src,
        hook: (l) => {
          if (l === crashAt && !fired) {
            fired = true;
            throw new Error('simulated crash');
          }
        },
      });
      expect(fired).toBe(true);
      expect(first.ok).toBe(false);
      expect(f.w.portability.hasPendingImport()).toBe(true);
      const midNotes = count(f.w, 'notes');
      expect(midNotes).toBe({ folders: 0, 'batch:0': 10, 'batch:2': 30, 'attachment:1': 35 }[crashAt]);
      expect(f.w.store.db.pragma('integrity_check', { simple: true })).toBe('ok');
      // restart: resume (the picked folder is not needed)
      const second = must(await f.w.portability.import({}));
      expect(second).toMatchObject({ resumed: true, added: 35 });
      expect(count(f.w, 'notes')).toBe(35);
      expect(count(f.w, 'folders')).toBe(2); // Imported + sub
      expect(count(f.w, 'tags')).toBe(4);
      expect(count(f.w, 'versions')).toBe(35);
      expect((f.w.store.db.prepare('SELECT count(DISTINCT title) AS n FROM notes').get() as { n: number }).n).toBe(35);
      expect(count(f.w, 'note_attachments')).toBe(1);
      expect(f.w.portability.hasPendingImport()).toBe(false);
      expect(readdirSync(f.dir).filter((n) => n.startsWith('.import-'))).toEqual([]);
      // nothing to resume any more
      expect(await f.w.portability.import({})).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(count(f.w, 'notes')).toBe(35);
      expect(must(f.w.search.verify()).ok).toBe(true);
    });
  }

  it('a restart of the whole process (reopen) also resumes; an unfinished scan is swept, not resumed', async () => {
    const src = tmp();
    for (let i = 0; i < 12; i++) write(src, `n${i}.md`, `body ${i}`);
    const f = openFx({ portability: { importLimits: { batchNotes: 5 } } });
    await f.w.portability.import({ dir: src, hook: (l) => { if (l === 'batch:0') throw new Error('crash'); } });
    writeFileSync(join(f.dir, '.import-01HZXK7Y3Q9V5N2M4P6R8T0WAB.sqlite'), 'half written scan'); // not "ready"
    const dir = f.dir;
    closeFx(f);
    const g = openFx({ dir, portability: { importLimits: { batchNotes: 5 } } });
    expect(readdirSync(dir).filter((n) => n.startsWith('.import-'))).toHaveLength(1); // the junk one was swept
    expect(g.w.portability.hasPendingImport()).toBe(true);
    must(await g.w.portability.import({}));
    expect(count(g.w, 'notes')).toBe(12);
  });
});
