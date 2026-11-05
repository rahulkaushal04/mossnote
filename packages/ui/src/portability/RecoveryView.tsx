import { useEffect } from 'react';
import { useStore } from '../app/store';
import type { Client } from '../rpc/client';
import { BackupList } from './BackupList';
import { JobView } from './JobView';
import type { JobStore } from './jobStore';
import { useRestoreFlow } from './RestoreDialog';
import './portability.css';

export interface RecoveryViewProps {
  client: Client;
  jobs: JobStore;
  /** Why the workspace could not be opened (shown as text). */
  message: string | undefined;
  onQuit(): void;
}

/**
 * Shown instead of the plain "can't open" screen when the database is corrupt. It uses ONLY the
 * recovery-mode methods: portability.backupList / backupVerify / restoreStart and app.quit.
 */
export function RecoveryView({ client, jobs, message, onQuit }: RecoveryViewProps) {
  const restore = useRestoreFlow(client);
  const busy = useStore(jobs, (s) => s.running !== null || s.last?.result?.kind === 'restore');
  useEffect(() => jobs.watch(), [jobs]);
  if (restore.dialog) return <>{restore.dialog}</>;
  return (
    <main aria-label="Mossnote recovery" className="pane-msg pt-recovery">
      <h1>Mossnote can’t open your notes</h1>
      <p role="alert">{message}</p>
      <p>
        You can bring your notes back from a backup. The damaged data is kept aside, not deleted,
        and Mossnote restarts when the restore is ready.
      </p>
      <JobView jobs={jobs} />
      {restore.message && (
        <p role={restore.message.error ? 'alert' : 'status'}>{restore.message.text}</p>
      )}
      <h2>Backups</h2>
      <BackupList client={client} jobs={jobs} onRestore={restore.ask} />
      <div className="pt-row">
        <button type="button" disabled={busy} onClick={() => restore.ask('file')}>
          Restore from a file…
        </button>
        <button type="button" onClick={onQuit}>
          Quit
        </button>
      </div>
    </main>
  );
}
