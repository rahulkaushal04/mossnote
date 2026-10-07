import { Dialog } from '../components/ui/Dialog';
import { modLabel } from '../lib/hotkeys';
import { formatKeys, SHORTCUTS } from '../lib/shortcuts';

/** The shortcut list, opened with `?` (spec section 15). */
export function ShortcutsList() {
  const mod = modLabel();
  return (
    <dl className="m-0 flex flex-col gap-3">
      {SHORTCUTS.map((shortcut) => (
        <div
          key={`${shortcut.keys}:${shortcut.scope}`}
          className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 text-sm"
        >
          <dt>
            <kbd className="rounded-control border border-rule bg-surface px-1.5 py-0.5 font-sans">
              {formatKeys(shortcut.keys, mod)}
            </kbd>
          </dt>
          <dd className="m-0">
            {shortcut.action}
            <span className="block text-ink-muted">{shortcut.scope}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <ShortcutsList />
    </Dialog>
  );
}
