import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, useLocation } from 'react-router';

/**
 * Tells pages whether the app has already shown its first screen. Each page mounts its own
 * header, so "first load" cannot be tracked per header: the shell owns it. Without a provider,
 * headings are focused on every mount.
 */
/** Controls shown at the right of every page header (the Search button), supplied by the shell. */
export const HeaderActionsContext = createContext<ReactNode>(null);

export const RouteFocusContext = createContext<RefObject<boolean>>({ current: true });

/**
 * The page's single h1 inside a sticky header. It sets the document
 * title and, on route changes (not on first load), moves focus to the heading.
 */
export function PageHeader({ title, documentTitle }: { title: string; documentTitle?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();
  const navigated = useContext(RouteFocusContext);
  const actions = useContext(HeaderActionsContext);

  useEffect(() => {
    document.title = `${documentTitle ?? title} · Mossnote`;
  }, [title, documentTitle]);

  useEffect(() => {
    // Not on first load: the composer owns initial focus. Afterwards, every route
    // change moves focus to the page heading.
    if (navigated.current) ref.current?.focus();
  }, [key, navigated]);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper py-3">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold outline-offset-4">
        {title}
      </h1>
      <div className="flex items-center gap-3">
        {actions}
        {/* Narrow screens have no rail, so Settings lives in the top bar. */}
        <Link to="/settings" className="tap wide:hidden">
          Settings
        </Link>
      </div>
    </header>
  );
}
