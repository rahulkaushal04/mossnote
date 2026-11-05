import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { BackupSummary } from '@mossnote/core/rpc';
import { useStore } from '../app/store';
import { formatSize } from '../attachments/types';
import type { Client } from '../rpc/client';
import type { JobStore } from './jobStore';
import type { RestoreTarget } from './RestoreDialog';
import { BACKUP_KIND, damagedFiles, dateText, plural } from './summary';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; list: BackupSummary[] };

type Verdict = { error: boolean; text: string };

export interface BackupListProps {
  client: Client;
  jobs: JobStore;
  /** A start call is in flight in the host. */
  disabled?: boolean;
  onRestore(t: RestoreTarget): void;
  /** Message from the restore flow (cancelled / error). */
  restoreMessage?: Verdict | null;
}

/** Backups with date, kind, size and badges; Verify (asks for a passphrase if encrypted) and Restore. Works in recovery mode. */
export function BackupList({ client, jobs, disabled, onRestore, restoreMessage }: BackupListProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const last = useStore(jobs, (s) => s.last);
  const running = useStore(jobs, (s) => s.running !== null);
  const restarting = useStore(
    jobs,
    (s) => s.last?.ok === true && s.last.result?.kind === 'restore',
  );
  const seq = useRef(0);
  const passId = useId();
  const off = disabled || running || restarting || verifying !== null;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const r = await client.call('portability.backupList');
    if (mine !== seq.current) return;
    setLoad(
      r.ok ? { status: 'ready', list: r.value } : { status: 'error', message: r.error.message },
    );
  }, [client]);
  // Reload on mount and whenever a job finishes (a new backup, a prune).
  useEffect(() => {
    void reload();
    return () => void seq.current++;
  }, [reload, last]);

  async function verify(b: BackupSummary, passphrase: string | undefined) {
    setVerifying(b.id);
    const r = await client.call('portability.backupVerify', {
      id: b.id,
      ...(passphrase ? { passphrase } : {}),
    });
    setVerifying(null);
    setAsking(null);
    const text = r.ok
      ? r.value.damaged > 0
        ? `Checked: the backup is readable, but ${damagedFiles(r.value.damaged)}.`
        : `Checked: all data is intact${r.value.noteCount === undefined ? '' : ` (${plural(r.value.noteCount, 'note')})`}.`
      : `Couldn’t verify: ${r.error.message}`;
    setVerdicts((v) => ({ ...v, [b.id]: { error: !r.ok || r.value.damaged > 0, text } }));
  }
  const submitAsk = (e: FormEvent, b: BackupSummary) => {
    e.preventDefault();
    const p = pass;
    setPass(''); // cleared before the call
    void verify(b, p === '' ? undefined : p);
  };

  if (load.status === 'loading') return <p className="muted">Looking for backups…</p>;
  if (load.status === 'error')
    return (
      <div role="alert">
        <p>Couldn’t list the backups: {load.message}</p>
        <button type="button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  return (
    <>
      {load.list.length === 0 && <p className="muted">No backups yet.</p>}
      <ul className="pt-backups" aria-label="Backups">
        {load.list.map((b) => {
          const when = dateText(b.createdAt);
          const v = verdicts[b.id];
          return (
            <li key={b.id} data-backup={b.id}>
              <div className="pt-row">
                <span className="pt-when">{when}</span>
                <span>
                  {BACKUP_KIND[b.kind] ?? String(b.kind)}, {formatSize(b.size)}
                  {b.noteCount === undefined ? '' : `, ${plural(b.noteCount, 'note')}`}
                </span>
                {b.encrypted && <span className="pt-badge">Encrypted</span>}
                <span className={b.valid ? 'pt-badge' : 'pt-badge pt-bad'}>
                  {b.valid ? 'Looks valid' : 'Not valid'}
                </span>
                {!b.restorable && <span className="pt-badge">Cannot be restored</span>}
                {(b.damaged ?? 0) > 0 && (
                  <span className="pt-badge pt-bad">
                    Incomplete: {plural(b.damaged ?? 0, 'damaged file')}
                  </span>
                )}
              </div>
              <div className="pt-row">
                <button
                  type="button"
                  aria-label={`Verify backup from ${when}`}
                  disabled={off}
                  onClick={() => (b.encrypted ? setAsking(b.id) : void verify(b, undefined))}
                >
                  Verify
                </button>
                {b.restorable && (
                  <button
                    type="button"
                    aria-label={`Restore backup from ${when}`}
                    disabled={off}
                    onClick={() => onRestore(b)}
                  >
                    Restore…
                  </button>
                )}
              </div>
              {asking === b.id && (
                <form className="pt-row" onSubmit={(e) => submitAsk(e, b)}>
                  <label htmlFor={passId}>
                    Passphrase for this backup{' '}
                    <input
                      id={passId}
                      type="password"
                      autoComplete="off"
                      autoFocus
                      value={pass}
                      maxLength={1024}
                      onChange={(e) => setPass(e.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={pass === '' || off}>
                    Check backup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPass('');
                      setAsking(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {verifying === b.id && <p role="status">Checking the backup…</p>}
              {v && verifying !== b.id && (
                <p role={v.error ? 'alert' : 'status'} className={v.error ? 'pt-warn' : undefined}>
                  {v.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {restoreMessage && (
        <p role={restoreMessage.error ? 'alert' : 'status'}>{restoreMessage.text}</p>
      )}
      {restarting && <p role="status">Restarting Mossnote to finish the restore…</p>}
    </>
  );
}
