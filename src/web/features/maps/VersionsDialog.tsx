/**
 * Version history for a map: save a named version, restore or delete one.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapDetail, MapVersionInfo } from '@shared/types';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

const key = (id: string) => ['map', id, 'versions'] as const;

/**
 * Earlier states of the map. The app keeps one automatically every ten minutes while you draw; you
 * can also save one on purpose. Restoring keeps the state it replaces, so it can be undone.
 */
export function VersionsDialog({
  mapId,
  open,
  onClose,
  beforeOpen,
  onRestored,
}: {
  mapId: string;
  open: boolean;
  onClose: () => void;
  /** Called first, so unsaved drawing is saved before versions are listed or restored. */
  beforeOpen: () => Promise<unknown>;
  onRestored: (map: MapDetail) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const list = useQuery({
    queryKey: key(mapId),
    queryFn: async () => {
      await beforeOpen();
      return (await api.mapVersions(mapId)).items;
    },
    enabled: open,
    staleTime: 0,
  });
  const refresh = () => client.invalidateQueries({ queryKey: key(mapId) });
  const save = useMutation({
    mutationFn: async () => {
      await beforeOpen();
      return api.saveMapVersion(mapId, name.trim() === '' ? undefined : name.trim());
    },
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });
  const restore = useMutation({
    mutationFn: async (v: MapVersionInfo) => {
      await beforeOpen();
      return api.restoreMapVersion(mapId, v.id);
    },
    onSuccess: (map) => {
      void refresh();
      void client.invalidateQueries({ queryKey: ['maps'] });
      onRestored(map);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: (v: MapVersionInfo) => api.deleteMapVersion(mapId, v.id),
    onSuccess: () => void refresh(),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Version history"
      description="Earlier states of this map. Restoring one keeps what it replaces."
      placement="right"
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Name for this version</span>
          <input
            value={name}
            maxLength={60}
            placeholder="Name this version (optional)"
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="field-input w-full"
          />
        </label>
        <button type="submit" className="btn btn-primary tap" disabled={save.isPending}>
          Save version
        </button>
      </form>
      {list.isError ? (
        <p role="alert" className="text-danger">
          Couldn&apos;t load versions.
        </p>
      ) : null}
      {list.data?.length === 0 ? (
        <p className="text-ink-muted">
          Nothing saved yet. A version is kept automatically after you change a map and ten minutes
          have passed.
        </p>
      ) : null}
      <ul aria-label="Versions" className="m-0 list-none p-0">
        {(list.data ?? []).map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2"
          >
            <span>
              <span className="block font-semibold">
                {v.name ?? (v.kind === 'restore' ? 'Before a restore' : 'Automatic')}
              </span>
              <span className="block text-sm text-ink-muted">
                {formatDateTime(v.createdAt)} · {v.shapes} {v.shapes === 1 ? 'drawing' : 'drawings'}
                , {v.pins} {v.pins === 1 ? 'marker' : 'markers'}
              </span>
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                className="btn tap text-sm"
                disabled={restore.isPending}
                onClick={() => {
                  restore.mutate(v);
                }}
              >
                Restore
              </button>
              <button
                type="button"
                className="tap rounded-md px-2 text-sm text-danger underline"
                aria-label={`Delete version from ${formatDateTime(v.createdAt)}`}
                onClick={() => {
                  remove.mutate(v);
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {restore.isError ? (
        <p role="alert" className="mt-2 text-danger">
          Couldn&apos;t restore that version.
        </p>
      ) : null}
    </Dialog>
  );
}
