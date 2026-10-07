import { useMemo } from 'react';
import {
  DEFAULT_LAYOUT,
  resolveSections,
  termsFor,
  templateById,
  templateUses,
  type Layout,
  type SectionId,
} from '@shared/templates';
import { useSettings } from './useSettings';

/** The saved layout, or the defaults while settings are loading (never blocks the screen). */
export function useLayout(): Layout {
  const settings = useSettings();
  return settings.data?.layout ?? DEFAULT_LAYOUT;
}

/** Sections in the user's order, hidden ones included (Settings shows them). */
export function useSections() {
  const layout = useLayout();
  return useMemo(() => resolveSections(layout), [layout]);
}

/** What records are called right now: `terms.people.label`, `terms.farm.one`, and so on. */
export function useTerms() {
  const layout = useLayout();
  return useMemo(() => termsFor(layout), [layout]);
}

export function useTemplate() {
  const layout = useLayout();
  return templateById(layout.template);
}

/** True when this journal's template has the section. Farm screens, search and links check this. */
export function useUsesSection(section: SectionId): boolean {
  return templateUses(useLayout().template, section);
}
