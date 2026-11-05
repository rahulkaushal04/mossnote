import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { JobStarted, PortabilityStatus, RpcResult } from '@mossnote/core/rpc';
import { useStore } from '../app/store';
import { formatSize } from '../attachments/types';
import { useModal } from '../dialog/useModal';
import type { Client } from '../rpc/client';
import { BackupList } from './BackupList';
import { JobView } from './JobView';
import type { JobStore } from './jobStore';
import { useRestoreFlow, type RestoreFlow } from './RestoreDialog';
import {
  checkPassphrase,
  dateText,
  MIN_PASSPHRASE,
  parseSchedule,
  SCHEDULE_MESSAGE,
} from './summary';
import './portability.css';

/** What the opening command asked for; it starts that action once the dialog is up. */
export type DataIntent = 'open' | 'export' | 'import' | 'backup' | 'restore';

export interface DataDialogProps {
  client: Client;
  jobs: JobStore;
  intent?: DataIntent;
  onClose(): void;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; st: PortabilityStatus };

/**
 * Export, import, backups, schedule and restore in one place (PT-1..PT-13). One job runs at a time.
 * While the restore confirm is open it replaces the main dialog (one focus trap at a time); the main
 * dialog then remounts fresh, which also drops any typed passphrase.
 */
export function DataDialog({ client, jobs, intent = 'open', onClose }: DataDialogProps) {
  const restore = useRestoreFlow(client);
  const [pending, setPending] = useState<DataIntent>(intent);
  if (restore.dialog) return <>{restore.dialog}</>;
  return (
    <DataMain
      client={client}
      jobs={jobs}
      intent={pending}
      onIntentDone={() => setPending('open')}
      restore={restore}
      onClose={onClose}
    />
  );
}

