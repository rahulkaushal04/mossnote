import { extractTrailingTags } from '@shared/tags';
import type { LinkType } from '@shared/types';
import type { CreateInput } from '../notes/hooks';

export interface ChipLink {
  type: LinkType;
  id: string;
  label: string;
}

/**
 * What the composer and the inline editor hold while a note is being written. `title: null`
 * means the title field is hidden. `gameDate: undefined` means "use the default" (the current
 * game date, or the viewed day); an explicit date or `null` (no date) overrides it.
 */
export interface NoteDraft {
  title: string | null;
  body: string;
  tags: string[];
  links: ChipLink[];
  gameDate?: number | null | undefined;
  isDiscovery: boolean;
  isQuestion: boolean;
  /** Id of a save that is in flight. Kept in storage until the save succeeds, so a reload or an
   * outage can never lose the text; on load it tells us whether that save landed. */
  pendingId?: string | undefined;
}

export const emptyDraft = (): NoteDraft => ({
  title: null,
  body: '',
  tags: [],
  links: [],
  isDiscovery: false,
  isQuestion: false,
});

/** Nothing worth keeping: no text, no chips, no flags (a date alone is not kept). */
export const isDraftEmpty = (d: NoteDraft): boolean =>
  d.body.trim() === '' &&
  (d.title ?? '').trim() === '' &&
  d.tags.length === 0 &&
  d.links.length === 0 &&
  !d.isDiscovery &&
  !d.isQuestion;

export function isNoteDraft(v: unknown): v is NoteDraft {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  const isLink = (l: unknown): boolean =>
    typeof l === 'object' &&
    l !== null &&
    typeof (l as Record<string, unknown>).id === 'string' &&
    typeof (l as Record<string, unknown>).label === 'string';
  return (
    (d.title === null || typeof d.title === 'string') &&
    typeof d.body === 'string' &&
    Array.isArray(d.tags) &&
    d.tags.every((t) => typeof t === 'string') &&
    Array.isArray(d.links) &&
    d.links.every(isLink) &&
    typeof d.isDiscovery === 'boolean' &&
    typeof d.isQuestion === 'boolean' &&
    (d.pendingId === undefined || typeof d.pendingId === 'string')
  );
}

/** Content a note needs before it can be saved: some text or a title. No error is shown. */
export const canSave = (d: NoteDraft): boolean =>
  d.body.trim() !== '' || (d.title ?? '').trim() !== '';

/** The effective game date: an explicit choice wins, otherwise the default. */
export const effectiveDate = (d: NoteDraft, fallback: number | null): number | null =>
  d.gameDate === undefined ? fallback : d.gameDate;

/** Case-insensitive duplicate check for tag names. */
const hasTag = (tags: readonly string[], name: string): boolean =>
  tags.some((t) => t.toLowerCase() === name.toLowerCase());

export const withTag = (d: NoteDraft, name: string): NoteDraft =>
  hasTag(d.tags, name) ? d : { ...d, tags: [...d.tags, name] };

export const withLink = (d: NoteDraft, link: ChipLink): NoteDraft =>
  d.links.some((l) => l.type === link.type && l.id === link.id)
    ? d
    : { ...d, links: [...d.links, link] };

/**
 * The request body for a new note. A trailing line made only of `#tokens` becomes tags and is
 * removed from the body. Only fields that carry something are sent, so a plain
 * note's request has just `body`.
 */
export function toCreateInput(
  draft: NoteDraft,
  id: string,
  defaultDate: number | null,
): CreateInput {
  const extracted = extractTrailingTags(draft.body);
  const tags = [...draft.tags];
  for (const name of extracted.tags) if (!hasTag(tags, name)) tags.push(name);
  const title = (draft.title ?? '').trim();
  const date = effectiveDate(draft, defaultDate);

  const input: CreateInput = { id, body: extracted.body };
  if (title !== '') input.title = title;
  if (date !== null) input.gameDate = date;
  if (draft.isDiscovery) input.isDiscovery = true;
  if (draft.isQuestion) input.question = { state: 'open' };
  if (tags.length > 0) input.tags = tags;
  if (draft.links.length > 0) {
    input.links = draft.links.map(({ type, id: linkId }) => ({ type, id: linkId }));
    input.labels = Object.fromEntries(draft.links.map((l) => [`${l.type}:${l.id}`, l.label]));
  }
  return input;
}

/** Two drafts as one: `first` stays on top, `second` follows it. Used after a failed save. */
export function mergeDrafts(first: NoteDraft, second: NoteDraft): NoteDraft {
  const body = [first.body, second.body].filter((b) => b.trim() !== '').join('\n\n');
  let merged: NoteDraft = { ...first, body };
  for (const tag of second.tags) merged = withTag(merged, tag);
  for (const link of second.links) merged = withLink(merged, link);
  return {
    ...merged,
    title: first.title ?? second.title,
    isDiscovery: first.isDiscovery || second.isDiscovery,
    isQuestion: first.isQuestion || second.isQuestion,
  };
}
