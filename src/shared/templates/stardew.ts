import type { GameTemplate } from './types';

/**
 * Stardew Valley wording and structure only: a Farm section, a calendar of four seasons, quick
 * actions and suggested tags. No names, items, places or mechanics appear here, and none may be
 * added.
 */
export const stardewTemplate: GameTemplate = {
  id: 'stardew',
  name: 'Stardew Valley',
  tint: 'plum',
  about:
    'A Farm section, a calendar of seasons, NPCs, and a few one-tap actions for notes you take while playing.',
  terms: {
    today: { label: 'Today', one: 'day', many: 'days' },
    journal: { label: 'Daily journal', one: 'entry', many: 'entries' },
    people: { label: 'NPCs', one: 'NPC', many: 'NPCs' },
    farm: { label: 'Farm', one: 'crop', many: 'crops' },
    maps: { label: 'Maps', one: 'map', many: 'maps' },
  },
  order: ['today', 'journal', 'people', 'farm', 'maps'],
  calendar: 'seasons',
  quickActions: [
    { id: 'met', label: 'Met someone', set: { tag: 'met' } },
    { id: 'found', label: 'Found something', set: { discovery: true } },
    { id: 'wonder', label: 'Wondering', set: { question: true } },
    { id: 'task', label: 'To do', set: { tag: 'tasks' } },
  ],
  suggestedTags: ['tasks', 'custom notes'],
};
