import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { Result } from '../../src/result.ts';
import type { OpenOptions } from '../../src/store/store.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';
import { tmp } from '../store/helpers.ts';

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

export interface Ws {
  w: Workspace;
  path: string;
  clock: { t: number };
}
/** A workspace opened through openWorkspace with the DEFAULT guards (lock + integrity) unless overridden. */
export function openWs(opts: OpenOptions & { path?: string; clock?: { t: number } } = {}): Ws {
  const clock = opts.clock ?? { t: 1_700_000_000_000 };
  const path = opts.path ?? join(tmp(), 'w.db');
  const r = openWorkspace(path, { ...opts, clock: { now: () => clock.t } });
  const w = unwrap(r);
  open.push(w);
  return { w, path, clock };
}
/** Closes (checkpoints) a workspace early, e.g. before editing its file. */
export function closeWs(x: Ws): void {
  const i = open.indexOf(x.w);
  if (i >= 0) open.splice(i, 1);
  unwrap(x.w.close());
}

export const ids = (page: { hits: { noteId: string }[] }): string[] =>
  page.hits.map((h) => h.noteId);

/** Search that must succeed and be ready. */
export function find(
  w: Workspace,
  query: string,
  extra: Record<string, unknown> = {},
): ReturnType<Workspace['search']['search']> extends Result<infer P> ? P : never {
  const p = unwrap(w.search.search({ query, ...extra }));
  if (p.state !== 'ready') throw new Error(`search not ready: ${p.state}`);
  return p;
}

export const mkNote = (w: Workspace, title: string, body = '', folderId?: string | null): string =>
  unwrap(w.notes.create({}, { title, body, folderId })).id;
