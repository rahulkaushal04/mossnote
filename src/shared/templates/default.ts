import type { GameTemplate } from './types';

/**
 * Plain wording for any game, and the template a journal gets when nothing else fits. It has no
 * game concepts at all: four sections, a day counter instead of seasons, and no shortcuts.
 */
export const defaultTemplate: GameTemplate = {
  id: 'default',
  name: 'Default',
  about: 'Plain wording and a day counter. Fits any single-player game.',
  terms: {
    today: { label: 'Today', one: 'day', many: 'days' },
    journal: { label: 'Journal', one: 'note', many: 'notes' },
    people: { label: 'People', one: 'person', many: 'people' },
    // Not a section of this template; present only so every template names every section.
    farm: { label: 'Entries', one: 'entry', many: 'entries' },
    maps: { label: 'Maps', one: 'map', many: 'maps' },
  },
  order: ['today', 'journal', 'people', 'maps'],
  calendar: 'counter',
  quickActions: [],
  suggestedTags: [],
};
