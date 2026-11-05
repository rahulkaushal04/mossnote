import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach } from 'vitest';
import { nodeAttachFs, type AttachFs } from '../../src/attachments/fsport.ts';
import { blobPathIn } from '../../src/attachments/scan.ts';
import type { PdfTextExtractor } from '../../src/attachments/pdfText.ts';
import type { Result } from '../../src/result.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
export const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const MiB = 1024 * 1024;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const live: Workspace[] = [];
afterEach(() => {
  for (const w of live.splice(0)) w.close();
});

export interface AttOpts {
  dir?: string;
  fs?: AttachFs;
  /** undefined = extraction disabled (null); pass an extractor to enable. */
  pdf?: PdfTextExtractor | null;
  maxBytes?: () => number;
  chunkSize?: number;
  clock?: { t: number };
}
export interface Att {
  w: Workspace;
  dir: string;
  path: string;
  root: string;
  srcDir: string;
  clock: { t: number };
}

export function openAtt(o: AttOpts = {}): Att {
  const clock = o.clock ?? { t: 1_700_000_000_000 };
  const dir = o.dir ?? tmp();
  const path = join(dir, 'w.db');
  const attachments: Record<string, unknown> = { pdf: o.pdf === undefined ? null : o.pdf };
  if (o.fs) attachments.fs = o.fs;
  if (o.maxBytes) attachments.maxBytes = o.maxBytes;
  if (o.chunkSize) attachments.chunkSize = o.chunkSize;
  const w = unwrap(openWorkspace(path, { clock: { now: () => clock.t }, attachments }));
  live.push(w);
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  return { w, dir, path, root: join(dir, 'attachments'), srcDir, clock };
}

/** Closes a workspace early (to reopen the same directory). */
export function closeAtt(a: Att): void {
  const i = live.indexOf(a.w);
  if (i >= 0) live.splice(i, 1);
  unwrap(a.w.close());
}

/** Writes a source file the user "picked". */
export function put(a: Att, name: string, content: Uint8Array | string): string {
  const p = join(a.srcDir, name);
  writeFileSync(p, content);
  return p;
}

export const mkNote = (w: Workspace, title = 'Plan', body = ''): string =>
  unwrap(w.notes.create({}, { title, body })).id;

/** Relative paths of every file under `dir` (directories are not listed). */
export function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

export const blobPath = (a: Att, h: string): string => blobPathIn(a.root, h);

export const count = (w: Workspace, table: string): number =>
  (w.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** A file port that fails the n-th write and records read sizes. */
export function faultFs(inner: AttachFs = nodeAttachFs) {
  const state = { writes: 0, failAt: 0, code: 'ENOSPC', reads: [] as number[], unlinks: [] as string[] };
  const fs: AttachFs = {
    ...inner,
    write(fd, buf, len) {
      state.writes++;
      if (state.failAt && state.writes === state.failAt)
        throw Object.assign(new Error(`injected ${state.code}`), { code: state.code });
      inner.write(fd, buf, len);
    },
    read(fd, buf, len, pos) {
      const n = inner.read(fd, buf, len, pos);
      state.reads.push(n);
      return n;
    },
    unlink(p) {
      state.unlinks.push(p);
      inner.unlink(p);
    },
  };
  return {
    fs,
    state,
    failOnWrite(n: number, code = 'ENOSPC') {
      state.writes = 0;
      state.failAt = n;
      state.code = code;
    },
  };
}

/** An extractor with scripted behaviour. */
export function fakePdf(
  extract: (path: string) => Promise<{ text: string; pages: number; truncated: boolean }>,
): PdfTextExtractor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    extract(path) {
      calls.push(path);
      return extract(path);
    },
    dispose() {},
  };
}
export const textPdf = (text: string) =>
  fakePdf(() => Promise.resolve({ text, pages: 1, truncated: false }));

/** A minimal, valid one-page PDF whose text layer is `text` (ASCII, no parentheses). */
export function makePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 20 70 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('payload-of-a-png-for-tests'),
]);
