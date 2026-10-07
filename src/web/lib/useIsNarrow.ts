import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 899px)';

function subscribe(listener: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia(QUERY);
  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}

/** True below the 900px breakpoint, where dialogs become sheets and the rail becomes a tab bar. */
export const useIsNarrow = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === 'function' && matchMedia(QUERY).matches,
    () => false,
  );
