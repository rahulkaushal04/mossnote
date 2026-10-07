import type { GameTemplate } from './types';

/**
 * Stardew Valley wording and structure only. The calendar of four seasons already ships as the
 * app default. No names, items, places or mechanics appear here, and none may be added.
 */
export const stardewTemplate: GameTemplate = {
  id: 'stardew',
  name: 'Stardew Valley',
  about: 'Daily journal, NPCs, crops, and a few one-tap actions for notes you take while playing.',
  terms: {
    today: { label: 'Today', one: 'day', many: 'days' },
    journal: { label: 'Daily journal', one: 'entry', many: 'entries' },
    people: { label: 'NPCs', one: 'NPC', many: 'NPCs' },
    farm: { label: 'Farm', one: 'crop', many: 'crops' },
    maps: { label: 'Maps', one: 'map', many: 'maps' },
  },
  order: ['today', 'journal', 'people', 'farm', 'maps'],
  quickActions: [
    { id: 'met', label: 'Met someone', set: { tag: 'met' } },
    { id: 'found', label: 'Found something', set: { discovery: true } },
    { id: 'wonder', label: 'Wondering', set: { question: true } },
    { id: 'task', label: 'To do', set: { tag: 'tasks' } },
  ],
  suggestedTags: ['tasks', 'custom notes'],
};
