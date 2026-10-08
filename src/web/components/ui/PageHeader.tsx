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

/**
 * Tells pages whether the app has already shown its first screen. Each page mounts its own
 * header, so "first load" cannot be tracked per header: the shell owns it. Without a provider,
 * headings are focused on every mount.
 */
/** Controls shown at the right of every page header (Search, New note), supplied by the shell. */
export const HeaderActionsContext = createContext<ReactNode>(null);

export const RouteFocusContext = createContext<RefObject<boolean>>({ current: true });

/** The title with one word set in italic accent, when that word is in it. */
function TitleText({ title, accent: wanted }: { title: string; accent?: string | true }) {
  const words = title.trim().split(/\s+/);
  const accent = wanted === true ? (words.length > 1 ? words.at(-1) : undefined) : wanted;
  const at = accent ? title.lastIndexOf(accent) : -1;
  if (!accent || at < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, at)}
      <em>{accent}</em>
      {title.slice(at + accent.length)}
    </>
  );
}

/**
 * The page's single h1 with an optional one-line intro. It sets the document title and, on route
 * changes (not on first load), moves focus to the heading. Below 900px, where no sidebar names
 * the journal, a caption above the title does. The title is large serif; `accent` sets one word
 * of it in italic, and `display` replaces the visible heading (Today's date) while `title` stays
 * its accessible name and the tab title.
 */
export function PageHeader({
  title,
  documentTitle,
  accent,
  intro,
  display,
  hidden = false,
}: {
  title: string;
  documentTitle?: string;
  /** One word to set in italic, or `true` for the last word of a title with two or more. */
  accent?: string | true;
  intro?: ReactNode;
  display?: ReactNode;
  /** The screen shows its own title (the map editor's name field); the h1 stays for screen readers. */
  hidden?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();
  const navigated = useContext(RouteFocusContext);
  const actions = useContext(HeaderActionsContext);
  const journal = useActiveJournal();

  useEffect(() => {
    document.title = `${documentTitle ?? title} · Mossnote`;
  }, [title, documentTitle]);

  useEffect(() => {
    // Not on first load: the composer owns initial focus. Afterwards, every route
    // change moves focus to the page heading.
    if (navigated.current) ref.current?.focus();
  }, [key, navigated]);

  if (hidden) {
    return (
      <h1 ref={ref} tabIndex={-1} className="sr-only">
        {title}
      </h1>
    );
  }

  return (
    <header className="flex items-start justify-between gap-3 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-5 phone:pt-8 phone:pb-6">
      <div className="min-w-0">
        {journal ? (
          <p className="mb-1 truncate text-sm text-ink-muted wide:hidden">{journal.name}</p>
        ) : null}
        <h1
          ref={ref}
          tabIndex={-1}
          aria-label={display ? title : undefined}
          className="page-title break-words outline-offset-4"
        >
          {display ?? <TitleText title={title} accent={accent} />}
        </h1>
        {intro ? <p className="page-intro">{intro}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 phone:hidden">{actions}</div>
    </header>
  );
}
