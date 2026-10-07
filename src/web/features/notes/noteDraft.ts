import type { NotePatch } from '@shared/schemas/note';
import { tagKey } from '@shared/tags';
import type { Note } from '@shared/types';
import type { NoteDraft } from '../capture/draft';

/** The editor's starting point: the saved note, with the title field shown only if it has one. */
export function noteToDraft(note: Note): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    tags: note.tags,
    links: note.links,
    gameDate: note.gameDate,
    isDiscovery: note.isDiscovery,
    isQuestion: note.question !== null,
  };
}

/** Does the draft hold anything a note can be saved with? */
export const hasContent = (d: NoteDraft): boolean =>
  d.body.trim() !== '' || (d.title ?? '').trim() !== '';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => tagKey(x) === tagKey(y)));

/**
 * Only the fields that changed, so an edit never overwrites an unrelated change made elsewhere
 * (spec section 11). Returns null when nothing changed.
 */
export function diffDraft(note: Note, draft: NoteDraft): NotePatch | null {
  const patch: NotePatch = {};
  const title = (draft.title ?? '').trim() === '' ? null : (draft.title ?? '').trim();
  if (title !== note.title) patch.title = title;
  if (draft.body !== note.body) patch.body = draft.body;
  const date = draft.gameDate === undefined ? note.gameDate : draft.gameDate;
  if (date !== note.gameDate) patch.gameDate = date;
  if (!sameSet(draft.tags, note.tags)) patch.tags = draft.tags;
  const ids = (list: readonly { type: string; id: string }[]) =>
    list.map((l) => `${l.type}:${l.id}`).sort();
  if (ids(draft.links).join() !== ids(note.links).join()) {
    patch.links = draft.links.map(({ type, id }) => ({ type, id }));
  }
  if (draft.isDiscovery !== note.isDiscovery) patch.isDiscovery = draft.isDiscovery;
  if (draft.isQuestion && !note.question) patch.question = { state: 'open' };
  if (!draft.isQuestion && note.question) patch.question = null;
  return Object.keys(patch).length > 0 ? patch : null;
}
