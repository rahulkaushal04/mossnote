import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportSummary } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api, ApiError } from '../../lib/api';
import { formatBytes, formatDateTime, plural } from '../../lib/format';
import { invalidateEverywhere } from '../../lib/broadcast';
import { ALL_DATA_KEYS, queryKeys } from '../../lib/queryKeys';

const MAX_IMPORT = 50 * 1024 * 1024;
const SHOWN_ERRORS = 20;

interface Pending {
  file: unknown;
  summary: ImportSummary;
}

/** Settings → Data & backup (spec section 5.13). */
export function DataSection() {
  const client = useQueryClient();
  const info = useQuery({ queryKey: queryKeys.dataInfo, queryFn: api.dataInfo });
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [problems, setProblems] = useState<ImportSummary['errors']>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const data = info.data;

  const backUp = () => {
    setBackupMessage(null);
    api
      .backupNow()
      .then((made) => {
        setBackupMessage(`Backed up as ${made.name}.`);
        return invalidateEverywhere(client, [queryKeys.dataInfo, queryKeys.backups]);
      })
      .catch(() => {
        setBackupMessage("Couldn't make a backup right now.");
      });
  };

  const choose = async (file: File | undefined) => {
    setMessage(null);
    setProblems([]);
    setPending(null);
    if (!file) return;
    if (file.size > MAX_IMPORT) {
      setMessage('That file is larger than 50 MB, so it was not opened.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage("That file isn't valid JSON.");
      return;
    }
    setWorking(true);
    try {
      const summary = await api.importDryRun(parsed);
      if (summary.errors.length > 0) setProblems(summary.errors);
      else setPending({ file: parsed, summary });
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Couldn't check that file.");
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  };

  const replace = () => {
    if (!pending) return;
    setWorking(true);
    api
      .importJournal(pending.file)
      .then(() => invalidateEverywhere(client, ALL_DATA_KEYS))
      .then(() => {
        window.location.reload();
      })
      .catch((e: unknown) => {
        setWorking(false);
        const snapshot = e instanceof ApiError ? e.details?.snapshot : undefined;
        setMessage(
          e instanceof ApiError && e.code === 'internal'
            ? `${e.message}${typeof snapshot === 'string' ? ` A snapshot was saved first: ${snapshot}.` : ''}`
            : e instanceof Error
              ? e.message
              : 'Import failed. Your journal is unchanged.',
        );
      });
    setPending(null);
  };

  const counts = pending?.summary.counts;

  return (
    <div className="flex flex-col gap-4">
      {data ? (
        <dl className="m-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="font-semibold">Data folder</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <span className="break-all">{data.dataDir}</span>
              <button
                type="button"
                className="btn tap text-sm"
                onClick={() => {
                  navigator.clipboard
                    .writeText(data.dataDir)
                    .then(() => {
                      setCopied(true);
                    })
                    .catch(() => {
                      setCopied(false);
                    });
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Database size</dt>
            <dd className="m-0">{formatBytes(data.databaseBytes)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Records</dt>
            <dd className="m-0">
              {plural(data.counts.notes, 'note')} · {plural(data.counts.people, 'person', 'people')}{' '}
              · {plural(data.counts.plantings, 'farm entry', 'farm entries')} ·{' '}
              {plural(data.counts.maps, 'map')} · {plural(data.counts.tags, 'tag')}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Last automatic backup</dt>
            <dd className="m-0">
              {data.lastBackupAt ? formatDateTime(data.lastBackupAt) : 'None yet'}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a className="btn tap no-underline" href="/api/data/export.json" download>
          Export JSON
        </a>
        <a className="btn tap no-underline" href="/api/data/export.md" download>
          Export Markdown
        </a>
        <button
          type="button"
          className="btn tap"
          disabled={working}
          onClick={() => input.current?.click()}
        >
          Import JSON
        </button>
        <button type="button" className="btn tap" onClick={backUp}>
          Back up now
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a JSON file to import"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>

      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {backupMessage}
      </p>

      {problems.length > 0 ? (
        <div role="alert" className="rounded-control border border-danger p-3">
          <p className="font-semibold">This file can&apos;t be imported. Nothing was changed.</p>
          <ul className="m-0 mt-2 list-none p-0 text-sm">
            {problems.slice(0, SHOWN_ERRORS).map((p, i) => (
              <li key={i}>
                <code>{p.path}</code>: {p.message}
              </li>
            ))}
          </ul>
          {problems.length > SHOWN_ERRORS ? (
            <p className="mt-1 text-sm">and {problems.length - SHOWN_ERRORS} more</p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p role="alert" className="text-danger">
          {message}
        </p>
      ) : null}

      {pending && counts ? (
        <div className="rounded-control border border-rule p-3">
          <p>
            Contains {plural(counts.notes, 'note')}, {plural(counts.people, 'person', 'people')},{' '}
            {plural(counts.plantings, 'farm entry', 'farm entries')}, {plural(counts.maps, 'map')},{' '}
            {plural(counts.tags, 'tag')}. Importing replaces your current journal.
          </p>
          {pending.summary.warnings.length > 0 ? (
            <ul className="m-0 mt-1 list-none p-0 text-sm text-ink-muted">
              {pending.summary.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex gap-2">
            <ReplaceButton onConfirm={replace} />
            <button
              type="button"
              className="btn tap"
              onClick={() => {
                setPending(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReplaceButton({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn tap border-danger text-danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Replace my journal
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Replace your journal?"
        message="Your current journal is saved as a snapshot first, then replaced by this file."
        confirmLabel="Replace"
        danger
        onConfirm={onConfirm}
      />
    </>
  );
}
