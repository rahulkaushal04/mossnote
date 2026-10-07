import { defaultTemplate } from './default';
import { stardewTemplate } from './stardew';
import { SECTION_IDS, type GameTemplate, type SectionId, type SectionTerms } from './types';

export * from './types';

/** Every template that ships. To add a game, add a file here and list it. */
export const TEMPLATES: readonly GameTemplate[] = [defaultTemplate, stardewTemplate];

export const templateById = (id: string): GameTemplate =>
  TEMPLATES.find((t) => t.id === id) ?? defaultTemplate;

/** The customisation a person has made on top of a template. Stored as the `layout` setting. */
export interface Layout {
  template: string;
  /** Section ids in the user's order. Sections not listed follow in the template's order. */
  order: SectionId[];
  hidden: SectionId[];
  labels: Partial<Record<SectionId, string>>;
  quickActions: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  template: defaultTemplate.id,
  order: [],
  hidden: [],
  labels: {},
  quickActions: true,
};

/** Sections that cannot be hidden: the two places notes are written and read. */
export const ALWAYS_VISIBLE: readonly SectionId[] = ['today', 'journal'];

export interface ResolvedSection extends SectionTerms {
  id: SectionId;
  hidden: boolean;
  /** True when the user renamed it. */
  renamed: boolean;
  /** The name the template gives it, for "Reset". */
  templateLabel: string;
}

/** The sections in display order with the user's names applied. */
export function resolveSections(layout: Layout): ResolvedSection[] {
  const template = templateById(layout.template);
  const ordered: SectionId[] = [
    ...layout.order.filter((id, i, all) => all.indexOf(id) === i),
    ...template.order.filter((id) => !layout.order.includes(id)),
  ];
  for (const id of SECTION_IDS) if (!ordered.includes(id)) ordered.push(id);
  return ordered.map((id) => {
    const terms = template.terms[id];
    const custom = layout.labels[id];
    return {
      id,
      ...terms,
      label: custom ?? terms.label,
      renamed: custom !== undefined && custom !== terms.label,
      templateLabel: terms.label,
      hidden: layout.hidden.includes(id) && !ALWAYS_VISIBLE.includes(id),
    };
  });
}

/** What each kind of record is called right now, honouring renamed sections. */
export function termsFor(layout: Layout): Record<SectionId, SectionTerms> {
  const terms = templateById(layout.template).terms;
  const out = { ...terms };
  for (const section of resolveSections(layout)) out[section.id] = section;
  return out;
}

export const isDefaultLayout = (layout: Layout): boolean =>
  layout.template === DEFAULT_LAYOUT.template &&
  layout.order.length === 0 &&
  layout.hidden.length === 0 &&
  Object.keys(layout.labels).length === 0 &&
  layout.quickActions === DEFAULT_LAYOUT.quickActions;
