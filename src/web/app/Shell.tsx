import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { HeaderActionsContext, RouteFocusContext } from '../components/ui/PageHeader';
import { PlusIcon, SearchIcon } from '../components/ui/icons';
import { Tip } from '../components/ui/Tooltip';
import { usePalette } from '../features/search/PaletteProvider';
import { useTags } from '../features/tags/hooks';
import { modLabel } from '../lib/hotkeys';
import { GlobalHotkeys } from './GlobalHotkeys';
import { useSections } from '../features/settings/useLayout';
import { SECTION_ROUTES, SETTINGS_ITEM, type NavItem } from './nav';
import { useNewNote } from './NewNote';
import { ShortcutsDialog } from './ShortcutsDialog';

function NavLinkItem({ item, className }: { item: NavItem; className: string }) {
  const { pathname } = useLocation();
  const active = item.isActive(pathname);
  return (
    <Link to={item.to} aria-current={active ? 'page' : undefined} className={className}>
      {item.label}
    </Link>
  );
}

function SearchButton() {
  const palette = usePalette();
  return (
    <Tip label="Search and commands" keys={`${modLabel()}K`}>
      <button
        type="button"
        className="btn tap gap-2 text-sm"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={palette.openPalette}
      >
        <SearchIcon />
        <span>Search</span>
        <span className="hidden text-ink-muted wide:inline" aria-hidden="true">
          {modLabel()}K
        </span>
      </button>
    </Tip>
  );
}

/** Pinned tags act as user-defined sections (spec section 5.6). Absent when none are pinned. */
function Pinned({ className }: { className: string }) {
  const tags = useTags();
  const pinned = (tags.data ?? []).filter((t) => t.pinned).slice(0, 8);
  if (pinned.length === 0) return null;
  return (
    <div className="mt-6">
      <p className="px-3 pb-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        Pinned
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {pinned.map((tag) => (
          <li key={tag.id}>
            <Link to={`/journal?tag=${encodeURIComponent(tag.name)}`} className={className}>
              #{tag.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * App shell (spec section 8.1): a left rail at 900px and wider, a top bar plus bottom tab bar
 * below that. The content column is centred and capped at 44rem.
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

  const railLink =
    'tap block rounded-control px-3 py-1.5 no-underline text-ink hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-semibold';
  const tabLink =
    'tap flex flex-1 items-center justify-center py-3 no-underline text-ink-muted aria-[current=page]:text-accent aria-[current=page]:font-semibold';

  return (
    <RouteFocusContext value={navigated}>
      <HeaderActionsContext value={<SearchButton />}>
        <div className="min-h-screen wide:grid wide:grid-cols-[13rem_1fr]">
          <a
            href="#main"
            className="sr-only z-50 rounded-control bg-raised text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
          >
            Skip to content
          </a>

          <nav
            aria-label="Primary"
            className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-rule px-3 py-6 wide:flex"
          >
            <p className="px-3 pb-3 text-xl font-semibold">Mossnote</p>
            <button
              type="button"
              className="btn tap mb-4 justify-start"
              aria-keyshortcuts="n"
              onClick={() => {
                newNote.requestNewNote();
              }}
            >
              New note
            </button>
            <ul className="flex flex-col gap-1">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLinkItem item={item} className={railLink} />
                </li>
              ))}
            </ul>
            <Pinned className={railLink} />
            <div className="mt-auto pt-6">
              <NavLinkItem item={SETTINGS_ITEM} className={railLink} />
            </div>
          </nav>

          <div className="min-w-0 pb-16 wide:pb-0">
            <div className={`mx-auto w-full px-4 ${editorRoute ? 'max-w-none' : 'max-w-[44rem]'}`}>
              <main id="main" tabIndex={-1} className="pb-8 outline-none">
                <Outlet />
              </main>
            </div>
          </div>

          <button
            type="button"
            aria-label="New note"
            aria-keyshortcuts="n"
            onClick={() => {
              newNote.requestNewNote();
            }}
            className="fixed right-4 bottom-20 z-30 flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float wide:hidden"
          >
            <PlusIcon className="size-6" />
          </button>

          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-20 flex border-t border-rule bg-paper wide:hidden"
          >
            {navItems.map((item) => (
              <NavLinkItem key={item.to} item={item} className={tabLink} />
            ))}
          </nav>
        </div>
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
