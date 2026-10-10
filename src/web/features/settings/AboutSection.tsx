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
  const location = info.data?.location;
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
            Turn off shortcuts that are a single key, like n, g and ?. Shortcuts with ⌘ or Ctrl keep
            working.
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
          <dt className="font-semibold">
            {location?.kind === 'browser' ? 'Stored in' : 'Data folder'}
          </dt>
          <dd className="m-0 break-all">
            {location?.kind === 'browser'
              ? 'This browser, on this device'
              : (location?.dataDir ?? '')}
          </dd>
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
            {location?.kind === 'browser'
              ? 'Once the page has loaded, Mossnote doesn’t use the internet and never sends your notes anywhere. There are no accounts, analytics or crash reports. It only looks for a newer version of the app when you open this page with a connection.'
              : 'Mossnote never uses the internet. There are no accounts, analytics, crash reports or update checks.'}
          </li>
          <li>
            {location?.kind === 'browser'
              ? 'Everything you write is saved in this browser, on this device. It only leaves if you export a file, so export one every now and then as a backup.'
              : 'Everything you write is saved in one file on your computer, at the path shown above.'}
          </li>
          <li>Nothing is shared unless you export a file and send it to someone yourself.</li>
          <li>Mossnote doesn’t come with any game data.</li>
        </ul>
      </div>
    </div>
  );
}
