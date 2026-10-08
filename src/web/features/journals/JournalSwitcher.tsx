import { useState } from 'react';
import { Link } from 'react-router';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu';
import { templateById } from '@shared/templates';
import { useJournals, useSwitchJournal } from './hooks';
import { NewJournalDialog, RenameJournalDialog } from './JournalDialogs';

/**
 * The journal name in the navigation, as a menu: switch, make a new one, rename this one or go to
 * the full list in Settings. Switching reloads the app on the other journal, which keeps every
 * screen, cache and draft from mixing journals.
 */
export function JournalSwitcher({ className = '' }: { className?: string }) {
  const journals = useJournals();
  const switchTo = useSwitchJournal();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const list = journals.data;
  const active = list?.items.find((j) => j.id === list.active);
  if (!list || !active) return null;

  // Radix returns focus to the trigger as a menu closes; the dialog notes its opener right after.
  const later = (fn: () => void) => () => {
    setTimeout(fn, 0);
  };

  return (
    <>
      {/* Not modal: this is navigation, and the page behind it stays in the accessibility tree. */}
      <Menu modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            className={`btn tap max-w-full justify-between gap-2 text-left ${className}`}
            aria-label={`Journal: ${active.name}. Switch journal`}
          >
            <span className="truncate">{active.name}</span>
            <span aria-hidden="true">▾</span>
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="min-w-60">
          {list.items.map((journal) => (
            <MenuItem
              key={journal.id}
              disabled={journal.status !== 'ok' && !journal.active}
              aria-current={journal.active ? 'true' : undefined}
              onSelect={() => {
                if (!journal.active) switchTo(journal.id);
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {journal.active ? '✓ ' : ''}
                  {journal.name}
                </span>
                <span className="text-xs text-ink-muted">
                  {journal.status === 'needs_newer_app'
                    ? 'Needs a newer Mossnote'
                    : journal.status === 'unreadable'
                      ? "Can't be read"
                      : templateById(journal.template).name}
                </span>
              </span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onSelect={later(() => {
              setCreating(true);
            })}
          >
            New journal…
          </MenuItem>
          <MenuItem
            onSelect={later(() => {
              setRenaming(true);
            })}
          >
            Rename this journal…
          </MenuItem>
          <MenuItem asChild>
            <Link to="/settings#journals" className="no-underline">
              Manage journals
            </Link>
          </MenuItem>
        </MenuContent>
      </Menu>
      <NewJournalDialog open={creating} onOpenChange={setCreating} />
      <RenameJournalDialog
        journal={renaming ? active : null}
        onClose={() => {
          setRenaming(false);
        }}
      />
    </>
  );
}
