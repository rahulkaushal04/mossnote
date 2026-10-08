import { useState } from 'react';
import type { DataInfo } from '@shared/types';
import { api } from '../../lib/api';
import { formatBytes, plural } from '../../lib/format';

/**
 * The rows of Settings → Data & backup that say where this journal lives. On a computer that is
 * a folder with a path to copy and open; in the browser it is the browser's own storage.
 */
export function DataLocation({ data }: { data: DataInfo }) {
  const [copied, setCopied] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const { location } = data;
  const snapshots = `${plural(data.backupCount, 'snapshot')} (${formatBytes(data.backupBytes)})`;

  if (location.kind === 'browser') {
    return (
      <>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold">Stored in</dt>
          <dd className="m-0">
            This browser, on this device ({formatBytes(data.databaseBytes)}). Export a file now and
            then: clearing this site&apos;s data would remove it. Journals on a computer running
            Mossnote are separate from these; to move one, export it there and import the file here.
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold">Backups</dt>
          <dd className="m-0">{snapshots} kept in this browser</dd>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <dt className="font-semibold">Data folder</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2">
          <span className="break-all">{location.dataDir}</span>
          <button
            type="button"
            className="btn tap text-sm"
            onClick={() => {
              navigator.clipboard
                .writeText(location.dataDir)
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
          <button
            type="button"
            className="btn tap text-sm"
            onClick={() => {
              setFolderMessage(null);
              api.openDataFolder().catch(() => {
                setFolderMessage(
                  "Couldn't open the folder from here. Copy the path and open it yourself.",
                );
              });
            }}
          >
            Open folder
          </button>
          {folderMessage ? (
            <span role="alert" className="w-full text-danger">
              {folderMessage}
            </span>
          ) : null}
        </dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="font-semibold">This journal&apos;s file</dt>
        <dd className="m-0 break-all">
          {location.databasePath} ({formatBytes(data.databaseBytes)})
        </dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="font-semibold">Backups</dt>
        <dd className="m-0">
          {snapshots} in <span className="break-all">{location.backupsDir}</span>
        </dd>
      </div>
    </>
  );
}
