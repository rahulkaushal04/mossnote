import { Link, useLocation } from 'react-router';
import { IconButton } from '../components/ui/IconButton';
import { MoreIcon, PlusIcon, SearchIcon } from '../components/ui/icons';
import { Tip } from '../components/ui/Tooltip';
import { usePalette } from '../features/search/PaletteProvider';
import { modLabel } from '../lib/hotkeys';
import { SETTINGS_ITEM, type NavItem } from './nav';

function RailItem({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <Tip label={item.label} side="right">
      <Link
        to={item.to}
        viewTransition
        aria-label={item.label}
        aria-current={item.isActive(pathname) ? 'page' : undefined}
        className="rail-icon"
      >
        <item.icon />
      </Link>
    </Tip>
  );
}

/**
 * The tablet navigation (640 to 899px): a slim inset column of icons with Search and New note on
 * top, and More (journals, pinned tags) at the bottom. Each icon has an accessible name and a
 * tooltip; the labelled version is the wide sidebar.
 */
export function Rail({
  items,
  onNewNote,
  onMore,
}: {
  items: NavItem[];
  onNewNote: () => void;
  onMore: () => void;
}) {
  const palette = usePalette();
  return (
    <nav
      aria-label="Primary"
      className="side-panel hidden w-[var(--rail-w)] shrink-0 items-center gap-1 px-0 phone:flex wide:hidden"
    >
      <Tip label="Search and commands" keys={`${modLabel()}K`} side="right">
        <button
          type="button"
          className="rail-icon"
          aria-label="Search"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={palette.openPalette}
        >
          <SearchIcon />
        </button>
      </Tip>
      <IconButton
        label="New note"
        keys="N"
        aria-keyshortcuts="n"
        variant="primary"
        icon={<PlusIcon className="size-5" />}
        onClick={onNewNote}
      />
      <ul className="m-0 mt-3 flex list-none flex-col items-center gap-1 p-0">
        {items.map((item) => (
          <li key={item.to}>
            <RailItem item={item} />
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-1">
        <RailItem item={SETTINGS_ITEM} />
        <Tip label="More" side="right">
          <button
            type="button"
            className="rail-icon"
            aria-label="More"
            aria-haspopup="dialog"
            onClick={onMore}
          >
            <MoreIcon />
          </button>
        </Tip>
      </div>
    </nav>
  );
}
