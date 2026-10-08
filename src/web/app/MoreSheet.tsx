import { useState } from 'react';
import { Link } from 'react-router';
import { templateById } from '@shared/templates';
import { CheckIcon, ChevronRightIcon, PlusIcon, SettingsIcon } from '../components/ui/icons';
import { Sheet } from '../components/ui/Sheet';
import { NewJournalDialog, RenameJournalDialog } from '../features/journals/JournalDialogs';
import { useJournals, useSwitchJournal } from '../features/journals/hooks';
import { useTags } from '../features/tags/hooks';

/**
 * The phone's "More" tab: the journals (switch, new, rename, manage), pinned tags and Settings.
 * These are the things the rail shows on a wide screen but a tab bar has no room for.
 */
export function MoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const journals = useJournals();
  const tags = useTags();
  const switchTo = useSwitchJournal();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const list = journals.data;
  const active = list?.items.find((j) => j.id === list.active);
  const pinned = (tags.data ?? []).filter((t) => t.pinned).slice(0, 8);
  const close = () => {
    onOpenChange(false);
  };
  // The sheet closes first, so the dialog it opens notes the right element to return focus to.
  const thenOpen = (fn: () => void) => () => {
    close();
    setTimeout(fn, 0);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="More">
        <div className="flex flex-col gap-4">
          {list && active ? (
            <section aria-labelledby="more-journals" className="flex flex-col gap-1">
              <h3 id="more-journals" className="section-label">
                Journals
              </h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {list.items.map((journal) => (
                  <li key={journal.id}>
                    <button
                      type="button"
                      className="sheet-row"
                      disabled={journal.status !== 'ok' && !journal.active}
                      aria-current={journal.active ? 'true' : undefined}
                      onClick={() => {
                        if (journal.active) close();
                        else switchTo(journal.id);
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col text-left">
                        <span className="truncate font-medium">{journal.name}</span>
                        <span className="text-sm text-ink-muted">
                          {journal.status === 'needs_newer_app'
                            ? 'Needs a newer Mossnote'
                            : journal.status === 'unreadable'
                              ? "Can't be read"
                              : templateById(journal.template).name}
                        </span>
                      </span>
                      {journal.active ? <CheckIcon className="size-5 text-accent" /> : null}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="sheet-row"
                    onClick={thenOpen(() => {
                      setCreating(true);
                    })}
                  >
                    <PlusIcon className="size-5" />
                    New journal…
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="sheet-row"
                    onClick={thenOpen(() => {
                      setRenaming(true);
                    })}
                  >
                    Rename this journal…
                  </button>
                </li>
                <li>
                  <Link to="/settings#journals" className="sheet-row" onClick={close}>
                    Manage journals
                    <ChevronRightIcon className="ml-auto size-5 text-ink-muted" />
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}
          {pinned.length > 0 ? (
            <section aria-labelledby="more-pinned" className="flex flex-col gap-1">
              <h3 id="more-pinned" className="section-label">
                Pinned
              </h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {pinned.map((tag) => (
                  <li key={tag.id}>
                    <Link
                      to={`/journal?tag=${encodeURIComponent(tag.name)}`}
                      className="sheet-row"
                      onClick={close}
                    >
                      #{tag.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Link to="/settings" className="sheet-row border-t border-line" onClick={close}>
            <SettingsIcon className="size-5" />
            Settings
          </Link>
        </div>
      </Sheet>
      <NewJournalDialog open={creating} onOpenChange={setCreating} />
      <RenameJournalDialog
        journal={renaming && active ? active : null}
        onClose={() => {
          setRenaming(false);
        }}
      />
    </>
  );
}
