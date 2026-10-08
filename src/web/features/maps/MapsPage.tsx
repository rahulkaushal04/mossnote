/**
 * The maps list: create, open a map file, duplicate and delete.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ulid } from 'ulid';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { MapIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { refreshMaps, useCreateMap, useMaps, usePlaces } from './hooks';
import { useTerms } from '../settings/useLayout';

/**
 * `/maps`: your sketches, and every pin across them as a flat list of places. One tap starts a
 * new map; naming it can wait.
 */
export function MapsPage() {
  const terms = useTerms();
  const maps = useMaps();
  const places = usePlaces();
  const create = useCreateMap();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [layered, setLayered] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const client = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const items = maps.data?.items ?? [];
  const needle = filter.trim().toLowerCase();
  const pins = (places.data?.items ?? []).filter(
    (p) => needle === '' || `${p.label} ${p.note} ${p.mapName}`.toLowerCase().includes(needle),
  );

  const add = () => {
    create.mutate(
      {
        id: ulid(),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(layered ? { template: 'layers' as const } : {}),
      },
      {
        onSuccess: (map) => {
          setName('');
          void navigate(`/maps/${map.id}`);
        },
      },
    );
  };

  const duplicate = async (id: string) => {
    setMessage(null);
    try {
      const copy = await api.duplicateMap(id);
      void refreshMaps(client);
      void navigate(`/maps/${copy.id}`);
    } catch {
      setMessage("Couldn't duplicate that map.");
    }
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setMessage(null);
    try {
      const parsed: unknown = JSON.parse(await f.text());
      const map = await api.importMapProject(parsed);
      void refreshMaps(client);
      void navigate(`/maps/${map.id}`);
    } catch {
      setMessage("That file isn't a map Mossnote can open.");
    }
  };

  return (
    <>
      <PageHeader title={terms.maps.label} />
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="new-map-name" className="font-medium">
          New map
        </label>
        <div className="flex gap-2">
          <input
            id="new-map-name"
            value={name}
            placeholder="Name (optional)"
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="field-input min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" busy={create.isPending}>
            Start drawing
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={layered}
              onChange={(e) => {
                setLayered(e.target.checked);
              }}
              className="size-4 accent-accent"
            />
            Start with layers
          </label>
          <Button
            variant="ghost"
            onClick={() => {
              file.current?.click();
            }}
          >
            Open a map file
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Map file"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </form>
      {message ? (
        <p role="alert" className="mt-2 text-danger">
          {message}
        </p>
      ) : null}
      {create.isError ? (
        <p role="alert" className="mt-2 text-danger">
          {create.error.message}
        </p>
      ) : null}

      {maps.isError ? <LoadError onRetry={() => void maps.refetch()} /> : null}
      <ListSkeleton pending={maps.isPending} />
      {maps.data && items.length === 0 ? (
        <EmptyState
          icon={<MapIcon />}
          action={
            <Button variant="primary" busy={create.isPending} onClick={add}>
              Draw your first map
            </Button>
          }
        >
          No maps yet. Sketch where you are, then pin what you find.
        </EmptyState>
      ) : null}
      {items.length > 0 ? (
        <ul aria-label="Maps" className="m-0 mt-4 list-none p-0">
          {items.map((map) => (
            <li
              key={map.id}
              className="relative flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2"
            >
              <Link
                to={`/maps/${map.id}`}
                className="reading text-ink no-underline after:absolute after:inset-0 hover:underline"
              >
                {map.name}
              </Link>
              <span className="relative z-10 flex items-center gap-3 text-sm text-ink-muted">
                <span>
                  {map.pinCount} {map.pinCount === 1 ? 'marker' : 'markers'} ·{' '}
                  {formatDateTime(map.updatedAt)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost underline"
                  aria-label={`Duplicate ${map.name}`}
                  onClick={() => void duplicate(map.id)}
                >
                  Duplicate
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {(places.data?.items.length ?? 0) > 0 ? (
        <section aria-labelledby="places" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="places" className="text-sm font-semibold text-ink-2">
              Places
            </h2>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Filter places</span>
              <input
                value={filter}
                placeholder="Filter"
                onChange={(e) => {
                  setFilter(e.target.value);
                }}
                className="field-input w-44"
              />
            </label>
          </div>
          <ul aria-label="Places" className="m-0 mt-2 list-none p-0">
            {pins.map((pin) => (
              <li key={pin.id} className="relative border-b border-line py-2">
                <Link
                  to={`/maps/${pin.mapId}?pin=${pin.id}`}
                  className="reading text-ink no-underline after:absolute after:inset-0 hover:underline"
                >
                  {pin.label === '' ? 'Unnamed pin' : pin.label}
                </Link>
                <span className="ml-2 text-sm text-ink-muted">{pin.mapName}</span>
                {pin.note ? (
                  <span className="block truncate text-sm text-ink-muted">{pin.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
