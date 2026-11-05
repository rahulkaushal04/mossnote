import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dumpAllText, setup, unwrap, type W } from './util.ts';

/**
 * CS-3/CS-5/CS-17 property test: random operation sequences against a plain in-memory model.
 * After every operation: exactly the predicted number of change-log rows (1 per successful action,
 * 0 for failures and no-ops), derived trash state equals the model's, tombstones equal the model's.
 * At the end: no purged marker text survives anywhere in the database.
 */

interface MFolder {
  id: string;
  parent: string | null;
  own: boolean;
}
interface MNote {
  id: string;
  folder: string | null;
  own: boolean;
  fav: boolean;
  marker: string;
}
interface Model {
  folders: MFolder[];
  notes: MNote[];
  tags: { id: string; key: string; name: string }[];
  links: Set<string>; // noteId:tagId
  batches: Map<string, { kind: 'folder' | 'note'; id: string }>;
  tomb: Set<string>;
  purgedMarkers: string[];
}

const WEIGHTED = [
  'mkNote',
  'mkNote',
  'mkFolder',
  'trashNote',
  'trashNote',
  'trashFolder',
  'purge',
  'purge',
  'restore',
] as const;
const op = fc.record({
  k: fc.constantFrom(
    ...WEIGHTED,
    'mkFolder',
    'mkNote',
    'trashNote',
    'trashFolder',
    'restore',
    'purge',
    'moveNote',
    'moveFolder',
    'fav',
    'update',
    'mkTag',
    'tag',
    'untag',
    'renameTag',
    'merge',
  ),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.nat(3),
});
interface Op {
  k: string;
  a: number;
  b: number;
  c: number;
}

const seen: Record<string, number> = {};
const pick = <T>(xs: T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);
const NAMES = ['a', 'A', 'b', 'B', 'c'];

