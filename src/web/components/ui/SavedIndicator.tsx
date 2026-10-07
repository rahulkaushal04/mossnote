/** A quiet "Saved" that is announced once per save, never per keystroke (spec section 22). */
export function SavedIndicator({ show }: { show: boolean }) {
  return (
    <span role="status" aria-live="polite" className="text-sm text-ink-muted">
      {show ? 'Saved' : ''}
    </span>
  );
}
