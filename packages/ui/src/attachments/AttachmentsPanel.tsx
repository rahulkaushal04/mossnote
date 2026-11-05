import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import type { Client } from '../rpc/client';
import { addFromDrop, addFromPaste, addFromPick, type AddOutcome } from './add';
import { AttachmentPreview } from './AttachmentPreview';
import { getNative, type NativeBridge } from './native';
import { DAMAGED_MESSAGE, formatSize, type AttachmentRef } from './types';
import './attachments.css';

/** What the editor pane calls for drop, paste, and the "Attach file" command. */
export interface PanelApi {
  canAttach(): boolean;
  pick(): void;
  drop(files: File[]): void;
  paste(): void;
}

export interface AttachmentsPanelProps {
  client: Client;
  noteId: string;
  /** Trashed notes: nothing can be added, removed, or inserted. */
  readOnly: boolean;
  /** Inserts Markdown at the editor cursor; false when the editor refused (read-only, not loaded). */
  insert(markdown: string): boolean;
  /** Defaults to window.mossnote.native; tests pass a fake. Undefined hides the native-only actions. */
  native?: NativeBridge | undefined;
  register?(api: PanelApi | null): void;
  fetchText?: (url: string, cap: number) => Promise<string>;
}

type Load = { status: 'loading' | 'ready' | 'error'; items: AttachmentRef[]; error?: string };

