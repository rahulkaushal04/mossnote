/**
 * The page for one map: loads it and shows the editor. The page is lazy-loaded (see routes) to keep
 * the first load small.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@shared/constants';
import type { MapDetail } from '@shared/types';
import { EmptyState } from '../../components/ui/EmptyState';
import { ChevronLeftIcon, EllipsisIcon } from '../../components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu';
import { PageHeader } from '../../components/ui/PageHeader';
import { ListSkeleton, LoadError } from '../../components/ui/Skeleton';
import { ApiError, api } from '../../lib/api';
import { MapEditor } from './MapEditor';
import { refreshMaps, useDeleteMap, useMap } from './hooks';

function NameField({ map }: { map: MapDetail }) {
  const client = useQueryClient();
  const [name, setName] = useState(map.name);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Add a name.');
      setName(map.name);
      return;
    }
    setError(null);
    if (trimmed !== map.name) {
      api.patchMap(map.id, { name: trimmed }).then(
        () => void refreshMaps(client),
        (e: unknown) => {
          setError(e instanceof Error ? e.message : "Couldn't save that change.");
        },
      );
    }
  };
  return (
    <div>
      <label>
        <span className="sr-only">Map name</span>
        <input
          value={name}
          maxLength={LIMITS.mapName}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="reading w-full border-0 border-b border-transparent bg-transparent text-xl font-semibold hover:border-line focus:border-ink-muted"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** `/maps/:id`: one sketch. Opening a pin link (`?pin=`) centres on that pin. */
export function MapPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const query = useMap(id);
  const navigate = useNavigate();
  const remove = useDeleteMap();
  const map = query.data;
  const gone =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
  const removed = useRef(false);
  useEffect(() => {
    removed.current = false;
  }, [id]);

  return (
    <>
      <PageHeader title={map?.name ?? 'Map'} documentTitle={map?.name ?? 'Map'} immersiveOnPhone />

      <ListSkeleton pending={query.isPending} />
      {gone ? (
        <EmptyState>
          This map isn&apos;t here. <Link to="/settings#trash">Recently deleted</Link>
        </EmptyState>
      ) : query.isError ? (
        <LoadError onRetry={() => void query.refetch()} />
      ) : null}
      {map ? (
        <div key={map.id}>
          <div className="mb-2 flex items-center justify-between gap-1">
            <Link to="/maps" aria-label="Back to Maps" className="btn btn-icon btn-ghost shrink-0">
              <ChevronLeftIcon className="size-5" />
            </Link>
            <div className="min-w-0 flex-1">
              <NameField key={`name-${map.name}`} map={map} />
            </div>
            <Menu>
              <MenuTrigger asChild>
                <button type="button" aria-label="More actions" className="btn btn-icon btn-ghost">
                  <EllipsisIcon className="size-5" />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  onSelect={() => {
                    remove.mutate(map, {
                      onSuccess: () => {
                        removed.current = true;
                        void navigate('/maps');
                      },
                    });
                  }}
                >
                  Delete map
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <MapEditor map={map} focusPin={params.get('pin')} />
        </div>
      ) : null}
    </>
  );
}
