/** The places a template can rename, hide or reorder. */
export const SECTION_IDS = ['today', 'journal', 'people', 'farm', 'maps'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionTerms {
  /** Navigation and page title, for example "People". */
  label: string;
  /** What one record in the section is called, lower case: "person". */
  one: string;
  /** What several are called, lower case: "people". */
  many: string;
}

/**
 * One tap in the composer that applies a flag or a tag to the note being written. Only
 * structure and vocabulary: a template never carries facts about a game.
 */
export interface QuickAction {
  id: string;
  label: string;
  set: { discovery?: true; question?: true; tag?: string };
}

/** How dates are written: counted days, or the seasons-and-years calendar. */
export type CalendarKind = 'counter' | 'seasons';

export interface GameTemplate {
  id: string;
  name: string;
  /** One line shown where a template is picked. */
  about: string;
  /** Wording for every section; sections the template does not use are never shown. */
  terms: Record<SectionId, SectionTerms>;
  /** The sections this template uses, in the order they start in. Others are skipped everywhere. */
  order: readonly SectionId[];
  /** The calendar a new journal made from this template starts with. */
  calendar: CalendarKind;
  quickActions: readonly QuickAction[];
  /** Tags the user can add with one click in Settings. Never created on their own. */
  suggestedTags: readonly string[];
}
