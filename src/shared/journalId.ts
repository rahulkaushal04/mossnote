/**
 * A journal's id: the short, file-name-safe name a journal is stored under. Pure, so the Node
 * server (where it is a file name) and the browser runtime (a name in browser storage) agree.
 */

export const JOURNAL_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** The id of the journal that older versions kept as the only one. */
export const LEGACY_JOURNAL_ID = 'journal';

/** A short, file-name-safe id from a journal's name. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug === '' ? LEGACY_JOURNAL_ID : slug;
}

/** An id for a new journal named `name`: the first slug-based id for which `isFree` is true. */
export function pickFreeJournalId(name: string, isFree: (id: string) => boolean): string {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (isFree(id)) return id;
  }
}
