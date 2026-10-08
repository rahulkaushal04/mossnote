import { Dialog } from '../components/ui/Dialog';
import { modLabel } from '../lib/hotkeys';
import { useSections } from '../features/settings/useLayout';
import { formatKeys, goShortcut, SHORTCUTS } from '../lib/shortcuts';

/** The shortcut list, opened with `?`. */
export function ShortcutsList() {
  const mod = modLabel();
  const sections = useSections();
  const go = goShortcut(
    sections.map((s) => s.label),
    sections.some((s) => s.id === 'farm'),
  );
  return (
    <dl className="m-0 flex flex-col gap-3">
      {SHORTCUTS.map((shortcut) => (shortcut.keys.startsWith('g then') ? go : shortcut)).map(
        (shortcut) => (
          <div
            key={`${shortcut.keys}:${shortcut.scope}`}
            className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 text-sm"
          >
            <dt>
              <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans">
                {formatKeys(shortcut.keys, mod)}
              </kbd>
            </dt>
            <dd className="m-0">
              {shortcut.action}
              <span className="block text-ink-muted">{shortcut.scope}</span>
            </dd>
          </div>
        ),
      )}
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
