import { Link, useLocation } from 'react-router';
import { MoreIcon } from '../components/ui/icons';
import type { NavItem } from './nav';

function TabLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <Link
      to={item.to}
      viewTransition
      aria-current={item.isActive(pathname) ? 'page' : undefined}
      className="tab-item"
    >
      <span className="tab-icon">
        <item.icon />
      </span>
      <span className="tab-label">{item.label}</span>
    </Link>
  );
}

/** The phone navigation: a floating bar with the sections and More, padded for the safe area. */
export function BottomNav({
  items,
  hidden,
  onMore,
}: {
  items: NavItem[];
  /** Hidden while the on-screen keyboard is open, and on the full-bleed map editor. */
  hidden: boolean;
  onMore: () => void;
}) {
  return (
    <nav aria-label="Primary" hidden={hidden} className="dock phone:hidden">
      {items.map((item) => (
        <TabLink key={item.to} item={item} />
      ))}
      <button type="button" className="tab-item" aria-haspopup="dialog" onClick={onMore}>
        <span className="tab-icon">
          <MoreIcon />
        </span>
        <span className="tab-label">More</span>
      </button>
    </nav>
  );
}
