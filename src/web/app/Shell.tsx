import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Button } from '../components/ui/Button';
import { HeaderActionsContext, RouteFocusContext } from '../components/ui/PageHeader';
import { IconButton } from '../components/ui/IconButton';
import { MoreIcon, PlusIcon, SearchIcon } from '../components/ui/icons';
import { Tip } from '../components/ui/Tooltip';
import { usePalette } from '../features/search/PaletteProvider';
import { JournalSwitcher } from '../features/journals/JournalSwitcher';
import { useTags } from '../features/tags/hooks';
import { modLabel } from '../lib/hotkeys';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { useIsPhone } from '../lib/useViewport';
import { GlobalHotkeys } from './GlobalHotkeys';
import { useSections } from '../features/settings/useLayout';
import { MoreSheet } from './MoreSheet';
import { SECTION_ROUTES, SETTINGS_ITEM, type NavItem } from './nav';
import { useNewNote } from './NewNote';
import { ShortcutsDialog } from './ShortcutsDialog';

function RailLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <Link
      to={item.to}
      aria-current={item.isActive(pathname) ? 'page' : undefined}
      className="rail-link"
    >
      <item.icon className="size-5 shrink-0" />
      {item.label}
    </Link>
  );
}

function TabLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <Link
      to={item.to}
      aria-current={item.isActive(pathname) ? 'page' : undefined}
      className="tab-item"
    >
      <span className="tab-icon">
        <item.icon />
      </span>
      {item.label}
    </Link>
  );
}

/** Opens the palette. An icon on a phone, "Search" with its shortcut from 640px up. */
function SearchButton() {
  const palette = usePalette();
  return (
    <Tip label="Search and commands" keys={`${modLabel()}K`}>
      <button
        type="button"
        className="btn btn-ghost gap-2"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={palette.openPalette}
      >
        <SearchIcon className="size-5" />
        <span className="sr-only phone:not-sr-only">Search</span>
        <span className="hidden text-ink-muted wide:inline" aria-hidden="true">
          {modLabel()}K
        </span>
      </button>
    </Tip>
  );
}

/** Pinned tags act as user-defined sections. Absent when none are pinned. */
function Pinned() {
  const tags = useTags();
  const pinned = (tags.data ?? []).filter((t) => t.pinned).slice(0, 8);
  if (pinned.length === 0) return null;
  return (
    <div className="mt-6">
      <p className="section-label pb-1">Pinned</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {pinned.map((tag) => (
          <li key={tag.id}>
            <Link to={`/journal?tag=${encodeURIComponent(tag.name)}`} className="rail-link">
              #{tag.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * App shell. From 900px: a left rail with the journal switcher, New note, the sections and
 * Settings. Below that: a top bar in each page header (Search, New note) and a bottom tab bar
 * whose last tab, More, holds the journals, pinned tags and Settings. The content column is
 * centred and capped at 44rem (52rem on a wide screen).
 */
export function Shell() {
  const { pathname } = useLocation();
  // The map editor is a drawing surface and uses the whole width; every other page is a reading column.
  const editorRoute = /^\/maps\/[^/]+$/.test(pathname);
  const navItems: NavItem[] = useSections()
    .filter((s) => !s.hidden)
    .map((s) => ({ ...SECTION_ROUTES[s.id], label: s.label }));
  // Child effects run before this one, so the first page sees `false` and later pages see `true`.
  const navigated = useRef(false);
  useEffect(() => {
    navigated.current = true;
  }, []);
  const newNote = useNewNote();
  const [shortcuts, setShortcuts] = useState(false);
  const [more, setMore] = useState(false);
  // The tab bar is fixed to the bottom, where an on-screen keyboard would sit on top of the composer.
  const keyboardOpen = useKeyboardInset() > 0;
  // The map editor is full-bleed on a phone: no tab bar, so the canvas keeps the screen.
  const phone = useIsPhone();
  const immersive = editorRoute && phone;
  const requestNewNote = () => {
    newNote.requestNewNote();
  };

  return (
    <RouteFocusContext value={navigated}>
      <HeaderActionsContext
        value={
          <>
            <SearchButton />
            <IconButton
              label="New note"
              keys="N"
              aria-keyshortcuts="n"
              variant="primary"
              icon={<PlusIcon className="size-5" />}
              className="wide:hidden"
              onClick={requestNewNote}
            />
          </>
        }
      >
        <div className="min-h-screen wide:grid wide:grid-cols-[14rem_1fr]">
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-raised text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
          >
            Skip to content
          </a>

          <nav
            aria-label="Primary"
            className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-line bg-surface px-3 py-6 wide:flex"
          >
            <p className="px-3 pb-4 font-serif text-lg font-semibold">Mossnote</p>
            <JournalSwitcher className="mb-3 w-full" />
            <Button
              variant="primary"
              icon={<PlusIcon className="size-5" />}
              className="mb-4 justify-start"
              aria-keyshortcuts="n"
              onClick={requestNewNote}
            >
              New note
            </Button>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {navItems.map((item) => (
                <li key={item.to}>
                  <RailLink item={item} />
                </li>
              ))}
            </ul>
            <Pinned />
            <div className="mt-auto pt-6">
              <RailLink item={SETTINGS_ITEM} />
            </div>
          </nav>

          <div
            className={`min-w-0 wide:pb-0 ${immersive ? 'pb-[env(safe-area-inset-bottom)]' : 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]'}`}
          >
            <div
              className={`mx-auto w-full px-4 phone:px-6 wide:px-8 ${editorRoute ? 'max-w-none' : 'max-w-[44rem] wide:max-w-[52rem]'}`}
            >
              <main id="main" tabIndex={-1} className="pb-8 outline-none">
                <Outlet />
              </main>
            </div>
          </div>

          <nav
            aria-label="Primary"
            hidden={keyboardOpen || immersive}
            className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] wide:hidden"
          >
            {navItems.map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
            <button
              type="button"
              className="tab-item"
              aria-haspopup="dialog"
              onClick={() => {
                setMore(true);
              }}
            >
              <span className="tab-icon">
                <MoreIcon />
              </span>
              More
            </button>
          </nav>
        </div>
        <MoreSheet open={more} onOpenChange={setMore} />
        <GlobalHotkeys
          onShowShortcuts={() => {
            setShortcuts(true);
          }}
        />
        <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      </HeaderActionsContext>
    </RouteFocusContext>
  );
}
