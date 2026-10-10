import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { JournalInfo } from '@shared/types';
import { DownloadLink } from '../../components/DownloadLink';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { broadcastJournalSwitched, invalidateEverywhere } from '../../lib/broadcast';
import { showJournal } from '../../lib/journal';
import { WHERE_IT_LIVES } from '../../lib/mode';
import { formatBytes, plural } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { journalProblem } from './hooks';
import { NewJournalForm } from './NewJournalForm';

/** "New journal": name and template, then the app opens on it. */
export function NewJournalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New journal"
      description="Each journal has its own notes, people, maps and calendar. Your other journals stay as they are."
    >
      <NewJournalForm
        idPrefix="new-journal"
        submitLabel="Create journal"
        busy={busy}
        error={error}
        initialName=""
        actions={
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </button>
        }
        onSubmit={(input) => {
          setBusy(true);
          setError(null);
          api
            .createJournal(input)
            .then((made) => {
              broadcastJournalSwitched(made.id);
              showJournal();
            })
            .catch((e: unknown) => {
              setBusy(false);
              setError(journalProblem(e, "Couldn't create the journal. Nothing was changed."));
            });
        }}
      />
    </Dialog>
  );
}

/** Rename a journal. Only the name people see changes; its file and its data stay as they are. */
export function RenameJournalDialog({
  journal,
  onClose,
}: {
  journal: JournalInfo | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={journal !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Rename journal"
    >
      {journal ? <RenameForm key={journal.id} journal={journal} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RenameForm({ journal, onClose }: { journal: JournalInfo; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(journal.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = name.trim() === journal.name;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '') {
          setError('Give the journal a name.');
          return;
        }
        if (unchanged) {
          onClose();
          return;
        }
        setBusy(true);
        setError(null);
        api
          .renameJournal(journal.id, name.trim())
          .then(() => invalidateEverywhere(client, [queryKeys.journals, queryKeys.dataInfo]))
          .then(onClose)
          .catch((e: unknown) => {
            setBusy(false);
            setError(journalProblem(e, "Couldn't rename the journal."));
          });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="rename-journal" className="font-semibold">
          Journal name
        </label>
        <input
          id="rename-journal"
          value={name}
          maxLength={60}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog has this one field
          autoFocus
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="field-input"
        />
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn tap" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary tap" disabled={busy}>
          Save name
        </button>
      </div>
    </form>
  );
}

/**
 * Deleting a journal asks for its name, offers a copy to download first and keeps a last copy in
 * the backups folder unless that is switched off. Nothing is deleted until the name matches.
 */
export function DeleteJournalDialog({
  journal,
  onClose,
}: {
  journal: JournalInfo | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={journal !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={journal ? `Delete “${journal.name}”?` : 'Delete journal'}
    >
      {journal ? <DeleteForm key={journal.id} journal={journal} onClose={onClose} /> : null}
    </Dialog>
  );
}

function DeleteForm({ journal, onClose }: { journal: JournalInfo; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === journal.name;
  const counts = journal.counts;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!matches || busy) return;
        setBusy(true);
        setError(null);
        api
          .deleteJournal(journal.id, { confirmName: typed, finalSnapshot: keepCopy })
          .then((result) => {
            broadcastJournalSwitched(result.active);
            showJournal();
          })
          .catch((e: unknown) => {
            setBusy(false);
            setError(journalProblem(e, "Couldn't delete the journal. Nothing was changed."));
          });
      }}
    >
      <p>
        This removes the journal from {WHERE_IT_LIVES.removeFrom}
        {counts
          ? `, with its ${plural(counts.notes, 'note')}, ${plural(counts.people, 'person', 'people')} and ${plural(counts.maps, 'map')}`
          : ''}
        . You can&apos;t undo this in Mossnote.
      </p>
      <div>
        <p className="font-semibold">Want a copy first?</p>
        <p className="text-sm text-ink-muted">
          Download one now ({formatBytes(journal.bytes)} on disk). You can open either file without
          Mossnote.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <DownloadLink
            className="btn tap no-underline"
            path={`/api/journals/${journal.id}/export.json`}
            journalId={journal.id}
          >
            Download JSON
          </DownloadLink>
          <DownloadLink
            className="btn tap no-underline"
            path={`/api/journals/${journal.id}/export.md`}
            journalId={journal.id}
          >
            Download Markdown
          </DownloadLink>
        </div>
      </div>
      <label className="tap flex items-start gap-3">
        <input
          type="checkbox"
          checked={keepCopy}
          onChange={(e) => {
            setKeepCopy(e.target.checked);
          }}
          className="mt-1 size-4 accent-accent"
        />
        <span>
          Keep a last copy {WHERE_IT_LIVES.lastCopy}
          <span className="block text-sm text-ink-muted">
            Recommended. It&apos;s a snapshot file you can open later or copy back.
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirm-journal-name" className="font-semibold">
          Type the journal&apos;s name to confirm
        </label>
        <input
          id="confirm-journal-name"
          value={typed}
          autoComplete="off"
          aria-describedby="confirm-journal-hint"
          onChange={(e) => {
            setTyped(e.target.value);
          }}
          className="field-input"
        />
        <p id="confirm-journal-hint" className="text-sm text-ink-muted">
          Type <strong>{journal.name}</strong> exactly.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn tap" onClick={onClose}>
          Keep it
        </button>
        <button
          type="submit"
          className="btn tap border-danger text-danger disabled:opacity-50"
          disabled={!matches || busy}
        >
          Delete journal
        </button>
      </div>
    </form>
  );
}
