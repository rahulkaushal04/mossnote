// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as icons from './icons';

/** Icons the shell, screens and map editor use. A missing one fails here, not at a call site. */
const REQUIRED = [
  'JournalIcon',
  'TodayIcon',
  'PeopleIcon',
  'FarmIcon',
  'MapIcon',
  'SettingsIcon',
  'MoreIcon',
  'SearchIcon',
  'PlusIcon',
  'CloseIcon',
  'CheckIcon',
  'ChevronLeftIcon',
  'ChevronRightIcon',
  'ChevronDownIcon',
  'EllipsisIcon',
  'PenIcon',
  'HandIcon',
  'SelectIcon',
  'LineIcon',
  'ArrowIcon',
  'BoxIcon',
  'CircleIcon',
  'TextIcon',
  'NoteIcon',
  'PinIcon',
  'UndoIcon',
  'RedoIcon',
  'ZoomInIcon',
  'ZoomOutIcon',
  'FitIcon',
  'LayersIcon',
  'DownloadIcon',
  'TrashIcon',
  'FilterIcon',
  'SparkIcon',
  'ArrowUpRightIcon',
] as const;

const all = Object.entries(icons) as [string, (p: object) => React.JSX.Element][];

describe('icon set', () => {
  it('has every icon the screens need', () => {
    for (const name of REQUIRED) expect(Object.keys(icons), name).toContain(name);
  });

  for (const [name, Icon] of all) {
    it(`${name} is a decorative 24px SVG that follows the text colour`, () => {
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, 'renders an svg').not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
      const colours = [svg, ...container.querySelectorAll('svg *')].flatMap((el) => [
        el?.getAttribute('stroke'),
        el?.getAttribute('fill'),
      ]);
      for (const colour of colours) {
        expect(['currentColor', 'none', null], `${name} colour ${String(colour)}`).toContain(
          colour,
        );
      }
    });
  }

  it('uses one stroke width across the whole set', () => {
    const widths = new Set<string>();
    for (const [, Icon] of all) {
      const { container, unmount } = render(<Icon />);
      for (const el of container.querySelectorAll('svg, svg *')) {
        const width = el.getAttribute('stroke-width');
        if (width) widths.add(width);
      }
      unmount();
    }
    expect([...widths]).toEqual(['1.75']);
  });

  it('lets a caller set the size and label', () => {
    const { container } = render(<icons.SearchIcon className="size-6" aria-label="Search" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('size-6');
  });
});
