/**
 * Where the journal lives. On a computer a server holds it in a folder; in the standalone web
 * app the browser holds it. The two builds share almost all code; a few places differ, and they
 * ask here.
 */
export const IS_STANDALONE: boolean = __MOSS_STANDALONE__;

/** The path the app is served under, with a trailing slash: `/` normally, `/mossnote/` on a project site. */
export const BASE_PATH: string = import.meta.env.BASE_URL;

/**
 * Words for where the journal is kept, for sentences that say so. The meaning is the same in both
 * builds; only the place differs.
 */
export const WHERE_IT_LIVES = {
  /** "…lives on this computer" / "…lives in this browser". */
  place: IS_STANDALONE ? 'in this browser' : 'on this computer',
  /** "…removes the journal from this computer" / "…from this browser". */
  removeFrom: IS_STANDALONE ? 'this browser' : 'this computer',
  /** Where a last copy of a deleted journal goes. */
  lastCopy: IS_STANDALONE ? 'in this browser' : 'in the backups folder',
  /** Where snapshots are kept. */
  snapshots: IS_STANDALONE ? "this browser's storage" : 'your backups folder',
  /** What a journal is, stored. */
  unit: IS_STANDALONE ? 'its own database in this browser' : 'its own file in your data folder',
} as const;
