import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/Button';
import { Kbd } from '../components/ui/Kbd';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { JournalSwitcher } from '../features/journals/JournalSwitcher';
import { useActiveJournal } from '../features/journals/hooks';
import { usePalette } from '../features/search/PaletteProvider';
import { useTags } from '../features/tags/hooks';
import { modLabel } from '../lib/hotkeys';
import { countFor, SETTINGS_ITEM, type NavItem } from './nav';

function SideLink({ item, count }: { item: NavItem; count?: number | null }) {
  const { pathname } = useLocation();
  return (
    <Link
      to={item.to}
      viewTransition
      aria-current={item.isActive(pathname) ? 'page' : undefined}
      className="side-link"
    >
      <item.icon className="size-[1.125rem] shrink-0" />
      {item.label}
      {count ? <span className="side-count">{count}</span> : null}
    </Link>
  );
}

/** Pinned tags act as user-defined sections. Absent when none are pinned. */
function Pinned() {
  const tags = useTags();
  const pinned = (tags.data ?? []).filter((t) => t.pinned).slice(0, 8);
  if (pinned.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="section-label pb-1">Pinned</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {pinned.map((tag) => (
          <li key={tag.id}>
            <Link to={`/journal?tag=${encodeURIComponent(tag.name)}`} className="side-link">
              <span aria-hidden="true" className="w-[1.125rem] text-center text-ink-muted">
                #
              </span>
              {tag.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The wide-screen navigation: an inset floating panel with the journal switcher, a search field
 * that shows its shortcut, New note, the sections with their counts, pinned tags and Settings.
 */
export function Sidebar({ items, onNewNote }: { items: NavItem[]; onNewNote: () => void }) {
  const palette = usePalette();
  const counts = useActiveJournal()?.counts;
  return (
    <nav aria-label="Primary" className="side-panel hidden w-[var(--sidebar-w)] shrink-0 wide:flex">
      <p className="px-2.5 pt-1 pb-3 font-serif text-lg font-medium tracking-tight">Mossnote</p>
      <JournalSwitcher className="btn-ghost mb-3 w-full" />
      <button
        type="button"
        className="side-search mb-3"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={palette.openPalette}
      >
        <SearchIcon className="size-4" />
        <span>Search</span>
        <span className="ml-auto">
          <Kbd>{modLabel()}K</Kbd>
        </span>
      </button>
      <Button
        variant="primary"
        icon={<PlusIcon className="size-[1.125rem]" />}
        className="mb-4 justify-start"
        aria-keyshortcuts="n"
        onClick={onNewNote}
      >
        New note
      </Button>
      <p className="section-label pb-1">Sections</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.to}>
            <SideLink item={item} count={item.id ? countFor(item.id, counts) : null} />
          </li>
        ))}
      </ul>
      <Pinned />
      <div className="mt-auto pt-6">
        <SideLink item={SETTINGS_ITEM} />
      </div>
    </nav>
  );
}
