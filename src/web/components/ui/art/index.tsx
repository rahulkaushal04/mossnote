import type { ReactNode, SVGProps } from 'react';

/**
 * Small line drawings for empty states. One colour (`currentColor`), a 1.5px stroke, no fills,
 * decorative. Inline SVG, so nothing is fetched. Allowed in empty states only (ADR 0009).
 */
function Art({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type ArtProps = SVGProps<SVGSVGElement>;

/** An open page with a pen: notes. */
export const PageArt = (props: ArtProps) => (
  <Art {...props}>
    <path d="M24 14h40l12 12v54a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" />
    <path d="M64 14v12h12M32 40h32M32 52h32M32 64h20" />
  </Art>
);
/** A sprouting leaf: the farm. */
export const LeafArt = (props: ArtProps) => (
  <Art {...props}>
    <path d="M48 84V44" />
    <path d="M48 56C48 38 36 26 18 26c0 18 12 30 30 30z" />
    <path d="M48 44c0-14 10-24 28-24 0 14-10 24-28 24z" />
    <path d="M32 84h32" />
  </Art>
);
/** Two heads: people. */
export const PeopleArt = (props: ArtProps) => (
  <Art {...props}>
    <circle cx="36" cy="34" r="12" />
    <path d="M14 82c2-16 12-24 22-24s20 8 22 24" />
    <circle cx="66" cy="38" r="9" />
    <path d="M62 60c12 0 18 8 20 22" />
  </Art>
);
/** A folded map with a pin. */
export const MapArt = (props: ArtProps) => (
  <Art {...props}>
    <path d="M30 20L10 28v50l20-8 24 8 22-8V20l-22 8-24-8z" />
    <path d="M30 20v50M54 28v50" />
    <path d="M70 52s-8-7-8-13a8 8 0 0 1 16 0c0 6-8 13-8 13z" />
  </Art>
);
