import type { SectionId } from '@shared/templates';

export interface NavItem {
  to: string;
  label: string;
  /** True when this item is the current section for the given pathname. */
  isActive: (pathname: string) => boolean;
}

/** Where each section lives. Names and order come from the layout. */
export const SECTION_ROUTES: Record<SectionId, Omit<NavItem, 'label'>> = {
  today: { to: '/', isActive: (p) => p === '/' || p.startsWith('/day/') },
  journal: { to: '/journal', isActive: (p) => p === '/journal' || p.startsWith('/notes/') },
  people: { to: '/people', isActive: (p) => p === '/people' || p.startsWith('/people/') },
  farm: { to: '/farm', isActive: (p) => p === '/farm' || p.startsWith('/farm/') },
  maps: { to: '/maps', isActive: (p) => p === '/maps' || p.startsWith('/maps/') },
};

export const SETTINGS_ITEM: NavItem = {
  to: '/settings',
  label: 'Settings',
  isActive: (p) => p === '/settings',
};
