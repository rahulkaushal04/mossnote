import type { SectionId } from '@shared/templates';
import type { SectionTerms } from '@shared/templates';

type Terms = Record<SectionId, SectionTerms>;

/** What search covers in this journal, in the journal's own words: "notes, NPCs, crops, maps and tags". */
export function searchScope(terms: Terms, withFarm: boolean): string {
  const parts = ['notes', terms.people.many, ...(withFarm ? [terms.farm.many] : []), 'maps'];
  return `${parts.join(', ')} and tags`;
}
