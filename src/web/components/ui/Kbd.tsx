import type { ReactNode } from 'react';

/** A shortcut hint such as ⌘K. Hidden from screen readers: the control carries `aria-keyshortcuts`. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden="true" className="kbd">
      {children}
    </kbd>
  );
}
