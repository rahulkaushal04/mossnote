import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { tagKey } from '@shared/tags';
import type { Note, Page } from '@shared/types';
import type { NoteFilters } from '../../lib/api';

export type NotesData = InfiniteData<Page<Note>, string | undefined>;

/** Does a note belong in a list with these filters? (Mirrors the server's filter semantics.) */
export function matchesFilters(note: Note, f: NoteFilters): boolean {
  if (f.flag === 'discovery' && !note.isDiscovery) return false;
  if (f.flag === 'question' && !note.question) return false;
  if (f.state && note.question?.state !== f.state) return false;
  for (const tag of f.tag ?? []) {
    if (!note.tags.some((t) => tagKey(t) === tagKey(tag.replace(/^#+/, '')))) return false;
  }
  if (f.person && !note.links.some((l) => l.type === 'person' && l.id === f.person)) return false;
  if (f.planting && !note.links.some((l) => l.type === 'planting' && l.id === f.planting))
    return false;
  if (f.gameDate !== undefined && note.gameDate !== f.gameDate) return false;
  if (f.undated && note.gameDate !== null) return false;
  const created = Date.parse(note.createdAt);
  if (f.createdFrom !== undefined && created < f.createdFrom) return false;
  if (f.createdTo !== undefined && created > f.createdTo) return false;
  return true;
}

/** Sort order used by the server: game date, creation time, id; undated last in both directions. */
export function compareNotes(a: Note, b: Note, order: 'asc' | 'desc'): number {
  if ((a.gameDate === null) !== (b.gameDate === null)) return a.gameDate === null ? 1 : -1;
  const sign = order === 'desc' ? -1 : 1;
  const byDate = (a.gameDate ?? 0) - (b.gameDate ?? 0);
  if (byDate !== 0) return sign * byDate;
  const byCreated = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byCreated !== 0) return sign * byCreated;
  return sign * a.id.localeCompare(b.id);
}

const isNotesKey = (key: readonly unknown[]): boolean =>
  key[0] === 'notes' && key[1] !== 'count' && typeof key[1] === 'object' && key[1] !== null;

/** Every cached notes list (infinite queries) with its filters. */
function lists(
  client: QueryClient,
): { key: readonly unknown[]; filters: NoteFilters; data: NotesData }[] {
  return client
    .getQueriesData<NotesData>({ queryKey: ['notes'] })
    .flatMap(([key, data]) =>
      isNotesKey(key) && data !== undefined ? [{ key, filters: key[1] as NoteFilters, data }] : [],
    );
}

/** Insert a new note into every cached list whose filters it satisfies (optimistic create). */
export function insertNote(client: QueryClient, note: Note): void {
  for (const { key, filters, data } of lists(client)) {
    if (!matchesFilters(note, filters)) continue;
    const order = filters.order ?? 'desc';
    const first = data.pages[0];
    if (!first || data.pages.some((p) => p.items.some((n) => n.id === note.id))) continue;
    const items = [...first.items];
    const at = items.findIndex((n) => compareNotes(note, n, order) < 0);
    // Past the end of a list that has more pages: it belongs to a later page, so skip it.
    const last = data.pages.at(-1);
    if (at === -1 && last?.nextCursor) continue;
    items.splice(at === -1 ? items.length : at, 0, note);
    client.setQueryData<NotesData>(key, {
      ...data,
      pages: [{ ...first, items }, ...data.pages.slice(1)],
    });
  }
}

/** Replace a note everywhere it is cached; it leaves lists whose filters it no longer satisfies. */
export function replaceNote(client: QueryClient, note: Note): void {
  for (const { key, filters, data } of lists(client)) {
    const present = data.pages.some((p) => p.items.some((n) => n.id === note.id));
    if (!present) {
      insertNote(client, note);
      continue;
    }
    client.setQueryData<NotesData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: matchesFilters(note, filters)
          ? page.items.map((n) => (n.id === note.id ? note : n))
          : page.items.filter((n) => n.id !== note.id),
      })),
    });
  }
  const detail = client.getQueryData<Note & { linkedFrom?: unknown }>(['note', note.id]);
  if (detail) client.setQueryData(['note', note.id], { ...detail, ...note });
}

export function removeNote(client: QueryClient, id: string): void {
  for (const { key, data } of lists(client)) {
    client.setQueryData<NotesData>(key, {
      ...data,
      pages: data.pages.map((page) => ({ ...page, items: page.items.filter((n) => n.id !== id) })),
    });
  }
}

/** A snapshot of every cached notes list, to roll back a failed optimistic change. */
export function snapshotLists(client: QueryClient): [readonly unknown[], NotesData][] {
  return lists(client).map(({ key, data }) => [key, data]);
}

export function restoreLists(
  client: QueryClient,
  snapshot: [readonly unknown[], NotesData][],
): void {
  for (const [key, data] of snapshot) client.setQueryData(key, data);
}
