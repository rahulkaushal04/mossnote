import type { ComponentType, SVGProps } from 'react';
import type { SectionId } from '@shared/templates';
import {
  FarmIcon,
  JournalIcon,
  MapIcon,
  PeopleIcon,
  SettingsIcon,
  TodayIcon,
} from '../components/ui/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** True when this item is the current section for the given pathname. */
  isActive: (pathname: string) => boolean;
}

/** Where each section lives. Names and order come from the layout. */
export const SECTION_ROUTES: Record<SectionId, Omit<NavItem, 'label'>> = {
  today: { to: '/', icon: TodayIcon, isActive: (p) => p === '/' || p.startsWith('/day/') },
  journal: {
    to: '/journal',
    icon: JournalIcon,
    isActive: (p) => p === '/journal' || p.startsWith('/notes/'),
  },
  people: {
    to: '/people',
    icon: PeopleIcon,
    isActive: (p) => p === '/people' || p.startsWith('/people/'),
  },
  farm: { to: '/farm', icon: FarmIcon, isActive: (p) => p === '/farm' || p.startsWith('/farm/') },
  maps: { to: '/maps', icon: MapIcon, isActive: (p) => p === '/maps' || p.startsWith('/maps/') },
};

export const SETTINGS_ITEM: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: SettingsIcon,
  isActive: (p) => p === '/settings',
};