function DataMain({
  client,
  jobs,
  intent,
  onIntentDone,
  restore,
  onClose,
}: DataDialogProps & { intent: DataIntent; onIntentDone(): void; restore: RestoreFlow }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passMsg, setPassMsg] = useState('');
  const [auto, setAuto] = useState(true);
  const [interval, setIntervalText] = useState('24');
  const [keep, setKeep] = useState('7');
  const [schedMsg, setSchedMsg] = useState<{ error: boolean; text: string } | null>(null);
  const running = useStore(jobs, (s) => s.running !== null);
  const last = useStore(jobs, (s) => s.last);
  const restarting = useStore(
    jobs,
    (s) => s.last?.ok === true && s.last.result?.kind === 'restore',
  );
  const firstRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  const ids = {
    title: useId(),
    pass: useId(),
    passErr: useId(),
    confirm: useId(),
    a: useId(),
    i: useId(),
    k: useId(),
    s: useId(),
  };
  const { ref, onKeyDown } = useModal(onClose, firstRef);
  const busy = starting || running || restarting;

  useEffect(() => jobs.watch(), [jobs]);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const r = await client.call('portability.status');
    if (mine !== seq.current) return;
    if (!r.ok) return setLoad({ status: 'error', message: r.error.message });
    jobs.seed(r.value.job);
    setLoad({ status: 'ready', st: r.value });
    setAuto(r.value.schedule.auto);
    setIntervalText(String(r.value.schedule.intervalHours));
    setKeep(String(r.value.schedule.keep));
  }, [client, jobs]);
  useEffect(() => {
    void refresh();
    return () => void seq.current++;
  }, [refresh, last]);

  /** Starts a job; the dialog opened by a main-process picker answers `cancelled`. */
  async function start(call: () => Promise<RpcResult<JobStarted>>, again: () => void) {
    if (busy) return;
    setStarting(true);
    setNote(null);
    jobs.clearLast();
    retryRef.current = again;
    const r = await call();
    setStarting(false);
    if (!r.ok) setNote({ error: true, text: r.error.message });
    else if ('cancelled' in r.value)
      setNote({ error: false, text: 'Cancelled. Nothing was changed.' });
  }
  const doExport = () =>
    void start(() => client.call('portability.exportStart', { scope: { kind: 'all' } }), doExport);
  const doImport = () => void start(() => client.call('portability.importStart'), doImport);
  const doBackup = () =>
    void start(() => client.call('portability.backupNow', { to: 'library' }), doBackup);
  const doSaveAs = () => {
    const c = checkPassphrase(pass, confirm);
    if (!c.ok) return setPassMsg(c.message);
    setPassMsg('');
    const p = pass;
    // Cleared before the call: the passphrase lives only in this closure for the one request.
    setPass('');
    setConfirm('');
    void start(
      () => client.call('portability.backupNow', { to: 'file', ...(p ? { passphrase: p } : {}) }),
      () => setPassMsg('Enter the passphrase again to retry.'),
    );
  };
  const retry = () => retryRef.current?.();

  // The command that opened the dialog starts its action once.
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    onIntentDone();
    if (intent === 'export') doExport();
    else if (intent === 'import') doImport();
    else if (intent === 'backup') doBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function saveSchedule() {
    const s = parseSchedule(auto, interval, keep);
    if (!s) return setSchedMsg({ error: true, text: SCHEDULE_MESSAGE });
    const r = await client.call('portability.setSchedule', s);
    setSchedMsg(r.ok ? { error: false, text: 'Saved.' } : { error: true, text: r.error.message });
    if (r.ok) void refresh();
  }

  const st = load.status === 'ready' ? load.st : undefined;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-busy={busy}
        onKeyDown={onKeyDown}
      >
        <h2 id={ids.title}>Data and backups</h2>
        {load.status === 'error' && (
          <div role="alert">
            <p>Couldn’t read the backup settings: {load.message}</p>
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {st && (
          <p className="muted">
            Backups use {formatSize(st.libraryBytes)} on disk.
            {st.lastAutoBackupAt ? ` Last automatic backup: ${dateText(st.lastAutoBackupAt)}.` : ''}
          </p>
        )}
        <JobView jobs={jobs} onRetry={retry} />
        {note && (
          <div role={note.error ? 'alert' : 'status'}>
            <p>{note.text}</p>
            {note.error && (
              <button type="button" onClick={retry}>
                Retry
              </button>
            )}
          </div>
        )}
        {restore.message && (
          <p role={restore.message.error ? 'alert' : 'status'}>{restore.message.text}</p>
        )}

        <h3>Export</h3>
        <p>Write all your notes as Markdown files in a folder you choose.</p>
        <button type="button" ref={firstRef} disabled={busy} onClick={doExport}>
          Export all notes…
        </button>

        <h3>Import</h3>
        {st?.pendingImport && (
          <p role="status">
            An earlier import was interrupted. Resuming continues where it stopped.
          </p>
        )}
        <p>Add Markdown files from a folder as new notes. Your existing notes are never changed.</p>
        <button type="button" disabled={busy} onClick={doImport}>
          {st?.pendingImport ? 'Resume import' : 'Import notes…'}
        </button>

        <h3>Backups</h3>
        <button type="button" disabled={busy} onClick={doBackup}>
          Back up now
        </button>
        <fieldset className="pt-fields" disabled={busy}>
          <legend>Save a backup to a file</legend>
          <label htmlFor={ids.pass}>
            Passphrase (optional){' '}
            <input
              id={ids.pass}
              type="password"
              autoComplete="off"
              maxLength={1024}
              value={pass}
              aria-invalid={passMsg !== ''}
              aria-describedby={ids.passErr}
              onChange={(e) => {
                setPass(e.target.value);
                setPassMsg('');
              }}
            />
          </label>
          <label htmlFor={ids.confirm}>
            Confirm passphrase{' '}
            <input
              id={ids.confirm}
              type="password"
              autoComplete="off"
              maxLength={1024}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setPassMsg('');
              }}
            />
          </label>
          <p id={ids.passErr} role={passMsg ? 'alert' : undefined}>
            {passMsg}
          </p>
          <p className="muted">
            With a passphrase (at least {MIN_PASSPHRASE} characters) the file is encrypted. It is
            never stored, and there is no way to recover a lost passphrase.
          </p>
          <button type="button" onClick={doSaveAs}>
            Save backup as…
          </button>
        </fieldset>

        <fieldset className="pt-fields">
          <legend>Automatic backups</legend>
          <label htmlFor={ids.a}>
            <input
              id={ids.a}
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                setSchedMsg(null);
              }}
            />{' '}
            Back up automatically
          </label>
          <label htmlFor={ids.i}>
            Every (hours, 1 to 168){' '}
            <input
              id={ids.i}
              type="text"
              inputMode="numeric"
              value={interval}
              aria-invalid={schedMsg?.error === true}
              aria-describedby={ids.s}
              onChange={(e) => {
                setIntervalText(e.target.value);
                setSchedMsg(null);
              }}
            />
          </label>
          <label htmlFor={ids.k}>
            Keep the newest (1 to 100){' '}
            <input
              id={ids.k}
              type="text"
              inputMode="numeric"
              value={keep}
              aria-invalid={schedMsg?.error === true}
              aria-describedby={ids.s}
              onChange={(e) => {
                setKeep(e.target.value);
                setSchedMsg(null);
              }}
            />
          </label>
          <button type="button" onClick={() => void saveSchedule()}>
            Save schedule
          </button>
          <p id={ids.s} role={schedMsg ? (schedMsg.error ? 'alert' : 'status') : undefined}>
            {schedMsg?.text ?? ''}
          </p>
        </fieldset>

        <h3>Restore</h3>
        <BackupList client={client} jobs={jobs} disabled={starting} onRestore={restore.ask} />
        <button type="button" disabled={busy} onClick={() => restore.ask('file')}>
          Restore from a file…
        </button>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