function useAttachments(client: Client, noteId: string) {
  const [st, setSt] = useState<Load>({ status: 'loading', items: [] });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const r = await client.call('attachments.list', { noteId });
    if (mine !== seq.current) return;
    setSt(
      r.ok
        ? { status: 'ready', items: r.value }
        : { status: 'error', items: [], error: r.error.message },
    );
  }, [client, noteId]);
  useEffect(() => {
    setSt({ status: 'loading', items: [] });
    void reload();
    const off = client.onEvent((e) => {
      if (e.type === 'changed' && e.entity === 'attachment') void reload();
    });
    return () => {
      seq.current++; // a late reply for the old note must not land
      off();
    };
  }, [client, noteId, reload]);
  return { ...st, reload };
}

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function AttachmentsPanel(p: AttachmentsPanelProps) {
  const { client, noteId, readOnly, insert, register } = p;
  const native = 'native' in p ? p.native : getNative();
  const list = useAttachments(client, noteId);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AttachmentRef | null>(null);
  const [over, setOver] = useState(false);
  const alive = useRef(true);
  const live = useRef({ readOnly, busy, insert, native });
  live.current = { readOnly, busy, insert, native };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = useCallback(
    (o: AddOutcome) => {
      if (!alive.current) return;
      setError(o.errors.join(' '));
      if (o.added.length > 0) {
        const ok = live.current.insert(o.added.map((r) => r.markdown).join('\n'));
        setStatus(
          ok
            ? `Added ${o.added.length} attachment(s).`
            : `Added ${o.added.length} attachment(s), but the link could not be inserted. Use Insert link.`,
        );
      } else setStatus('');
      void list.reload();
    },
    [list.reload],
  );
  const run = useCallback(
    async (job: (n: NativeBridge) => Promise<AddOutcome>) => {
      const c = live.current;
      if (c.readOnly || c.busy || !c.native) return;
      setBusy(true);
      setStatus('');
      try {
        finish(await job(c.native));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [finish],
  );

  const api = useRef<PanelApi>(null!);
  api.current = {
    canAttach: () => !live.current.readOnly && !live.current.busy && !!live.current.native,
    pick: () => void run((n) => addFromPick(client, n, noteId)),
    drop: (files) => void run((n) => addFromDrop(client, n, noteId, files)),
    paste: () => void run((n) => addFromPaste(n, noteId)),
  };
  useEffect(() => {
    const stable: PanelApi = {
      canAttach: () => api.current.canAttach(),
      pick: () => api.current.pick(),
      drop: (f) => api.current.drop(f),
      paste: () => api.current.paste(),
    };
    register?.(stable);
    return () => register?.(null);
  }, [register]);

  async function nativeAction(kind: 'reveal' | 'saveCopy', a: AttachmentRef) {
    if (!native) return;
    setError('');
    try {
      const r = (await native[kind](a.sha256, a.noteId)) as
        { ok?: boolean; error?: { message: string } } | undefined;
      if (r && r.ok === false) setError(r.error?.message ?? 'That did not work.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    }
  }

  async function remove(a: AttachmentRef) {
    const r = await client.call('attachments.remove', { refId: a.refId });
    if (!alive.current) return;
    setRemoving(null);
    if (!r.ok) setError(r.error.message);
    else {
      setError('');
      setStatus(`Removed an attachment from this note.`);
      if (previewing === a.refId) setPreviewing(null);
      void list.reload();
    }
  }

  const items = list.items;
  // Dropped files are always consumed (the window must never navigate to them); adding is guarded in run().
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(!live.current.readOnly);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      api.current.drop([...(e.dataTransfer?.files ?? [])]);
    },
  };
  return (
    <section
      className={`att-panel${over ? ' att-over' : ''}`}
      aria-label="Attachments"
      {...dropProps}
    >
      <div className="att-head">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="att-body"
          onClick={() => setOpen((o) => !o)}
        >
          Attachments{list.status === 'ready' ? ` (${items.length})` : ''}
        </button>
        {native && (
          <button type="button" disabled={readOnly || busy} onClick={() => api.current.pick()}>
            Add file
          </button>
        )}
      </div>
      <div id="att-body" hidden={!open}>
        {error && <p role="alert">{error}</p>}
        <p role="status" className="muted">
          {busy ? 'Adding…' : status}
        </p>
        {list.status === 'loading' && <p className="muted">Loading attachments…</p>}
        {list.status === 'error' && (
          <div role="alert">
            <p>Couldn’t load attachments: {list.error}</p>
            <button type="button" onClick={() => void list.reload()}>
              Retry
            </button>
          </div>
        )}
        {list.status === 'ready' && items.length === 0 && (
          <p className="muted">
            {readOnly ? 'No attachments.' : 'No attachments. Drop a file here or use Add file.'}
          </p>
        )}
        {items.length > 0 && (
          <ul className="att-list">
            {items.map((a) => (
              <li key={a.refId} data-ref={a.refId}>
                <div className="att-row">
                  <span className="att-name">
                    <bdi>{a.name}</bdi>
                  </span>
                  <span className="muted">{formatSize(a.size)}</span>
                  <span className="att-badge">{a.kind}</span>
                  {a.textState === 'pending' && <span className="att-badge">Text pending</span>}
                  {a.textState === 'failed' && (
                    <span className="att-badge">Text not extracted</span>
                  )}
                  {a.verifyState === 'missing' && (
                    <span className="att-badge att-bad">Missing</span>
                  )}
                  {a.verifyState === 'corrupt' && (
                    <span className="att-badge att-bad">Damaged</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Preview ${a.name}`}
                    aria-expanded={previewing === a.refId}
                    onClick={() => setPreviewing((c) => (c === a.refId ? null : a.refId))}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-label={`Insert link to ${a.name}`}
                    disabled={readOnly}
                    onClick={() => {
                      const ok = insert(a.markdown);
                      setStatus(ok ? 'Link inserted.' : 'The link could not be inserted.');
                    }}
                  >
                    Insert link
                  </button>
                  {native && (
                    <button
                      type="button"
                      aria-label={`Reveal ${a.name}`}
                      onClick={() => void nativeAction('reveal', a)}
                    >
                      Reveal
                    </button>
                  )}
                  {native && a.kind !== 'executable' && (
                    <button
                      type="button"
                      aria-label={`Save a copy of ${a.name}`}
                      onClick={() => void nativeAction('saveCopy', a)}
                    >
                      Save copy
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    disabled={readOnly}
                    onClick={() => setRemoving(a)}
                  >
                    Remove
                  </button>
                </div>
                {a.verifyState !== 'ok' && <p className="att-bad-msg">{DAMAGED_MESSAGE}</p>}
                {previewing === a.refId && (
                  <AttachmentPreview
                    attachment={a}
                    client={client}
                    native={native}
                    {...(p.fetchText ? { fetchText: p.fetchText } : {})}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.name}” from this note?`}
          description="The file is kept until you clean up unused attachments. Links to it in the note will stop showing it."
          confirmLabel="Remove"
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
