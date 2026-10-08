import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupInfo } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api, ApiError } from '../../lib/api';
import { invalidateEverywhere } from '../../lib/broadcast';
import { formatBytes, formatDateTime } from '../../lib/format';
import { journalNav } from '../../lib/journal';
import { WHERE_IT_LIVES } from '../../lib/mode';
import { queryKeys } from '../../lib/queryKeys';

const REASON: Record<BackupInfo['reason'], string> = {
  auto: 'Automatic',
  manual: 'Made by you',
  'pre-migration': 'Before an upgrade',
  'pre-import': 'Before an import',
  'pre-restore': 'Before a restore',
};

const ACTION = 'tap rounded-md px-2 text-sm underline';

/**
 * The open journal's snapshots, newest first, with restore and delete. A restore saves the
 * journal as it is now first, so it can be undone by restoring that snapshot.
 */
export function BackupsList() {
  const client = useQueryClient();
  const backups = useQuery({ queryKey: queryKeys.backups, queryFn: api.backups });
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const items = backups.data?.items ?? [];

  const restore = (snapshot: BackupInfo) => {
    setMessage(null);
    setFailed(false);
    api
      .restoreBackup(snapshot.name)
      .then(() => {
        // Everything on screen came from the journal that was just replaced.
        journalNav.reload();
      })
      .catch((e: unknown) => {
        setFailed(true);
        setMessage(
          e instanceof ApiError
            ? e.message
            : "Couldn't restore that snapshot. Nothing was changed.",
        );
      });
  };

  const remove = (snapshot: BackupInfo) => {
    setMessage(null);
    setFailed(false);
    api
      .deleteBackup(snapshot.name)
      .then(() => {
        setMessage('Snapshot deleted.');
        return invalidateEverywhere(client, [queryKeys.backups, queryKeys.dataInfo]);
      })
      .catch((e: unknown) => {
        setFailed(true);
        setMessage(e instanceof ApiError ? e.message : "Couldn't delete that snapshot.");
      });
  };

  return (
    <div>
      <h3 className="font-semibold">Snapshots</h3>
      <p className="mb-2 text-sm text-ink-muted">
        A snapshot is a full copy of this journal at one moment. Restoring one puts the journal back
        to that moment, after saving the journal as it is now.
      </p>
      {items.length === 0 ? (
        <p className="text-ink-muted">
          No snapshots yet. Mossnote takes one each day you use it, and before any upgrade or
          import.
        </p>
      ) : (
        <ul aria-label="Snapshots" className="m-0 list-none p-0">
          {items.map((snapshot) => (
            <li
              key={snapshot.name}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-2"
            >
              <time dateTime={snapshot.takenAt} className="min-w-40">
                {formatDateTime(snapshot.takenAt)}
              </time>
              <span className="flex-1 text-sm text-ink-muted">
                {REASON[snapshot.reason]} · {formatBytes(snapshot.size)}
              </span>
              <span className="flex">
                <button
                  type="button"
                  className={ACTION}
                  aria-label={`Restore the snapshot from ${formatDateTime(snapshot.takenAt)}`}
                  onClick={() => {
                    setRestoring(snapshot);
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={`${ACTION} text-danger`}
                  aria-label={`Delete the snapshot from ${formatDateTime(snapshot.takenAt)}`}
                  onClick={() => {
                    setDeleting(snapshot);
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
        className={`mt-2 text-sm ${failed ? 'text-danger' : 'text-ink-muted'}`}
      >
        {message}
      </p>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
        title="Restore this snapshot?"
        message={
          restoring
            ? `Your journal goes back to how it was on ${formatDateTime(restoring.takenAt)}. What you have now is saved as a snapshot first, so you can come back to it.`
            : ''
        }
        confirmLabel="Restore"
        danger
        onConfirm={() => {
          if (restoring) restore(restoring);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this snapshot?"
        message={`The snapshot is removed from ${WHERE_IT_LIVES.snapshots}. The journal itself is not touched. This can't be undone.`}
        confirmLabel="Delete snapshot"
        danger
        onConfirm={() => {
          if (deleting) remove(deleting);
        }}
      />
    </div>
  );
}
