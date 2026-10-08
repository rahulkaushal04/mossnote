import type { ReactNode } from 'react';
import { useToast } from './ui/Toast';
import { downloadExport, recordExport } from '../lib/exports';
import { IS_STANDALONE } from '../lib/mode';

interface DownloadLinkProps {
  /** The export to fetch, such as `/api/data/export.json`. */
  path: string;
  /** The journal being exported, when it is not the open one. */
  journalId?: string;
  className: string;
  'aria-label'?: string;
  children: ReactNode;
}

/**
 * A link that downloads an export. With a server it is an ordinary download link; in the
 * standalone web app there is no server to link to, so the click fetches the file from the app
 * itself and saves it. Either way the export is remembered for the backup reminder.
 */
export function DownloadLink({ path, journalId, children, ...rest }: DownloadLinkProps) {
  const toast = useToast();
  return (
    <a
      {...rest}
      href={path}
      download
      onClick={(event) => {
        if (!IS_STANDALONE) {
          recordExport(journalId);
          return;
        }
        event.preventDefault();
        downloadExport(path, journalId).catch(() => {
          toast.show({ message: "Couldn't make that file.", tone: 'alert' });
        });
      }}
    >
      {children}
    </a>
  );
}
