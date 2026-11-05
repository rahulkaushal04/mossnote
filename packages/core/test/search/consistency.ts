import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import type { Db } from '../../src/db/types.ts';
import { sha256 } from '../../src/db/hash.ts';
import { openWorkspace, type Workspace } from '../../src/workspace.ts';

/**
 * SR-2 machinery: random write sequences against a real workspace, then every generated query must
 * return exactly what a brute-force matcher computes from the raw tables. The matcher shares NO
 * code with search/query.ts: it evaluates a small query AST itself, and the AST is rendered to
 * a query string separately here. Not a test file (no tests are declared); see consistency.property.test.ts.
 */

export const VOCAB = [
  'alpha', 'beta', 'café', 'cafe', 'Zürich', 'zurich', 'Ångström', 'naïve', 'delta', 'omega',
  'quartz', 'fern', 'ember', 'river', 'gamma', 'stone', 'École', 'ecole', 'plum', 'kiwi',
]; // prettier-ignore

type Words = number[];
export type Cmd =
  | { k: 'create'; t: Words; b: Words; f: number }
  | { k: 'update'; n: number; t: Words; b: Words; save: boolean }
  | { k: 'move'; n: number; f: number }
  | { k: 'fav'; n: number }
  | { k: 'trashNote'; n: number }
  | { k: 'trashFolder'; f: number }
  | { k: 'restore'; i: number }
  | { k: 'purge'; i: number }
  | { k: 'mkFolder'; p: number }
  | { k: 'mkTag'; w: number }
  | { k: 'tag'; n: number; t: number }
  | { k: 'untag'; n: number; t: number }
  | { k: 'ntMove'; n: number; t: number; t2: number }
  | { k: 'rename'; t: number; w: number; merge: boolean }
  | { k: 'verRestore'; n: number; v: number }
  | {
      k: 'remote';
      n: number;
      mode: 'replace' | 'ignore' | 'upsert' | 'insert';
      t: Words;
      b: Words;
    };

const nat = fc.nat(1000);
const words = fc.array(fc.nat(VOCAB.length - 1), { minLength: 0, maxLength: 6 });
export const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ k: fc.constant('create' as const), t: words, b: words, f: nat }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant('update' as const), n: nat, t: words, b: words, save: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('move' as const), n: nat, f: nat }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('fav' as const), n: nat }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('trashNote' as const), n: nat }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('trashFolder' as const), f: nat }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('restore' as const), i: nat }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('purge' as const), i: nat }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('mkFolder' as const), p: nat }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant('mkTag' as const), w: nat }) },
  { weight: 8, arbitrary: fc.record({ k: fc.constant('tag' as const), n: nat, t: nat }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('untag' as const), n: nat, t: nat }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('ntMove' as const), n: nat, t: nat, t2: nat }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant('rename' as const), t: nat, w: nat, merge: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('verRestore' as const), n: nat, v: nat }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('remote' as const), n: nat, mode: fc.constantFrom('replace', 'ignore', 'upsert', 'insert') as fc.Arbitrary<'replace'>, t: words, b: words }) },
); // prettier-ignore

export type Item = {
  t: 'term' | 'prefix' | 'phrase' | 'not' | 'tag';
  a: number;
  b: number;
  n: number;
};
export interface QuerySpec {
  items: Item[];
  trash: boolean;
}
export const caseArb: fc.Arbitrary<Case> = fc.record({
  cmds: fc.array(cmdArb, { minLength: 1, maxLength: 25 }),
  queries: fc.array(
    fc.record({
      items: fc.array(
        fc.record({
          t: fc.constantFrom('term', 'term', 'prefix', 'phrase', 'not', 'tag') as fc.Arbitrary<Item['t']>,
          a: nat,
          b: nat,
          n: nat,
        }),
        { minLength: 1, maxLength: 3 },
      ),
      trash: fc.integer({ min: 0, max: 5 }).map((x) => x === 0),
    }),
    { minLength: 4, maxLength: 8 },
  ),
}); // prettier-ignore
export interface Case {
  cmds: Cmd[];
  queries: QuerySpec[];
}

// ---- the oracle ------------------------------------------------------------------------------
// Re-implemented here on purpose: the oracle must not share code with the engine it checks.
const tagKey = (name: string): string => name.normalize('NFKC').toLowerCase();
const titleSortKey = (t: string): string =>
  t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const toks = (s: string): string[] =>
  norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const surface = (s: string): string[] => s.match(/[\p{L}\p{N}]+/gu) ?? [];

