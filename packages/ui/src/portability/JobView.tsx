import type { JobResult } from '@mossnote/core/rpc';
import { useStore } from '../app/store';
import type { JobStore } from './jobStore';
import { damagedFiles, importLines, KIND_LABEL, plural, summarize } from './summary';

export function ProgressBar({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const known = total > 0;
  const pct = known ? Math.min(100, Math.round((done / total) * 100)) : 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      {...(known
        ? { 'aria-valuemax': total, 'aria-valuenow': Math.min(done, total) }
        : { 'aria-valuetext': 'Working' })}
      className={known ? 'pt-bar' : 'pt-bar pt-bar-indeterminate'}
    >
      <div className="pt-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The running job (progress bar, phase) and the last finished one (summary, warnings, import report).
 * Everything from main is rendered as text. The polite status region is always mounted so updates are announced.
 */
export function JobView({ jobs, onRetry }: { jobs: JobStore; onRetry?: (kind: string) => void }) {
  const running = useStore(jobs, (s) => s.running);
  const last = useStore(jobs, (s) => s.last);
  const r = last?.ok ? last.result : undefined;
  return (
    <div className="pt-job">
      <div role="status">
        {running
          ? `${KIND_LABEL[running.kind]}: ${running.phase}`
          : last?.ok
            ? summarize(last)
            : ''}
      </div>
      {running && (
        <ProgressBar
          label={`${KIND_LABEL[running.kind]} progress`}
          done={running.done}
          total={running.total}
        />
      )}
      {!running && last && !last.ok && (
        <div role="alert">
          <p>{summarize(last)}</p>
          {onRetry && (
            <button type="button" onClick={() => onRetry(last.kind)}>
              Retry
            </button>
          )}
        </div>
      )}
      {r?.kind === 'export' && r.warnings.length > 0 && (
        <>
          <p>{plural(r.warnings.length, 'warning')}:</p>
          <ul className="pt-lines" aria-label="Export warnings" tabIndex={0}>
            {r.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
      {r?.kind === 'backup' && r.damaged > 0 && (
        <p role="alert">
          This backup is incomplete: {damagedFiles(r.damaged)}, so it could not be saved correctly.
        </p>
      )}
      {r?.kind === 'import' && (
        <>
          {r.stoppedEarly && <p role="alert">The import stopped early: {r.stoppedEarly}</p>}
          {r.files.length > 0 && <ImportReport r={r} />}
        </>
      )}
    </div>
  );
}

function ImportReport({ r }: { r: Extract<JobResult, { kind: 'import' }> }) {
  const { shown, more } = importLines(r.files);
  return (
    <>
      <p>Files that need your attention:</p>
      <ul className="pt-lines" aria-label="Import report" tabIndex={0}>
        {shown.map((f, i) => (
          <li key={i}>
            {f.rel}: {f.status}, {f.reason}
          </li>
        ))}
      </ul>
      {(more > 0 || r.truncated) && (
        <p className="muted">
          {more > 0 ? `${more} more not shown. ` : ''}
          The full report is saved as “{r.reportFile}”.
        </p>
      )}
    </>
  );
}
