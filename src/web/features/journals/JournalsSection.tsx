import { useState } from 'react';
import { templateById } from '@shared/templates';
import type { JournalInfo } from '@shared/types';
import { DownloadLink } from '../../components/DownloadLink';
import { DownloadIcon } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { broadcastJournalSwitched } from '../../lib/broadcast';
import { formatBytes, plural } from '../../lib/format';
import { showJournal } from '../../lib/journal';
import { WHERE_IT_LIVES } from '../../lib/mode';
import { journalProblem, useJournals } from './hooks';
import { DeleteJournalDialog, NewJournalDialog, RenameJournalDialog } from './JournalDialogs';

const SMALL = 'btn';

function statusLine(journal: JournalInfo): string {
  if (journal.status === 'needs_newer_app') {
    return 'Made with a newer Mossnote. Update the app to open it. Nothing was changed.';
  }
  if (journal.status === 'unreadable') {
    return "Mossnote can't read this file. Nothing was changed.";
  }
  const c = journal.counts;
  const parts = c
    ? [plural(c.notes, 'note'), plural(c.people, 'person', 'people'), plural(c.maps, 'map')]
    : [];
  return [templateById(journal.template).name, ...parts, formatBytes(journal.bytes)].join(' · ');
}

/** Settings → Journals: every journal in the data folder, with switch, rename, download and delete. */
export function JournalsSection() {
  const journals = useJournals();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<JournalInfo | null>(null);
  const [deleting, setDeleting] = useState<JournalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (journal: JournalInfo) => {
    setError(null);
    api
      .activateJournal(journal.id)
      .then(() => {
        broadcastJournalSwitched(journal.id);
        showJournal();
      })
      .catch((e: unknown) => {
        setError(journalProblem(e, "Couldn't open that journal."));
      });
  };

  const items = journals.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted">
        Each journal is {WHERE_IT_LIVES.unit}, with its own notes, calendar and sections. Use one
        for each game or playthrough.
      </p>
      <ul aria-label="Journals" className="m-0 list-none p-0">
        {items.map((journal) => (
          <li
            key={journal.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3"
          >
            <div className="min-w-48 flex-1">
              <p className="m-0 font-semibold">
                {journal.name}
                {journal.active ? (
                  <span className="ml-2 text-sm font-normal text-ink-muted">(open now)</span>
                ) : null}
              </p>
              <p className="m-0 text-sm text-ink-muted">{statusLine(journal)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {journal.active ? null : (
                <button
                  type="button"
                  className={SMALL}
                  disabled={journal.status !== 'ok'}
                  aria-label={`Open ${journal.name}`}
                  onClick={() => {
                    open(journal);
                  }}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={journal.status === 'needs_newer_app'}
                aria-label={`Rename ${journal.name}`}
                onClick={() => {
                  setRenaming(journal);
                }}
              >
                Rename
              </button>
              {journal.status === 'ok' ? (
                <>
                  <DownloadLink
                    className="btn btn-ghost no-underline"
                    aria-label={`Download ${journal.name} as JSON`}
                    path={`/api/journals/${journal.id}/export.json`}
                    journalId={journal.id}
                  >
                    <DownloadIcon className="size-4" />
                    JSON
                  </DownloadLink>
                  <DownloadLink
                    className="btn btn-ghost no-underline"
                    aria-label={`Download ${journal.name} as Markdown`}
                    path={`/api/journals/${journal.id}/export.md`}
                    journalId={journal.id}
                  >
                    <DownloadIcon className="size-4" />
                    Markdown
                  </DownloadLink>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-danger"
                aria-label={`Delete ${journal.name}`}
                onClick={() => {
                  setDeleting(journal);
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setCreating(true);
          }}
        >
          New journal…
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <NewJournalDialog open={creating} onOpenChange={setCreating} />
      <RenameJournalDialog
        journal={renaming}
        onClose={() => {
          setRenaming(null);
        }}
      />
      <DeleteJournalDialog
        journal={deleting}
        onClose={() => {
          setDeleting(null);
        }}
      />
    </div>
  );
}
