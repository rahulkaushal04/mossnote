import type { SVGProps } from 'react';

/** A handful of inline SVGs; there is no icon library. */
const base = (props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: '1em',
  height: '1em',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

/** ✦ the discovery mark. */
export const SparkIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <path d="M8 1c.5 3.6 1.9 5.9 6 7-4.1 1.1-5.5 3.4-6 7-.5-3.6-1.9-5.9-6-7 4.1-1.1 5.5-3.4 6-7z" />
  </svg>
);
export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
);
export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const ArrowUpRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M5 11l6-6M6 5h5v5" />
  </svg>
);
export const EllipsisIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </svg>
);
export const ChevronLeftIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M10 3L5 8l5 5" />
  </svg>
);
export const ChevronRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M6 3l5 5-5 5" />
  </svg>
);
export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);
export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
