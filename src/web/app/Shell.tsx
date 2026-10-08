import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { HeaderActionsContext, RouteFocusContext } from '../components/ui/PageHeader';
import { IconButton } from '../components/ui/IconButton';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { Tip } from '../components/ui/Tooltip';
import { usePalette } from '../features/search/PaletteProvider';
import { modLabel } from '../lib/hotkeys';
import { useKeyboardInset } from '../lib/useKeyboardInset';
import { useIsPhone } from '../lib/useViewport';
import { GlobalHotkeys } from './GlobalHotkeys';
import { useSections } from '../features/settings/useLayout';
import { BottomNav } from './BottomNav';
import { MoreSheet } from './MoreSheet';
import { SECTION_ROUTES, type NavItem } from './nav';
import { useNewNote } from './NewNote';
import { Rail } from './Rail';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Sidebar } from './Sidebar';

/** Search for a phone's page header. From 640px the rail or the sidebar holds Search. */
function SearchButton() {
  const palette = usePalette();
  return (
    <Tip label="Search and commands" keys={`${modLabel()}K`}>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={palette.openPalette}
      >
        <SearchIcon className="size-5" />
      </button>
    </Tip>
  );
}

/**
 * App shell, one navigation per device: from 900px an inset sidebar (journal switcher, search
 * field, New note, sections with counts, pinned tags); from 640px a slim icon rail; below that
 * a floating bottom bar whose last tab, More, holds the journals, pinned tags and Settings.
 * The content is one reading column (44rem) centred in the space that is left.
 */
export function Shell() {
  const { pathname } = useLocation();
  // The map editor is a drawing surface and uses the whole width; every other page is a reading column.
  const editorRoute = /^\/maps\/[^/]+$/.test(pathname);
  const navItems: NavItem[] = useSections()
    .filter((s) => !s.hidden)
    .map((s) => ({ ...SECTION_ROUTES[s.id], id: s.id, label: s.label }));
  // Child effects run before this one, so the first page sees `false` and later pages see `true`.
  const navigated = useRef(false);
  useEffect(() => {
    navigated.current = true;
  }, []);
  const newNote = useNewNote();
  const [shortcuts, setShortcuts] = useState(false);
  const [more, setMore] = useState(false);
  // The bottom bar is fixed, where an on-screen keyboard would sit on top of the composer.
  const keyboardOpen = useKeyboardInset() > 0;
  // The map editor is full-bleed on a phone: no bottom bar, so the canvas keeps the screen.
  const phone = useIsPhone();
  const immersive = editorRoute && phone;
  const requestNewNote = () => {
    newNote.requestNewNote();
  };
  const openMore = () => {
    setMore(true);
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
              onClick={requestNewNote}
            />
          </>
        }
      >
        <div className="min-h-screen phone:flex">
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-raised text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
          >
            Skip to content
          </a>

          <Sidebar items={navItems} onNewNote={requestNewNote} />
          <Rail items={navItems} onNewNote={requestNewNote} onMore={openMore} />

          <div
            className={`min-w-0 flex-1 phone:pb-0 ${immersive ? 'pb-[env(safe-area-inset-bottom)]' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'}`}
          >
            <div
              className={`mx-auto w-full px-4 phone:px-8 ${editorRoute ? 'max-w-none' : 'max-w-[calc(var(--column)+4rem)]'}`}
            >
              <main id="main" tabIndex={-1} className="pb-10 outline-none">
                <Outlet />
              </main>
            </div>
          </div>

          <BottomNav items={navItems} hidden={keyboardOpen || immersive} onMore={openMore} />
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