interface Doc {
  id: string;
  trashed: boolean;
  cols: string[][]; // title, body, tags (normalised tokens)
  raw: string[]; // surface text per column
  tagKeys: Set<string>;
  tagIds: Set<string>;
  title: string;
  folder: string | null;
  fav: boolean;
  created: number;
  updated: number;
}
type Snap = ReturnType<typeof snapshot>;

function snapshot(db: Db) {
  const folders = db.prepare('SELECT id, parent_id, trashed_at FROM folders').all() as {
    id: string; parent_id: string | null; trashed_at: number | null; }[]; // prettier-ignore
  const fById = new Map(folders.map((f) => [f.id, f]));
  const trashedFolder = (id: string | null): boolean => {
    for (let i = 0; id !== null && i < 100; i++) {
      const f = fById.get(id);
      if (!f || f.trashed_at !== null) return true;
      id = f.parent_id;
    }
    return false;
  };
  const tagRows = db
    .prepare('SELECT nt.note_id AS n, t.id AS tid, t.name AS name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id ORDER BY t.name_key')
    .all() as { n: string; tid: string; name: string }[]; // prettier-ignore
  const tagsOf = new Map<string, string[]>();
  const tagIdsOf = new Map<string, Set<string>>();
  for (const r of tagRows) {
    tagsOf.set(r.n, [...(tagsOf.get(r.n) ?? []), r.name]);
    tagIdsOf.set(r.n, (tagIdsOf.get(r.n) ?? new Set()).add(r.tid));
  }
  const notes = db.prepare('SELECT id, title, body, folder_id, trashed_at, favorite, created_at, updated_at FROM notes ORDER BY id').all() as {
    id: string; title: string; body: string; folder_id: string | null; trashed_at: number | null;
    favorite: number; created_at: number; updated_at: number; }[]; // prettier-ignore
  const docs = notes.map((n): Doc => {
    const tags = tagsOf.get(n.id) ?? [];
    const raw = [n.title, n.body, tags.join(' ')];
    return {
      id: n.id,
      trashed: n.trashed_at !== null || trashedFolder(n.folder_id),
      cols: raw.map(toks),
      raw,
      tagKeys: new Set(tags.map(tagKey)),
      tagIds: tagIdsOf.get(n.id) ?? new Set(),
      title: n.title,
      folder: n.folder_id,
      fav: n.favorite === 1,
      created: n.created_at,
      updated: n.updated_at,
    };
  });
  const tagRowsAll = db.prepare('SELECT id, name FROM tags ORDER BY id').all() as {
    id: string;
    name: string;
  }[];
  return {
    docs,
    tagNames: tagRowsAll.map((t) => t.name),
    tagIds: tagRowsAll.map((t) => t.id),
    folders: folders.map((f) => ({ id: f.id, parent: f.parent_id })),
  };
}

const variant = (w: string, n: number): string =>
  n % 3 === 0 ? w : n % 3 === 1 ? w.toUpperCase() : w.normalize('NFD');
const has = (d: Doc, token: string): boolean => d.cols.some((c) => c.includes(token));
const hasPrefix = (d: Doc, p: string): boolean =>
  d.cols.some((c) => c.some((t) => t.startsWith(p)));
const hasPhrase = (d: Doc, ph: string[]): boolean =>
  d.cols.some((c) => c.some((_, i) => ph.every((t, j) => c[i + j] === t)));

