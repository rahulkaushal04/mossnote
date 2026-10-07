import { describe, expect, it } from 'vitest';
import {
  ALWAYS_VISIBLE,
  DEFAULT_LAYOUT,
  SECTION_IDS,
  TEMPLATES,
  isDefaultLayout,
  resolveSections,
  templateById,
  termsFor,
} from '.';

describe('templates', () => {
  it('have unique ids and name every section', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) {
      expect(Object.keys(template.terms).sort()).toEqual([...SECTION_IDS].sort());
      expect([...template.order].sort()).toEqual([...SECTION_IDS].sort());
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

describe('resolveSections', () => {
  it('follows the template order with the template names', () => {
    const sections = resolveSections({ ...DEFAULT_LAYOUT, template: 'stardew' });
    expect(sections.map((s) => s.id)).toEqual(['today', 'journal', 'people', 'farm', 'maps']);
    expect(sections.find((s) => s.id === 'people')?.label).toBe('NPCs');
  });

  it('applies the user order first, then the rest', () => {
    const sections = resolveSections({ ...DEFAULT_LAYOUT, order: ['maps', 'farm'] });
    expect(sections.map((s) => s.id)).toEqual(['maps', 'farm', 'today', 'journal', 'people']);
  });

  it('renames, hides, and never hides Today or Journal', () => {
    const sections = resolveSections({
      ...DEFAULT_LAYOUT,
      hidden: ['today', 'journal', 'farm'],
      labels: { people: 'Neighbours' },
    });
    const by = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(by.people).toMatchObject({
      label: 'Neighbours',
      renamed: true,
      templateLabel: 'People',
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
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, hidden: ['farm'] })).toBe(false);
  });
});
