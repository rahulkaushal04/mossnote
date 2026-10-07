import { useQuery } from '@tanstack/react-query';
import { ShortcutsList } from '../../app/ShortcutsDialog';
import { api } from '../../lib/api';
import { setSingleKeysEnabled, useSingleKeys } from '../../lib/theme';
import { queryKeys } from '../../lib/queryKeys';

/** Settings → Shortcuts and about: the single-key switch (WCAG 2.1.4), the list, version and privacy. */
export function AboutSection() {
  const singleKeys = useSingleKeys();
  const health = useQuery({ queryKey: queryKeys.health, queryFn: api.getHealth });
  const info = useQuery({ queryKey: queryKeys.dataInfo, queryFn: api.dataInfo });
  return (
    <div className="flex flex-col gap-6">
      <label className="tap flex items-start gap-3">
        <input
          type="checkbox"
          checked={singleKeys}
          onChange={(e) => {
            setSingleKeysEnabled(e.target.checked);
          }}
          className="mt-1 size-4 accent-accent"
        />
        <span>
          Single-key shortcuts
          <span className="block text-sm text-ink-muted">
            Turn off letters and symbols such as n, g and ? as shortcuts. Shortcuts that use ⌘ or
            Ctrl stay on.
          </span>
        </span>
      </label>

      <ShortcutsList />

      <dl className="m-0 flex flex-col gap-1">
        <div className="flex gap-2">
          <dt className="font-semibold">Version</dt>
          <dd className="m-0">{health.data?.version ?? ''}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="font-semibold">Data folder</dt>
          <dd className="m-0 break-all">{info.data?.dataDir ?? ''}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Licence</dt>
          <dd className="m-0">MIT</dd>
        </div>
      </dl>

      <div>
        <h3 className="font-semibold">Privacy</h3>
        <ul className="m-0 mt-1 ml-6 list-disc">
          <li>
            Mossnote never connects to the internet. It has no accounts, analytics, crash reporting,
            or update checks.
          </li>
          <li>
            Everything you write is stored in one file on your computer, at the path shown above.
          </li>
          <li>Nothing is shared unless you export a file and share it yourself.</li>
          <li>The app ships with no game information of any kind.</li>
        </ul>
      </div>
    </div>
  );
}
