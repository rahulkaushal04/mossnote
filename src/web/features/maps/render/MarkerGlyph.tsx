/**
 * The icons a marker can show, as SVG, and their accessible names.
 */
import type { MapIcon } from '@shared/constants';

/** Glyphs for marker icons, on a 24 by 24 grid, drawn with the current stroke colour. */
const GLYPHS: Record<MapIcon, string[]> = {
  pin: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  dot: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  star: ['M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z'],
  flag: ['M6 3v18', 'M6 4.5h12l-3 4 3 4H6'],
  question: ['M8.5 9a3.5 3.5 0 1 1 5 3.1c-1 .6-1.5 1.2-1.5 2.4', 'M12 18v.5'],
  exclamation: ['M12 4.5v9', 'M12 18v.5'],
  door: ['M7 3h10v18H7z', 'M14 12v.5'],
  key: [
    'M8 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M10.5 11l8 8',
    'M15 15l2-2',
    'M17.5 17.5l2-2',
  ],
  chest: ['M4 11h16v8H4z', 'M4 11a8 5 0 0 1 16 0', 'M12 11v3'],
  person: ['M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M5.5 20a6.5 6 0 0 1 13 0'],
  house: ['M3.5 11.5L12 4l8.5 7.5', 'M6 10v10h12V10', 'M10 20v-5h4v5'],
  tree: ['M12 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M12 14v7'],
  water: ['M12 3.5c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z'],
  mountain: ['M2.5 19.5l6.5-12 4.5 7 3-4 5 9z'],
  cross: ['M6 6l12 12', 'M18 6L6 18'],
  eye: [
    'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z',
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  ],
  heart: ['M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z'],
  diamond: ['M12 3l8 9-8 9-8-9z'],
  bolt: ['M13 2.5L5 14h6l-1 7.5L19 10h-6z'],
  cave: ['M3 20.5C3 12 7 5.5 12 5.5s9 6.5 9 15', 'M8 20.5c0-4 2-7 4-7s4 3 4 7'],
};

/** A marker icon at a given size, centred on (0, 0). The colour comes from `currentColor`. */
export function MarkerGlyph({ icon, size = 14 }: { icon: MapIcon; size?: number }) {
  const k = size / 24;
  return (
    <g
      transform={`translate(${-size / 2} ${-size / 2}) scale(${k})`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}

export const ICON_LABELS: Record<MapIcon, string> = {
  pin: 'Pin',
  dot: 'Dot',
  star: 'Star',
  flag: 'Flag',
  question: 'Question mark',
  exclamation: 'Exclamation mark',
  door: 'Door',
  key: 'Key',
  chest: 'Chest',
  person: 'Person',
  house: 'House',
  tree: 'Tree',
  water: 'Water drop',
  mountain: 'Mountain',
  cross: 'Cross',
  eye: 'Eye',
  heart: 'Heart',
  diamond: 'Diamond',
  bolt: 'Bolt',
  cave: 'Arch',
};
