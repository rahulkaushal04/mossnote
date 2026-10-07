import type { ReactNode } from 'react';

/** One or two quiet lines, no illustration. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-base text-ink-muted">{children}</p>;
}
