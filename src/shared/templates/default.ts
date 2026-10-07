import type { GameTemplate } from './types';

/** The plain wording Mossnote starts with. Used whenever no game has been chosen. */
export const defaultTemplate: GameTemplate = {
  id: 'default',
  name: 'Default',
  about: 'Plain wording that fits any single-player game.',
  terms: {
    today: { label: 'Today', one: 'day', many: 'days' },
    journal: { label: 'Journal', one: 'note', many: 'notes' },
    people: { label: 'People', one: 'person', many: 'people' },
    farm: { label: 'Farm', one: 'farm entry', many: 'farm entries' },
    maps: { label: 'Maps', one: 'map', many: 'maps' },
  },
  order: ['today', 'journal', 'people', 'farm', 'maps'],
  quickActions: [],
  suggestedTags: [],
};