/** Renders one query and its expected id set, drawing words from the actual corpus. */
export function expectedFor(
  spec: QuerySpec,
  snap: Snap,
): { query: string; scope: 'all' | 'trash'; ids: string[] } | undefined {
  const pool = snap.docs.filter((d) => d.trashed === spec.trash);
  if (!pool.length && !snap.tagNames.length) return undefined;
  const parts: string[] = [];
  const preds: ((d: Doc) => boolean)[] = [];
  let positive = false;
  for (const it of spec.items) {
    const doc = (pool.length ? pool : snap.docs)[it.a % (pool.length || snap.docs.length)];
    const ws = doc ? doc.raw.flatMap(surface) : [];
    const w = ws[it.b % Math.max(ws.length, 1)];
    if (it.t === 'tag') {
      const name = snap.tagNames[it.a % Math.max(snap.tagNames.length, 1)];
      if (!name || surface(name).length !== 1 || surface(name)[0] !== name) continue;
      parts.push(`tag:${variant(name, it.n)}`);
      preds.push((d) => d.tagKeys.has(tagKey(name)));
      positive = true;
      continue;
    }
    if (!w) continue;
    const token = toks(w)[0]!;
    if (it.t === 'term') {
      parts.push(variant(w, it.n));
      preds.push((d) => has(d, token));
      positive = true;
    } else if (it.t === 'not') {
      parts.push(`-${variant(w, it.n)}`);
      preds.push((d) => !has(d, token));
    } else if (it.t === 'prefix') {
      const len = 2 + (it.n % Math.max(token.length - 1, 1));
      const p = token.slice(0, len);
      if (p.length < 2) continue;
      parts.push(`${p}*`);
      preds.push((d) => hasPrefix(d, p));
      positive = true;
    } else {
      // phrase: two adjacent tokens of one column
      const col = doc!.cols.find((c) => c.length >= 2);
      if (!col) continue;
      const i = it.b % (col.length - 1);
      const ph = [col[i]!, col[i + 1]!];
      parts.push(`"${ph.join(' ')}"`);
      preds.push((d) => hasPhrase(d, ph));
      positive = true;
    }
  }
  if (!parts.length) return undefined;
  void positive;
  const want = snap.docs.filter((d) => d.trashed === spec.trash && preds.every((p) => p(d)));
  return {
    query: parts.join(' '),
    scope: spec.trash ? 'trash' : 'all',
    ids: want.map((d) => d.id).sort(),
  };
}

// ---- filters, scopes, sorts and the stash ------------------------------------------------------
interface Probe {
  name: string;
  params: Record<string, unknown>;
  pred: (d: Doc) => boolean;
  /** Present when the result ORDER is part of the contract. */
  order?: (a: Doc, b: Doc) => number;
}
const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Runs filter, scope and sort probes over one common word and compares with the brute force. */
function probeFilters(w: Workspace, snap: Snap): string | undefined {
  const live = snap.docs.filter((d) => !d.trashed);
  const freq = new Map<string, number>();
  for (const d of live) for (const t of new Set(d.cols.flat())) freq.set(t, (freq.get(t) ?? 0) + 1);
  const word = [...freq.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0];
  if (!word) return undefined;
  const children = (id: string): string[] =>
    snap.folders.filter((f) => f.parent === id).map((f) => f.id);
  const subtree = (root: string): Set<string> => {
    const out = new Set<string>();
    const stack = [root];
    while (stack.length) {
      const f = stack.pop()!;
      if (!out.has(f)) {
        out.add(f);
        stack.push(...children(f));
      }
    }
    return out;
  };
  const probes: Probe[] = [
    { name: 'filter favorite', params: { filters: { favorite: true } }, pred: (d) => d.fav },
    { name: 'filter not favorite', params: { filters: { favorite: false } }, pred: (d) => !d.fav },
    { name: 'scope favorites', params: { scope: { kind: 'favorites' } }, pred: (d) => d.fav },
  ];
  const [t1, t2] = snap.tagIds;
  if (t1) {
    probes.push({
      name: 'filter tag',
      params: { filters: { tagIds: [t1] } },
      pred: (d) => d.tagIds.has(t1),
    });
    probes.push({
      name: 'scope tag',
      params: { scope: { kind: 'tag', id: t1 } },
      pred: (d) => d.tagIds.has(t1),
    });
  }
  if (t1 && t2)
    probes.push({
      name: 'filter two tags (AND)',
      params: { filters: { tagIds: [t1, t2] } },
      pred: (d) => d.tagIds.has(t1) && d.tagIds.has(t2),
    });
  const mid = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const cMid = mid(live.map((d) => d.created));
  const uMid = mid(live.map((d) => d.updated));
  probes.push(
    {
      name: 'createdFrom',
      params: { filters: { createdFrom: cMid } },
      pred: (d) => d.created >= cMid,
    },
    { name: 'createdTo', params: { filters: { createdTo: cMid } }, pred: (d) => d.created <= cMid },
    {
      name: 'updatedFrom',
      params: { filters: { updatedFrom: uMid } },
      pred: (d) => d.updated >= uMid,
    },
    { name: 'updatedTo', params: { filters: { updatedTo: uMid } }, pred: (d) => d.updated <= uMid },
    {
      name: 'created window',
      params: { filters: { createdFrom: cMid, createdTo: cMid } },
      pred: (d) => d.created === cMid,
    },
  );
  for (const f of snap.folders.slice(0, 4)) {
    const sub = subtree(f.id);
    const inSub = (d: Doc): boolean => d.folder !== null && sub.has(d.folder);
    probes.push({
      name: 'scope folder subtree',
      params: { scope: { kind: 'folder', id: f.id } },
      pred: inSub,
    });
    probes.push({
      name: 'filter folderIds subtree',
      params: { filters: { folderIds: [f.id] } },
      pred: inSub,
    });
  }
  for (const dir of ['asc', 'desc'] as const) {
    const sgn = dir === 'asc' ? 1 : -1;
    const by = (key: (d: Doc) => string | number) => (a: Doc, b: Doc) =>
      sgn * cmp(key(a), key(b)) || cmp(a.id, b.id); // ties always by id ascending
    probes.push(
      {
        name: `sort updated ${dir}`,
        params: { sort: 'updated', dir },
        pred: () => true,
        order: by((d) => d.updated),
      },
      {
        name: `sort created ${dir}`,
        params: { sort: 'created', dir },
        pred: () => true,
        order: by((d) => d.created),
      },
      {
        name: `sort title ${dir}`,
        params: { sort: 'title', dir },
        pred: () => true,
        order: by((d) => titleSortKey(d.title)),
      },
    );
  }
  for (const pr of probes) {
    const got = w.search.search({ query: word, limit: 100, ...pr.params });
    if (!got.ok) return `probe ${pr.name} failed: ${got.error.message}`;
    if (got.value.state !== 'ready') return 'index not ready';
    const want = live.filter((d) => d.cols.some((c) => c.includes(word)) && pr.pred(d));
    if (pr.order) want.sort(pr.order);
    else want.sort((a, b) => cmp(a.id, b.id));
    const ids = got.value.hits.map((h) => h.noteId);
    if (!pr.order) ids.sort();
    if (JSON.stringify(ids) !== JSON.stringify(want.map((d) => d.id)))
      return `probe ${pr.name} word ${JSON.stringify(word)}: got ${ids.length} expected ${want.length} (or wrong order)`;
  }
  return undefined;
}

