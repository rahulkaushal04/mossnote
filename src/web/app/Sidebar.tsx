import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';
import { Kbd } from '../components/ui/Kbd';
import { LockIcon, PlusIcon, SearchIcon } from '../components/ui/icons';
import { JournalSwitcher } from '../features/journals/JournalSwitcher';
import { useActiveJournal } from '../features/journals/hooks';
import { usePalette } from '../features/search/PaletteProvider';
import { useTags } from '../features/tags/hooks';
import { modLabel } from '../lib/hotkeys';
import { WHERE_IT_LIVES } from '../lib/mode';
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
      <item.icon className="size-4.5 shrink-0" />
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
              <span aria-hidden="true" className="w-4.5 text-center text-ink-muted">
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
    <nav aria-label="Primary" className="side-panel hidden w-(--sidebar-w) shrink-0 wide:flex">
      <p className="flex items-center gap-2 px-2.5 pt-1 pb-3 font-serif text-lg font-medium tracking-tight">
        <Logo className="size-7 shrink-0" />
        Mossnote
      </p>
      <JournalSwitcher className="mb-3 w-full" />
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
        icon={<PlusIcon className="size-4.5" />}
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
      <div className="mt-auto flex flex-col gap-1 pt-6">
        {/* The promise the whole app rests on, kept in view and in plain words. */}
        <p className="side-note">
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Stays {WHERE_IT_LIVES.place}
        </p>
        <SideLink item={SETTINGS_ITEM} />
      </div>
    </nav>
  );
}
