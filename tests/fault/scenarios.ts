import type { Scenario } from './harness.ts';
import { DAY, MIN, unwrap } from './harness.ts';

const big = (s: string) => `${s}\n${'new content line\n'.repeat(40)}`;

/** Every public mutation of notes, folders, tags, trash, versions and the draft flush. */
export const SCENARIOS: Scenario[] = [
  {
    name: 'notes.create',
    op: ({ w, fx }) => w.notes.create({}, { title: 't', body: 'b', folderId: fx.F }),
  },
  {
    name: 'notes.update body (new version)',
    prep: ({ clock }) => void (clock.t += 6 * MIN),
    op: ({ w, fx }) => w.notes.update({}, fx.N, { body: big('edited') }),
  },
  {
    name: 'notes.update body (throttled, no version)',
    op: ({ w, fx }) => w.notes.update({}, fx.N, { body: 'tiny change' }),
  },
  { name: 'notes.update title', op: ({ w, fx }) => w.notes.update({}, fx.N, { title: 'renamed' }) },
  { name: 'notes.move', op: ({ w, fx }) => w.notes.move({}, fx.N, fx.T) },
  { name: 'notes.setFavorite', op: ({ w, fx }) => w.notes.setFavorite({}, fx.N, true) },
  {
    name: 'folders.create',
    op: ({ w, fx }) => w.folders.create({}, { name: 'new', parentId: fx.F }),
  },
  { name: 'folders.rename', op: ({ w, fx }) => w.folders.rename({}, fx.F, 'F2') },
  { name: 'folders.move', op: ({ w, fx }) => w.folders.move({}, fx.S, fx.T) },
  { name: 'tags.create', op: ({ w }) => w.tags.create({}, 'fresh') },
  { name: 'tags.rename', op: ({ w, fx }) => w.tags.rename({}, fx.tagB, 'gamma') },
  {
    name: 'tags.rename (confirmed merge)',
    op: ({ w, fx }) => w.tags.rename({}, fx.tagB, 'ALPHA', { confirmMerge: true }),
  },
  { name: 'tags.tagNote', op: ({ w, fx }) => w.tags.tagNote({}, fx.M, fx.tagA) },
  { name: 'tags.untagNote', op: ({ w, fx }) => w.tags.untagNote({}, fx.N, fx.tagA) },
  { name: 'trash.trashNote', op: ({ w, fx }) => w.trash.trashNote({}, fx.M) },
  { name: 'trash.trashFolder', op: ({ w, fx }) => w.trash.trashFolder({}, fx.F) },
  {
    name: 'trash.restoreBatch (note)',
    op: ({ w, fx }) => w.trash.restoreBatch({}, fx.trashedNoteBatch),
  },
  {
    name: 'trash.restoreBatch (folder)',
    op: ({ w, fx }) => w.trash.restoreBatch({}, fx.trashedFolderBatch),
  },
  {
    name: 'trash.purgeBatch (note)',
    op: ({ w, fx }) => w.trash.purgeBatch({}, fx.trashedNoteBatch, { confirmed: true }),
  },
  {
    name: 'trash.purgeBatch (folder)',
    op: ({ w, fx }) => w.trash.purgeBatch({}, fx.trashedFolderBatch, { confirmed: true }),
  },
  {
    name: 'trash.purgeExpired (one due batch)',
    prep: ({ w, fx, clock }) => {
      unwrap(w.trash.recordNotice([fx.trashedNoteBatch]));
      clock.t += 31 * DAY;
    },
    op: ({ w }) => w.trash.purgeExpired({}),
  },
  { name: 'trash.recordNotice', op: ({ w, fx }) => w.trash.recordNotice([fx.trashedNoteBatch]) },
  { name: 'trash.setRetentionDays', op: ({ w }) => w.trash.setRetentionDays(14) },
  { name: 'versions.restore', op: ({ w, fx }) => w.versions.restore({}, fx.oldVersion) },
  {
    name: 'versions.force remote',
    op: ({ w, fx }) => w.versions.force(fx.M, 'remote'),
    prep: ({ w, fx }) => unwrap(w.notes.update({}, fx.M, { body: 'tiny head-stale edit' })),
  },
  {
    name: 'versions.force merge_base',
    op: ({ w, fx }) => w.versions.force(fx.M, 'merge_base', 'peer-1'),
    prep: ({ w, fx }) => unwrap(w.notes.update({}, fx.M, { body: 'tiny head-stale edit' })),
  },
  { name: 'versions.hold', op: ({ w, fx }) => w.versions.hold('peer-1', fx.oldVersion) },
  {
    name: 'versions.release',
    prep: ({ w, fx }) => unwrap(w.versions.hold('peer-1', fx.oldVersion)),
    op: ({ w, fx }) => w.versions.release('peer-1', fx.oldVersion),
  },
  {
    name: 'versions.prune',
    prep: ({ clock }) => void (clock.t += 40 * DAY),
    op: ({ w }) => w.versions.prune(),
  },
  {
    name: 'drafts.flush',
    prep: ({ w, fx }) =>
      w.drafts.write(fx.N, 'unsaved typing', { rev: 1, contentHash: 'a'.repeat(64) }),
    op: ({ w }) => w.drafts.flush(),
  },
  {
    name: 'drafts.flush (supersedes an older draft)',
    prep: ({ w, fx }) => {
      const base = { rev: 1, contentHash: 'a'.repeat(64) };
      w.drafts.write(fx.N, 'first', base);
      unwrap(w.drafts.flush());
      w.drafts.write(fx.N, 'second', base);
    },
    op: ({ w, fx }) => w.drafts.flush(fx.N),
  },
  {
    name: 'drafts.discardUpTo',
    prep: ({ w, fx }) => {
      w.drafts.write(fx.N, 'to discard', { rev: 1, contentHash: 'a'.repeat(64) });
      unwrap(w.drafts.flush());
    },
    op: ({ w, fx }) => w.drafts.discardUpTo(fx.N, 1_000_000),
  },
];