/** The stash may only hold the CURRENT text of a live note (left by an ignored insert); never deleted or older text. */
function stashProblem(db: Db): string | undefined {
  const x = (t: string): string => t.replaceAll('\u0002', ' ').replaceAll('\u0003', ' ');
  const rows = db.prepare('SELECT note_id, title, body FROM search_stash').all() as {
    note_id: string; title: string; body: string; }[]; // prettier-ignore
  const cur = new Map(
    db
      .prepare('SELECT id, title, body FROM notes')
      .all()
      .map((r) => [(r as { id: string }).id, r as { title: string; body: string }]),
  );
  for (const r of rows) {
    const n = cur.get(r.note_id);
    if (!n) return `search_stash retains text of a deleted note ${r.note_id}`;
    if (r.title !== x(n.title) || r.body !== x(n.body))
      return `search_stash holds stale text for ${r.note_id}`;
  }
  return undefined;
}

// ---- running a case --------------------------------------------------------------------------
const U = (n: number) => `01HF7YAT00${String(n).padStart(16, '0')}`;
const PEER = U(900);
const hlcOf = (seq: number) => `000001700000000-${String(6 + seq).padStart(10, '0')}`;

function apply(w: Workspace, clock: { t: number }, c: Cmd, seqRef: { n: number }): void {
  const db = w.store.db;
  const col = (sql: string): string[] =>
    (db.prepare(sql).all() as { id: string }[]).map((r) => r.id);
  const notes = col('SELECT id FROM notes ORDER BY id');
  const folders = col('SELECT id FROM folders ORDER BY id');
  const tags = col('SELECT id FROM tags ORDER BY id');
  const pick = <T>(l: T[], i: number): T | undefined => l[i % Math.max(l.length, 1)];
  const text = (ws: Words, sep = ' '): string => ws.map((i) => VOCAB[i]!).join(sep);
  clock.t += 7 * 60_000; // beyond the version throttle, so edits make versions
  const r = ((): { ok: boolean; error?: { code: string; message: string } } => {
    switch (c.k) {
      case 'create': {
        const f = c.f % (folders.length + 1);
        return w.notes.create(
          {},
          { title: text(c.t), body: text(c.b, ', '), folderId: f === 0 ? null : folders[f - 1] },
        );
      }
      case 'update': {
        const n = pick(notes, c.n);
        if (!n) return { ok: true };
        const input = { title: text(c.t), body: text(c.b, '\n') };
        return c.save ? w.notes.save({}, n, input) : w.notes.update({}, n, input);
      }
      case 'move': {
        const n = pick(notes, c.n);
        const f = c.f % (folders.length + 1);
        return n ? w.notes.move({}, n, f === 0 ? null : folders[f - 1]!) : { ok: true };
      }
      case 'fav': {
        const n = pick(notes, c.n);
        return n ? w.notes.setFavorite({}, n, true) : { ok: true };
      }
      case 'trashNote': {
        const n = pick(notes, c.n);
        return n ? w.trash.trashNote({}, n) : { ok: true };
      }
      case 'trashFolder': {
        const f = pick(folders, c.f);
        return f ? w.trash.trashFolder({}, f) : { ok: true };
      }
      case 'restore':
      case 'purge': {
        const items = w.trash.list();
        const it = items.ok ? pick(items.value, c.i) : undefined;
        if (!it) return { ok: true };
        return c.k === 'restore'
          ? w.trash.restoreBatch({}, it.batchId)
          : w.trash.purgeBatch({}, it.batchId, { confirmed: true });
      }
      case 'mkFolder': {
        const p = c.p % (folders.length + 1);
        return w.folders.create(
          {},
          { name: `f${folders.length}`, parentId: p === 0 ? null : folders[p - 1] },
        );
      }
      case 'mkTag':
        return w.tags.create({}, VOCAB[c.w % VOCAB.length]!);
      case 'tag':
      case 'untag': {
        const n = pick(notes, c.n);
        const t = pick(tags, c.t);
        if (!n || !t) return { ok: true };
        return c.k === 'tag' ? w.tags.tagNote({}, n, t) : w.tags.untagNote({}, n, t);
      }
      case 'ntMove': {
        // Direct UPDATE of an existing membership (a sync writer could do this): needs the note_tags UPDATE trigger.
        const m = db.prepare('SELECT note_id, tag_id FROM note_tags ORDER BY note_id, tag_id').all() as {
          note_id: string; tag_id: string; }[]; // prettier-ignore
        const row = pick(m, c.n);
        const t2 = pick(tags, c.t2);
        if (row && t2)
          db.prepare(
            'UPDATE OR IGNORE note_tags SET tag_id = ? WHERE note_id = ? AND tag_id = ?',
          ).run(t2, row.note_id, row.tag_id);
        return { ok: true };
      }
      case 'rename': {
        const t = pick(tags, c.t);
        return t
          ? w.tags.rename({}, t, VOCAB[c.w % VOCAB.length]!, c.merge ? { confirmMerge: true } : {})
          : { ok: true };
      }
      case 'verRestore': {
        const n = pick(notes, c.n);
        const vs = n ? w.versions.list(n) : undefined;
        const v = vs?.ok ? pick(vs.value, c.v) : undefined;
        return v ? w.versions.restore({}, v.id) : { ok: true };
      }
      case 'remote': {
        const seq = ++seqRef.n;
        const target = pick(notes, c.n) ?? U(5000 + seq);
        const id = c.mode === 'insert' ? U(5000 + seq) : target;
        const title = text(c.t);
        const body = text(c.b, ' ');
        const cols =
          'id, folder_id, title, body, content_hash, rev, favorite, created_at, updated_at, device_id';
        const vals = [id, null, title, body, sha256(body), 1, 0, clock.t, clock.t, PEER];
        const ins = (verb: string, tail = '') =>
          db
            .prepare(`${verb} INTO notes(${cols}) VALUES (?,?,?,?,?,?,?,?,?,?) ${tail}`)
            .run(...vals);
        return w.store.changelog.applyRemote(
          {
            id: U(100 + seq),
            entity: 'note',
            entityId: id,
            op: 'update',
            hlc: hlcOf(seq),
            deviceId: PEER,
            seq,
            actorId: null,
            schemaVersion: 2,
            fields: { title },
            contentHash: sha256(body),
            createdAt: 1,
          },
          () => {
            if (c.mode === 'replace') ins('INSERT OR REPLACE');
            else if (c.mode === 'ignore') ins('INSERT OR IGNORE');
            else if (c.mode === 'upsert')
              ins(
                'INSERT',
                'ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body',
              );
            else ins('INSERT');
            return { ok: true, value: undefined };
          },
        );
      }
    }
  })();
  // Refusals are normal (trashed note, name clash, ...); an engine failure is not.
  if (!r.ok && ['corrupt', 'internal'].includes(r.error!.code))
    throw new Error(`${c.k}: ${r.error!.code} ${r.error!.message}`);
}

