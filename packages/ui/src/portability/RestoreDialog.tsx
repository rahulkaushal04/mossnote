import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BackupSummary } from '@mossnote/core/rpc';
import { useModal } from '../dialog/useModal';
import type { Client } from '../rpc/client';
import { damagedFiles, dateText, plural } from './summary';

export type RestoreTarget = BackupSummary | 'file';

interface DialogProps {
  target: RestoreTarget;
  onCancel(): void;
  onConfirm(passphrase: string | undefined): Promise<void>;
}

/** Names the backup, says the current data is kept aside, warns when it is incomplete. Focus starts on Cancel. */
function RestoreConfirm({ target, onCancel, onConfirm }: DialogProps) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const passId = useId();
  const { ref, onKeyDown } = useModal(onCancel, cancelRef);
  const b = target === 'file' ? undefined : target;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const p = pass;
    setPass(''); // the passphrase leaves state before the call; it is never kept
    setBusy(true);
    try {
      await onConfirm(p === '' ? undefined : p);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={ref}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>
          {b ? `Restore the backup from ${dateText(b.createdAt)}?` : 'Restore from a backup file?'}
        </h2>
        <div id={descId}>
          <p>
            {b
              ? `This backup has ${b.noteCount === undefined ? 'an unknown number of notes' : plural(b.noteCount, 'note')}. `
              : 'You will choose the file next. '}
            Your current notes are kept aside, not deleted, and Mossnote restarts to apply the
            restore.
          </p>
          {b && (b.damaged ?? 0) > 0 && (
            <p className="pt-warn">
              Warning: this backup is incomplete. {damagedFiles(b.damaged ?? 0)} when it was made
              and cannot be recovered from it.
            </p>
          )}
        </div>
        <form onSubmit={(e) => void submit(e)}>
          {(!b || b.encrypted) && (
            <label htmlFor={passId}>
              {b ? 'Passphrase' : 'Passphrase (only if the file is encrypted)'}{' '}
              <input
                id={passId}
                type="password"
                autoComplete="off"
                value={pass}
                maxLength={1024}
                onChange={(e) => setPass(e.target.value)}
              />
            </label>
          )}
          <div className="modal-actions">
            <button type="button" ref={cancelRef} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="danger" disabled={busy}>
              {b ? 'Restore this backup' : 'Choose file and restore'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface RestoreFlow {
  /** Non-null while the confirm is open: the host renders it INSTEAD of its own modal (one focus trap at a time). */
  dialog: ReactNode;
  ask(t: RestoreTarget): void;
  /** Outcome of starting (cancelled dialog or an error); the job itself is shown by JobView. */
  message: { error: boolean; text: string } | null;
}

export function useRestoreFlow(client: Client): RestoreFlow {
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [message, setMessage] = useState<RestoreFlow['message']>(null);
  const start = async (t: RestoreTarget, passphrase: string | undefined) => {
    const r = await client.call('portability.restoreStart', {
      source: t === 'file' ? { file: true } : { id: t.id },
      ...(passphrase ? { passphrase } : {}),
    });
    setTarget(null);
    if (!r.ok) setMessage({ error: true, text: `Couldn’t start the restore: ${r.error.message}` });
    else if ('cancelled' in r.value)
      setMessage({ error: false, text: 'Restore cancelled. Nothing was changed.' });
    else setMessage(null);
  };
  return {
    dialog: target && (
      <RestoreConfirm
        target={target}
        onCancel={() => setTarget(null)}
        onConfirm={(p) => start(target, p)}
      />
    ),
    ask: (t) => {
      setMessage(null);
      setTarget(t);
    },
    message,
  };
}
