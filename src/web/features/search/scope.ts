import type { SearchResponse } from '@shared/types';
import type { SectionId } from '@shared/templates';
import type { SectionTerms } from '@shared/templates';

type Terms = Record<SectionId, SectionTerms>;

/** What search covers in this journal, in the journal's own words: "notes, NPCs, crops, maps and tags". */
export function searchScope(terms: Terms, withFarm: boolean): string {
  const parts = ['notes', terms.people.many, ...(withFarm ? [terms.farm.many] : []), 'maps'];
  return `${parts.join(', ')} and tags`;
}

/** Which results the palette shows: everything, or one kind. */
export type PaletteScope = 'all' | 'notes' | 'people' | 'plantings' | 'maps';

/** The scope tabs, in the journal's own words for people and farm entries. */
export function scopeTabs(
  words: { people: string; farm: string },
  withFarm: boolean,
): { id: PaletteScope; label: string }[] {
  return [
    { id: 'all', label: 'All' },
    { id: 'notes', label: 'Notes' },
    { id: 'people', label: words.people },
    ...(withFarm ? [{ id: 'plantings' as const, label: words.farm }] : []),
    { id: 'maps', label: 'Maps' },
  ];
}

/** Keep only the groups a scope covers. Tags travel with notes. */
export function narrowGroups(
  scope: PaletteScope,
  groups: SearchResponse['groups'],
): SearchResponse['groups'] {
  if (scope === 'all') return groups;
  return {
    notes: scope === 'notes' ? groups.notes : [],
    tags: scope === 'notes' ? groups.tags : [],
    people: scope === 'people' ? groups.people : [],
    plantings: scope === 'plantings' ? groups.plantings : [],
    maps: scope === 'maps' ? groups.maps : [],
  };
}