export interface Stats {
  queries: number;
  nonEmpty: number;
  runs: number;
}

/** Returns a description of the first mismatch, or undefined. `mutant` may sabotage the open workspace. */
export function runCase(
  c: Case,
  stats: Stats,
  mutant?: (w: Workspace) => void,
): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'mossnote-sr2-'));
  const clock = { t: 1_700_000_000_000 };
  const r = openWorkspace(join(dir, 'w.db'), {
    guards: [],
    clock: { now: () => clock.t },
    // Test-only: durability off for speed. Production keeps synchronous=FULL (open.ts).
    wrapDb: (d) => (d.pragma('synchronous = OFF'), d),
  });
  if (!r.ok) throw new Error(r.error.message);
  const w = r.value;
  try {
    mutant?.(w);
    // A fixed start so memberships exist early and tag-changing commands have something to change.
    const mk = (t: string, b: string) => w.notes.create({}, { title: t, body: b });
    const notes = [
      mk('Alpha café', 'stone river'),
      mk('Beta', 'Zürich ember'),
      mk('Gamma', 'plain'),
    ];
    const tagIds = ['plum', 'kiwi', 'fern'].map((n) => w.tags.create({}, n));
    for (const [ni, ti] of [
      [0, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [0, 2],
    ] as const) {
      const n = notes[ni]!;
      const t = tagIds[ti]!;
      if (n.ok && t.ok) w.tags.tagNote({}, n.value.id, t.value.id);
    }
    const seqRef = { n: 0 };
    for (const cmd of c.cmds) apply(w, clock, cmd, seqRef);
    stats.runs++;
    const v = w.search.verify();
    if (!v.ok || !v.value.ok) return 'integrity-check failed (index differs from its content)';
    const snap = snapshot(w.store.db);
    // The denormalised tag column must equal the real memberships (not visible to integrity-check: the view reads it too).
    const docTags = w.store.db.prepare('SELECT note_id AS id, tags FROM search_doc').all() as {
      id: string; tags: string; }[]; // prettier-ignore
    if (docTags.length !== snap.docs.length) return 'search_doc rows differ from notes';
    const byId = new Map(snap.docs.map((d) => [d.id, d]));
    for (const r of docTags) {
      const want = [...(byId.get(r.id)?.raw[2]?.split(' ') ?? [])].filter(Boolean).sort().join(' ');
      if (r.tags.split(' ').filter(Boolean).sort().join(' ') !== want)
        return `search_doc.tags stale for ${r.id}`;
    }
    const stash = stashProblem(w.store.db);
    if (stash) return stash;
    const probed = probeFilters(w, snap);
    if (probed) return probed;
    for (const spec of c.queries) {
      const e = expectedFor(spec, snap);
      if (!e) continue;
      const got = w.search.search({ query: e.query, scope: { kind: e.scope }, limit: 100 });
      if (!got.ok) return `query ${JSON.stringify(e.query)} failed: ${got.error.message}`;
      if (got.value.state !== 'ready') return 'index not ready';
      const ids = got.value.hits.map((h) => h.noteId);
      for (const h of got.value.hits)
        for (const m of [h.title, h.snippet])
          if (m.ranges.some(([a, b]) => a < 0 || b > m.text.length || a >= b))
            return 'bad highlight range';
      stats.queries++;
      if (ids.length) stats.nonEmpty++;
      if (JSON.stringify([...ids].sort()) !== JSON.stringify(e.ids))
        return `query ${JSON.stringify(e.query)} scope ${e.scope}: got ${ids.length} expected ${e.ids.length}`;
    }
    return undefined;
  } finally {
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
