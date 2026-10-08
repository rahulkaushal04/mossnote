/**
 * The 'On maps' section on a note, person or planting: the pins that point at it.
 */
import { Link } from 'react-router';
import type { LinkType } from '@shared/types';
import { usePinsFor } from './hooks';

/** "On maps": pins that point at this record. Absent when there are none. */
export function OnMaps({ type, id }: { type: LinkType; id: string }) {
  const pins = usePinsFor(type, id);
  const items = pins.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`on-maps-${id}`} className="mt-8">
      <h2 id={`on-maps-${id}`} className="text-sm font-semibold text-ink-2">
        On maps
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {items.map((pin) => (
          <li key={pin.pinId}>
            <Link to={`/maps/${pin.mapId}?pin=${pin.pinId}`}>
              {pin.label === '' ? 'Unnamed pin' : pin.label} · {pin.mapName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