function run(ops: Op[]): void {
  const w: W = setup();
  const m: Model = {
    folders: [],
    notes: [],
    tags: [],
    links: new Set(),
    batches: new Map(),
    tomb: new Set(),
    purgedMarkers: [],
  };
  const fol = (id: string | null) => m.folders.find((f) => f.id === id);
  const effF = (id: string | null): boolean => {
    for (let f = fol(id); f; f = fol(f.parent)) if (f.own) return true;
    return false;
  };
  const effN = (n: MNote) => n.own || effF(n.folder);
  const depth = (id: string | null): number => (id === null ? 0 : 1 + depth(fol(id)!.parent));
  const sub = (id: string): string[] => [
    id,
    ...m.folders.filter((f) => f.parent === id).flatMap((f) => sub(f.id)),
  ];
  const height = (id: string): number =>
    1 + Math.max(0, ...m.folders.filter((f) => f.parent === id).map((f) => height(f.id)));
  let counter = 0;

  for (const o of ops) {
    const before = w.logCount();
    const tombBefore = w.tombstones().length;
    let expectOk = true;
    let rows: number;
    let ok: boolean;
    const folderTarget = (i: number) => (i % 4 === 0 ? undefined : pick(m.folders, i)); // undefined = root
    switch (o.k) {
      case 'mkFolder': {
        const p = folderTarget(o.a);
        const pid = p?.id ?? null;
        expectOk = !(p && effF(p.id)) && depth(pid) + 1 <= 50;
        rows = 1;
        const r = w.folders.create({}, { name: `f${counter++}`, parentId: pid });
        ok = r.ok;
        if (r.ok) m.folders.push({ id: r.value.id, parent: pid, own: false });
        break;
      }
      case 'mkNote': {
        const p = folderTarget(o.a);
        expectOk = !(p && effF(p.id));
        rows = 1;
        const marker = `MARK${counter++}X`;
        const r = w.notes.create(
          {},
          { title: `T${marker}`, body: `body ${marker}`, folderId: p?.id ?? null },
        );
        ok = r.ok;
        if (r.ok)
          m.notes.push({ id: r.value.id, folder: p?.id ?? null, own: false, fav: false, marker });
        break;
      }
      case 'trashNote': {
        const n = pick(m.notes, o.a);
        if (!n) continue;
        expectOk = !effN(n);
        rows = 1;
        const r = w.trash.trashNote({}, n.id);
        ok = r.ok;
        if (r.ok) {
          n.own = true;
          m.batches.set(r.value.batchId, { kind: 'note', id: n.id });
        }
        break;
      }
      case 'trashFolder': {
        const f = pick(m.folders, o.a);
        if (!f) continue;
        expectOk = !effF(f.id);
        rows = 1;
        const r = w.trash.trashFolder({}, f.id);
        ok = r.ok;
        if (r.ok) {
          f.own = true;
          m.batches.set(r.value.batchId, { kind: 'folder', id: f.id });
        }
        break;
      }
      case 'restore': {
        const e = pick([...m.batches], o.a);
        if (!e) continue;
        const [bid, item] = e;
        rows = 1;
        const r = w.trash.restoreBatch({}, bid);
        ok = r.ok;
        if (item.kind === 'note') {
          const n = m.notes.find((x) => x.id === item.id)!;
          n.own = false;
          if (effF(n.folder)) n.folder = null;
        } else {
          const f = fol(item.id)!;
          f.own = false;
          if (effF(f.parent)) f.parent = null;
        }
        m.batches.delete(bid);
        break;
      }
      case 'purge': {
        const e = pick([...m.batches], o.a);
        if (!e) continue;
        const [bid, item] = e;
        rows = 1;
        const r = w.trash.purgeBatch({}, bid, { confirmed: true });
        ok = r.ok;
        const fids = item.kind === 'folder' ? sub(item.id) : [];
        const nids =
          item.kind === 'note'
            ? [item.id]
            : m.notes.filter((n) => fids.includes(n.folder ?? '')).map((n) => n.id);
        for (const id of [...fids, ...nids]) m.tomb.add(id);
        for (const n of m.notes.filter((x) => nids.includes(x.id))) m.purgedMarkers.push(n.marker);
        m.notes = m.notes.filter((n) => !nids.includes(n.id));
        m.folders = m.folders.filter((f) => !fids.includes(f.id));
        for (const l of [...m.links]) if (nids.includes(l.split(':')[0]!)) m.links.delete(l);
        for (const [k, v] of [...m.batches])
          if ([...fids, ...nids].includes(v.id)) m.batches.delete(k);
        if (r.ok) {
          const row = w.lastRow();
          expect(row.purgedIds!.map((x) => x.id).sort()).toEqual([...fids, ...nids].sort());
        }
        break;
      }
      case 'moveNote': {
        const n = pick(m.notes, o.a);
        if (!n) continue;
        const t = folderTarget(o.b);
        expectOk = !effN(n) && !(t && effF(t.id));
        rows = (t?.id ?? null) === n.folder ? 0 : 1;
        const r = w.notes.move({}, n.id, t?.id ?? null);
        ok = r.ok;
        if (r.ok) n.folder = t?.id ?? null;
        break;
      }
      case 'moveFolder': {
        const f = pick(m.folders, o.a);
        if (!f) continue;
        const t = folderTarget(o.b);
        expectOk =
          !effF(f.id) &&
          !(t && effF(t.id)) &&
          !(t && sub(f.id).includes(t.id)) &&
          depth(t?.id ?? null) + height(f.id) <= 50;
        rows = (t?.id ?? null) === f.parent ? 0 : 1;
        const r = w.folders.move({}, f.id, t?.id ?? null);
        ok = r.ok;
        if (r.ok) f.parent = t?.id ?? null;
        break;
      }
      case 'fav': {
        const n = pick(m.notes, o.a);
        if (!n) continue;
        const want = o.c % 2 === 0;
        expectOk = !effN(n);
        rows = want === n.fav ? 0 : 1;
        const r = w.notes.setFavorite({}, n.id, want);
        ok = r.ok;
        if (r.ok) n.fav = want;
        break;
      }
      case 'update': {
        const n = pick(m.notes, o.a);
        if (!n) continue;
        expectOk = !effN(n);
        rows = 1;
        const r = w.notes.update(o.c === 0 ? { actor: 'agent' } : {}, n.id, {
          body: `body ${n.marker} ${counter++}`,
        });
        ok = r.ok;
        break;
      }
      case 'mkTag': {
        const name = NAMES[o.a % NAMES.length]!;
        const ex = m.tags.find((t) => t.key === name.toLowerCase());
        rows = ex ? 0 : 1;
        const r = w.tags.create({}, name);
        ok = r.ok;
        if (r.ok && !ex) m.tags.push({ id: r.value.id, key: name.toLowerCase(), name });
        break;
      }
      case 'tag':
      case 'untag': {
        const n = pick(m.notes, o.a);
        const t = pick(m.tags, o.b);
        if (!n || !t) continue;
        const has = m.links.has(`${n.id}:${t.id}`);
        const want = o.k === 'tag';
        expectOk = !effN(n);
        rows = has === want ? 0 : 1;
        const r = want ? w.tags.tagNote({}, n.id, t.id) : w.tags.untagNote({}, n.id, t.id);
        ok = r.ok;
        if (r.ok) m.links[want ? 'add' : 'delete'](`${n.id}:${t.id}`);
        break;
      }
      case 'renameTag':
      case 'merge': {
        const t = pick(m.tags, o.a);
        if (!t) continue;
        const name = NAMES[o.b % NAMES.length]!;
        const key = name.toLowerCase();
        const other = m.tags.find((x) => x.key === key && x.id !== t.id);
        const confirm = o.k === 'merge';
        const r = w.tags.rename({}, t.id, name, confirm ? { confirmMerge: true } : {});
        ok = r.ok;
        if (other && confirm) {
          rows = 1;
          for (const l of [...m.links]) {
            const [nid, tid] = l.split(':');
            if (tid === t.id) {
              m.links.delete(l);
              m.links.add(`${nid}:${other.id}`);
            }
          }
          m.tags = m.tags.filter((x) => x.id !== t.id);
          m.tomb.add(t.id);
          expect(r.ok && r.value.kind).toBe('merged');
        } else if (other) {
          rows = 0;
          expect(r.ok && r.value.kind).toBe('needsMerge');
        } else {
          rows = t.name === name ? 0 : 1;
          t.name = name;
          t.key = key;
        }
        break;
      }
      default:
        continue;
    }
    expect(ok!, `${o.k} ok`).toBe(expectOk);
    if (expectOk) seen[o.k] = (seen[o.k] ?? 0) + 1;
    // exactly one row per successful (non-no-op) action; none per failure
    expect(w.logCount() - before, `${o.k} rows`).toBe(expectOk ? rows : 0);
    // tombstones: only purges (and tag merges) add them; the set equals the model's
    if (!['purge', 'merge'].includes(o.k)) expect(w.tombstones().length).toBe(tombBefore);
    expect(new Set(w.tombstones())).toEqual(m.tomb);

    // derived trash state (and structure) equals the model for every record
    for (const n of m.notes) {
      const got = unwrap(w.notes.get(n.id));
      expect(got.trashed, `note ${n.id} trashed`).toBe(effN(n));
      expect(got.folderId).toBe(n.folder);
    }
    for (const f of m.folders) {
      const got = unwrap(w.folders.get(f.id));
      expect(got.trashed, `folder ${f.id} trashed`).toBe(effF(f.id));
      expect(got.parentId).toBe(f.parent);
    }
    expect(
      unwrap(w.notes.list({ trashed: true }))
        .map((n) => n.id)
        .sort(),
    ).toEqual(
      m.notes
        .filter(effN)
        .map((n) => n.id)
        .sort(),
    );
    expect(unwrap(w.trash.list()).length).toBe(m.batches.size);
  }

  // Purge is irrecoverable: no title/body marker of a purged note survives in any table.
  const dump = dumpAllText(w);
  for (const mk of m.purgedMarkers) expect(dump).not.toContain(mk);
  // tombstoned ids no longer exist anywhere as live rows
  for (const id of m.tomb) {
    expect(w.notes.get(id).ok || w.folders.get(id).ok || w.tags.get(id).ok).toBe(false);
  }
  // sequence is dense per device: no gaps, no duplicates
  const seqs = unwrap(w.store.changelog.read({ limit: 10000 })).map((r) => r.seq);
  expect(seqs).toEqual(seqs.map((_, i) => i + 1));
}

describe('CS-3/CS-5/CS-17 property: random operation sequences', () => {
  it('one log row per successful action, none per failure; derived trash state and tombstones match the model', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 60 }), (ops) => run(ops)),
      {
        numRuns: 60,
      },
    );
  });
});
