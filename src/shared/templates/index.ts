import { COUNTER_CALENDAR, DEFAULT_CALENDAR, type Calendar } from '../constants';
import { defaultTemplate } from './default';
import { stardewTemplate } from './stardew';
import { type GameTemplate, type SectionId, type SectionTerms } from './types';

export * from './types';

/** Every template that ships. To add a game, add a file here and list it. */
export const TEMPLATES: readonly GameTemplate[] = [defaultTemplate, stardewTemplate];

export const DEFAULT_TEMPLATE_ID = defaultTemplate.id;

export const isTemplateId = (id: string): boolean => TEMPLATES.some((t) => t.id === id);

export const templateById = (id: string): GameTemplate =>
  TEMPLATES.find((t) => t.id === id) ?? defaultTemplate;

/** True when the template has this section. Routes, navigation, search and export skip the rest. */
export const templateUses = (templateId: string, section: SectionId): boolean =>
  templateById(templateId).order.includes(section);

/** The calendar a new journal made from this template starts with. */
export const calendarForTemplate = (templateId: string): Calendar =>
  templateById(templateId).calendar === 'counter' ? COUNTER_CALENDAR : DEFAULT_CALENDAR;

/**
 * The template of a journal that was made before templates were chosen per journal and so has
 * no stored layout. Those journals all carry the seasons calendar and the Farm section, which now
 * belong to the Stardew Valley template; only a day counter belongs to Default.
 */
export const templateForLegacyCalendar = (calendar: Calendar): string =>
  calendar.counter ? defaultTemplate.id : stardewTemplate.id;

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
  const own = layout.order.filter(
    (id, i, all) => all.indexOf(id) === i && template.order.includes(id),
  );
  const ordered: SectionId[] = [...own, ...template.order.filter((id) => !own.includes(id))];
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
  const out = { ...templateById(layout.template).terms };
  for (const section of resolveSections(layout)) out[section.id] = section;
  return out;
}

export const isDefaultLayout = (layout: Layout): boolean =>
  layout.template === DEFAULT_LAYOUT.template &&
  layout.order.length === 0 &&
  layout.hidden.length === 0 &&
  Object.keys(layout.labels).length === 0 &&
  layout.quickActions === DEFAULT_LAYOUT.quickActions;
