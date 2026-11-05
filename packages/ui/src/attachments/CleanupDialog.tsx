import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Prefs } from '@mossnote/core/rpc';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useModal } from '../dialog/useModal';
import type { Client } from '../rpc/client';
import { formatSize, MIB, type CleanupPreview, type CleanupResult } from './types';

export const MIN_LIMIT_MIB = 1;
export const MAX_LIMIT_MIB = 1024;
export const LIMIT_MESSAGE = `Enter a whole number from ${MIN_LIMIT_MIB} to ${MAX_LIMIT_MIB} (MiB).`;

/** MiB text to bytes, or undefined when it is not a whole number within the bounds. */
export function parseLimitMiB(s: string): number | undefined {
  if (!/^\d{1,5}$/.test(s.trim())) return undefined;
  const n = Number(s.trim());
  return n >= MIN_LIMIT_MIB && n <= MAX_LIMIT_MIB ? n * MIB : undefined;
}

export interface CleanupDialogProps {
  client: Client;
  prefs: Prefs | undefined;
  onPrefs(p: Prefs): void;
  onClose(): void;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: CleanupPreview };

/** Unused attachments with sizes, an explicit selection, a confirmation, then the result (AT-6); plus the size limit. */
export function CleanupDialog({ client, prefs, onPrefs, onClose }: CleanupDialogProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [runError, setRunError] = useState('');
  const [limit, setLimit] = useState(
    String(Math.round((prefs?.attachmentMaxBytes ?? 200 * MIB) / MIB)),
  );
  const [limitMsg, setLimitMsg] = useState('');
  const titleId = useId();
  const limitErr = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { ref, onKeyDown } = useModal(onClose, closeRef);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoad({ status: 'loading' });
    const r = await client.call('attachments.cleanupPreview');
    if (mine !== seq.current) return;
    setLoad(
      r.ok ? { status: 'ready', preview: r.value } : { status: 'error', message: r.error.message },
    );
    setPicked(new Set());
  }, [client]);
  useEffect(() => {
    void refresh();
    return () => void seq.current++;
  }, [refresh]);

  const items = load.status === 'ready' ? load.preview.items : [];
  const chosen = items.filter((i) => picked.has(i.sha256));
  const chosenBytes = chosen.reduce((n, i) => n + i.size, 0);
  const toggle = (sha: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(sha)) n.add(sha);
      return n;
    });

  async function run() {
    const r = await client.call('attachments.cleanupRun', {
      sha256s: chosen.map((i) => i.sha256),
      confirmed: true,
    });
    setConfirming(false);
    if (r.ok) {
      setRunError('');
      setResult(r.value);
    } else setRunError(r.error.message);
    void refresh();
  }

  async function saveLimit() {
    const bytes = parseLimitMiB(limit);
    if (bytes === undefined) return setLimitMsg(LIMIT_MESSAGE);
    const r = await client.call('prefs.set', { attachmentMaxBytes: bytes });
    if (!r.ok) return setLimitMsg(r.error.message);
    setLimitMsg('Saved.');
    onPrefs(r.value);
  }

  if (confirming)
    return (
      <ConfirmDialog
        title={`Delete ${chosen.length} unused file(s)?`}
        description={`${formatSize(chosenBytes)} will be removed from storage for good. Files still used by a note, a version, or Trash are never deleted.`}
        confirmLabel={`Delete ${chosen.length} file(s)`}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    );
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>Attachment storage</h2>
        <div className="att-sizes">
          <label>
            Largest file allowed (MiB){' '}
            <input
              type="text"
              inputMode="numeric"
              value={limit}
              aria-invalid={limitMsg !== '' && limitMsg !== 'Saved.'}
              aria-describedby={limitErr}
              onChange={(e) => {
                setLimit(e.target.value);
                setLimitMsg('');
              }}
            />
          </label>{' '}
          <button type="button" onClick={() => void saveLimit()}>
            Save limit
          </button>
          <p id={limitErr} role={limitMsg && limitMsg !== 'Saved.' ? 'alert' : 'status'}>
            {limitMsg}
          </p>
        </div>
        <h3>Unused attachments</h3>
        {load.status === 'loading' && <p className="muted">Looking for unused files…</p>}
        {load.status === 'error' && (
          <div role="alert">
            <p>Couldn’t check for unused files: {load.message}</p>
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {load.status === 'ready' && items.length === 0 && (
          <p className="muted">No unused attachments.</p>
        )}
        {items.length > 0 && (
          <>
            <p>
              {items.length} unused file(s),{' '}
              {formatSize(load.status === 'ready' ? load.preview.totalBytes : 0)}.
            </p>
            <ul className="att-list">
              {items.map((i) => (
                <li key={i.sha256}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(i.sha256)}
                      onChange={() => toggle(i.sha256)}
                    />{' '}
                    {i.kind} {formatSize(i.size)} {i.sha256.slice(0, 12)}
                    {i.untracked ? ' (no record in the database)' : ''}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                setPicked(
                  picked.size === items.length ? new Set() : new Set(items.map((i) => i.sha256)),
                )
              }
            >
              {picked.size === items.length ? 'Select none' : 'Select all'}
            </button>{' '}
            <button
              type="button"
              className="danger"
              disabled={chosen.length === 0}
              onClick={() => setConfirming(true)}
            >
              Delete {chosen.length} selected ({formatSize(chosenBytes)})
            </button>
          </>
        )}
        {runError && <p role="alert">Couldn’t delete: {runError}</p>}
        {result && (
          <p role="status">
            Deleted {result.deleted} file(s), {formatSize(result.bytes)}.
            {result.skipped.length > 0
              ? ` ${result.skipped.length} skipped because they are in use or changed meanwhile.`
              : ''}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
