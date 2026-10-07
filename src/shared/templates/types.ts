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
 * structure and vocabulary: a template never carries facts about a game (spec section 3).
 */
export interface QuickAction {
  id: string;
  label: string;
  set: { discovery?: true; question?: true; tag?: string };
}

export interface GameTemplate {
  id: string;
  name: string;
  /** One line shown under the name in Settings. */
  about: string;
  terms: Record<SectionId, SectionTerms>;
  /** The order the sections start in. */
  order: readonly SectionId[];
  quickActions: readonly QuickAction[];
  /** Tags the user can add with one click in Settings. Never created on their own. */
  suggestedTags: readonly string[];
}
