import type { SVGProps } from 'react';

/**
 * The icon set: inline SVGs on one 24px grid with a 1.75px round stroke, drawn in the text
 * colour. There is no icon library, to keep the dependency list as it is. Icons are decorative;
 * the control that holds one carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

/** One stroked icon from path data. */
const stroked = (paths: string[]) =>
  function StrokedIcon(props: IconProps) {
    return (
      <svg {...base(props)}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };

/** ✦ the discovery mark. */
export const SparkIcon = (props: IconProps) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <path d="M12 2c.7 5.2 2.8 8.3 8.5 10-5.7 1.7-7.8 4.8-8.5 10-.7-5.2-2.8-8.3-8.5-10C9.2 10.3 11.3 7.2 12 2z" />
  </svg>
);
export const EllipsisIcon = (props: IconProps) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
/** The "More" tab: four squares. */
export const MoreIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </svg>
);

export const CheckIcon = stroked(['M5 12.5l4.5 4.5L19 7.5']);
export const CloseIcon = stroked(['M6 6l12 12M18 6L6 18']);
export const PlusIcon = stroked(['M12 5v14M5 12h14']);
export const ArrowUpRightIcon = stroked(['M7 17L17 7M8 7h9v9']);
export const ChevronLeftIcon = stroked(['M15 5l-7 7 7 7']);
export const ChevronRightIcon = stroked(['M9 5l7 7-7 7']);
export const ChevronDownIcon = stroked(['M5 9l7 7 7-7']);
export const LockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
export const HashIcon = stroked(['M9.5 4L8 20M16 4l-1.5 16M5 9h15M4 15h15']);
export const TitleIcon = stroked(['M5 7V5h14v2M12 5v14M9 19h6']);
export const FilterIcon = stroked(['M4 6h16M7 12h10M10 18h4']);
export const SearchIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);

// Sections.
export const JournalIcon = stroked([
  'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15z',
  'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3',
  'M9 8h6',
]);
export const TodayIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5" width="16" height="15" rx="3" />
    <path d="M4 10h16M8 3v4M16 3v4" />
  </svg>
);
export const PeopleIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </svg>
);
export const FarmIcon = stroked(['M5 19c0-8 5-14 15-14 0 10-6 15-14 14z', 'M5 19c3-5 6-8 10-10']);
export const MapIcon = stroked(['M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z', 'M9 4v14M15 6v14']);
export const SettingsIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
);

// Map editor tools and actions.
export const SelectIcon = stroked(['M5 3l14 7.5-6 1.8L10.5 19 5 3z']);
export const HandIcon = stroked([
  'M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6',
  'M17 9.5a1.5 1.5 0 0 1 3 0V15c0 3.5-2.5 6-6 6h-1c-2.5 0-4-1-5.5-3L4.5 14a1.5 1.5 0 0 1 2.4-1.8L8 13.5',
]);
export const PenIcon = stroked(['M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1z', 'M14.5 6.5l3 3']);
export const LineIcon = stroked(['M5 19L19 5']);
export const ArrowIcon = stroked(['M5 19L19 5M10 5h9v9']);
export const BoxIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
  </svg>
);
export const CircleIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);
export const TextIcon = stroked(['M5 6V5h14v1M12 5v14M9 19h6']);
export const NoteIcon = stroked(['M5 4h14v10l-6 6H5V4z', 'M13 20v-6h6']);
export const PinIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
);
export const UndoIcon = stroked(['M9 8h6a4.5 4.5 0 0 1 0 9H8', 'M9 4L5 8l4 4']);
export const RedoIcon = stroked(['M15 8H9a4.5 4.5 0 0 0 0 9h7', 'M15 4l4 4-4 4']);
export const ZoomInIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5" />
  </svg>
);
export const ZoomOutIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5M8.5 11h5" />
  </svg>
);
export const FitIcon = stroked(['M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4']);
export const LayersIcon = stroked(['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5']);
export const DownloadIcon = stroked(['M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14']);
export const TrashIcon = stroked([
  'M5 7h14M10 7V4.5h4V7',
  'M7 7l1 13h8l1-13M10.5 11v5.5M13.5 11v5.5',
]);
export const PolygonIcon = stroked(['M12 4l7 5-3 10H8L5 9l7-5z']);
export const ConnectIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8 16l8-8" />
  </svg>
);
export const MeasureIcon = stroked(['M3 16l13-13 5 5L8 21l-5-5z', 'M7 12l2 2M10 9l2 2M13 6l2 2']);
export const ClockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);
export const ExploreIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
  </svg>
);
export const PanelIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M15 5v14" />
  </svg>
);
export const ChevronUpIcon = stroked(['M5 15l7-7 7 7']);
