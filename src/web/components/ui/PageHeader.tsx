import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router';
import { useActiveJournal } from '../../features/journals/hooks';
import { useIsPhone } from '../../lib/useViewport';

/**
 * Tells pages whether the app has already shown its first screen. Each page mounts its own
 * header, so "first load" cannot be tracked per header: the shell owns it. Without a provider,
 * headings are focused on every mount.
 */
/** Controls shown at the right of every page header (Search, New note), supplied by the shell. */
export const HeaderActionsContext = createContext<ReactNode>(null);

export const RouteFocusContext = createContext<RefObject<boolean>>({ current: true });

/**
 * The page's single h1 inside a sticky header. It sets the document
 * title and, on route changes (not on first load), moves focus to the heading. Below the
 * 900px breakpoint, where there is no rail to name the journal, a caption above the title does.
 */
export function PageHeader({
  title,
  documentTitle,
  immersiveOnPhone = false,
}: {
  title: string;
  documentTitle?: string;
  /** A full-bleed screen (the map editor) hides the visible header on a phone; the h1 stays for screen readers. */
  immersiveOnPhone?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();
  const navigated = useContext(RouteFocusContext);
  const actions = useContext(HeaderActionsContext);
  const journal = useActiveJournal();
  const phone = useIsPhone();

  useEffect(() => {
    document.title = `${documentTitle ?? title} · Mossnote`;
  }, [title, documentTitle]);

  useEffect(() => {
    // Not on first load: the composer owns initial focus. Afterwards, every route
    // change moves focus to the page heading.
    if (navigated.current) ref.current?.focus();
  }, [key, navigated]);

  if (immersiveOnPhone && phone) {
    return (
      <h1 ref={ref} tabIndex={-1} className="sr-only">
        {title}
      </h1>
    );
  }

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper pt-[env(safe-area-inset-top)]">
      <div className="min-w-0 py-2">
        {journal ? (
          <p className="truncate text-sm text-ink-muted wide:hidden">{journal.name}</p>
        ) : null}
        <h1
          ref={ref}
          tabIndex={-1}
          className="truncate font-serif text-xl font-semibold outline-offset-4"
        >
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}
