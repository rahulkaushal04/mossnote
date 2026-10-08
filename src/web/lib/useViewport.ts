import { useSyncExternalStore } from 'react';

function subscribeTo(query: string) {
  return (listener: () => void): (() => void) => {
    if (typeof matchMedia !== 'function') return () => undefined;
    const list = matchMedia(query);
    list.addEventListener('change', listener);
    return () => {
      list.removeEventListener('change', listener);
    };
  };
}

/** Follow a CSS media query. False where there is no `matchMedia` (a first render before mount). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}

/** Below the 900px breakpoint: the rail becomes a tab bar and the map editor loses its side panel. */
export const useIsNarrow = (): boolean => useMediaQuery('(max-width: 899px)');

/** Below 640px: dialogs, menus and popovers become bottom sheets. */
export const useIsPhone = (): boolean => useMediaQuery('(max-width: 639px)');
