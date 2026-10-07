import type { ReactNode } from 'react';

/** One or two quiet lines, no illustration (spec section 21). */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-base text-ink-muted">{children}</p>;
}
