import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '@shared/types';
import { narrowGroups, scopeTabs, type PaletteScope } from './scope';

const hit = (id: string) => ({
  kind: 'note' as const,
  id,
  title: id,
  snippet: null,
  gameDate: null,
});
const groups: SearchResponse['groups'] = {
  notes: [hit('n')],
  people: [{ ...hit('p'), kind: 'person' }],
  plantings: [{ ...hit('f'), kind: 'planting' }],
  tags: [{ ...hit('t'), kind: 'tag' }],
  maps: [{ mapId: 'm', pinId: null, mapName: 'M', title: 'M', snippet: null }],
};

describe('narrowGroups', () => {
  it('keeps everything for All', () => {
    expect(narrowGroups('all', groups)).toEqual(groups);
  });

  it('keeps one group, and tags go with notes', () => {
    const maps = narrowGroups('maps', groups);
    expect(maps.maps).toHaveLength(1);
    expect([maps.notes, maps.people, maps.plantings, maps.tags].every((g) => g.length === 0)).toBe(
      true,
    );
    const notes = narrowGroups('notes', groups);
    expect(notes.notes).toHaveLength(1);
    expect(notes.tags).toHaveLength(1);
    expect(notes.people).toHaveLength(0);
  });
});

describe('scopeTabs', () => {
  it('lists All, Notes, the people word, Maps, and Farm only when the template has it', () => {
    const labels = (farm: boolean) =>
      scopeTabs({ people: 'NPCs', farm: 'Crops' }, farm).map((t) => t.label);
    expect(labels(false)).toEqual(['All', 'Notes', 'NPCs', 'Maps']);
    expect(labels(true)).toEqual(['All', 'Notes', 'NPCs', 'Crops', 'Maps']);
  });

  it('uses ids the narrowing understands', () => {
    const ids: PaletteScope[] = scopeTabs({ people: 'P', farm: 'F' }, true).map((t) => t.id);
    expect(ids).toEqual(['all', 'notes', 'people', 'plantings', 'maps']);
  });
});
