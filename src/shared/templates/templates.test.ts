import { describe, expect, it } from 'vitest';
import { COUNTER_CALENDAR, DEFAULT_CALENDAR } from '../constants';
import {
  ALWAYS_VISIBLE,
  calendarForTemplate,
  templateForLegacyCalendar,
  templateUses,
  DEFAULT_LAYOUT,
  SECTION_IDS,
  TEMPLATES,
  isDefaultLayout,
  resolveSections,
  templateById,
  termsFor,
} from '.';

describe('templates', () => {
  it('are exactly Default and Stardew Valley', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['default', 'stardew']);
  });

  it('have unique ids and name every section', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) {
      expect(Object.keys(template.terms).sort()).toEqual([...SECTION_IDS].sort());
      // Every template has Today and Journal, no section twice, and only real sections.
      expect(new Set(template.order).size).toBe(template.order.length);
      for (const id of ALWAYS_VISIBLE) expect(template.order).toContain(id);
      for (const id of template.order) expect(SECTION_IDS).toContain(id);
      for (const terms of Object.values(template.terms)) {
        expect(terms.label).not.toBe('');
        expect(terms.many).not.toBe('');
      }
    }
  });

  it('only ever offer short vocabulary: quick action labels and tags are plain words', () => {
    for (const template of TEMPLATES) {
      for (const action of template.quickActions) {
        expect(action.label.length).toBeLessThanOrEqual(24);
        expect(Object.keys(action.set).length).toBe(1);
      }
      for (const tag of template.suggestedTags) expect(tag.length).toBeLessThanOrEqual(40);
    }
  });

  it('fall back to the default for an unknown id', () => {
    expect(templateById('no-such-game').id).toBe('default');
  });
});

describe('the Default template', () => {
  const plain = templateById('default');

  it('has Today, Journal, People and Maps and no Farm', () => {
    expect(plain.order).toEqual(['today', 'journal', 'people', 'maps']);
    expect(templateUses('default', 'farm')).toBe(false);
    expect(templateUses('default', 'people')).toBe(true);
  });

  it('has no game concepts: no quick actions, no suggested tags, a day counter', () => {
    expect(plain.quickActions).toEqual([]);
    expect(plain.suggestedTags).toEqual([]);
    expect(calendarForTemplate('default')).toEqual(COUNTER_CALENDAR);
    // The unused farm section's keys are structural; what a person could read is the wording.
    const words = JSON.stringify([
      plain.name,
      plain.about,
      ...Object.values(plain.terms).flatMap((t) => [t.label, t.one, t.many]),
    ]).toLowerCase();
    for (const word of ['farm', 'season', 'spring', 'crop', 'stardew']) {
      expect(words, word).not.toContain(word);
    }
  });

  it('keeps Farm only in the Stardew Valley template, with the seasons calendar', () => {
    expect(templateUses('stardew', 'farm')).toBe(true);
    expect(calendarForTemplate('stardew')).toEqual(DEFAULT_CALENDAR);
    expect(templateById('stardew').quickActions.length).toBeGreaterThan(0);
  });

  it('detects the template of a journal with no stored layout from its calendar', () => {
    expect(templateForLegacyCalendar(DEFAULT_CALENDAR)).toBe('stardew');
    expect(templateForLegacyCalendar(COUNTER_CALENDAR)).toBe('default');
  });
});

describe('resolveSections', () => {
  it('follows the template order with the template names', () => {
    const sections = resolveSections({ ...DEFAULT_LAYOUT, template: 'stardew' });
    expect(sections.map((s) => s.id)).toEqual(['today', 'journal', 'people', 'farm', 'maps']);
    expect(sections.find((s) => s.id === 'people')?.label).toBe('NPCs');
    expect(resolveSections(DEFAULT_LAYOUT).map((s) => s.id)).toEqual([
      'today',
      'journal',
      'people',
      'maps',
    ]);
  });

  it('applies the user order first, then the rest', () => {
    const sections = resolveSections({
      ...DEFAULT_LAYOUT,
      template: 'stardew',
      order: ['maps', 'farm'],
    });
    expect(sections.map((s) => s.id)).toEqual(['maps', 'farm', 'today', 'journal', 'people']);
  });

  it('ignores a stored section the template does not have', () => {
    const sections = resolveSections({ ...DEFAULT_LAYOUT, order: ['farm', 'maps'] });
    expect(sections.map((s) => s.id)).toEqual(['maps', 'today', 'journal', 'people']);
  });

  it('renames, hides, and never hides Today or Journal', () => {
    const sections = resolveSections({
      ...DEFAULT_LAYOUT,
      template: 'stardew',
      hidden: ['today', 'journal', 'farm'],
      labels: { people: 'Neighbours' },
    });
    const by = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(by.people).toMatchObject({
      label: 'Neighbours',
      renamed: true,
      templateLabel: 'NPCs',
    });
    expect(by.farm?.hidden).toBe(true);
    for (const id of ALWAYS_VISIBLE) expect(by[id]?.hidden).toBe(false);
  });

  it('keeps nouns from the template when a section is renamed', () => {
    const terms = termsFor({ ...DEFAULT_LAYOUT, labels: { people: 'Neighbours' } });
    expect(terms.people).toMatchObject({ label: 'Neighbours', one: 'person', many: 'people' });
  });

  it('recognises the default layout', () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, hidden: ['people'] })).toBe(false);
  });
});
