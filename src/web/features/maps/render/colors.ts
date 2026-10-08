/**
 * Colour names the map uses, and how each maps to a CSS value on screen or a fixed value in
 * exports.
 */
import type { MapMarkerType, MapStyle } from '@shared/schemas/map';
import type { MapIcon } from '@shared/constants';
import type { MapPin } from '@shared/types';

const NAMED: Record<string, string> = {
  ink: 'var(--ink)',
  moss: 'var(--map-moss)',
  sky: 'var(--map-sky)',
  rose: 'var(--map-rose)',
  amber: 'var(--map-amber)',
  plum: 'var(--map-plum)',
};

/** Colours as the page shows them: named ones follow the theme through CSS variables. */
export const cssColor = (c: string): string => NAMED[c] ?? c;

/** Fixed colours for files that leave the app, where there is no theme. */
const EXPORT_NAMED: Record<string, string> = {
  ink: '#2a2621',
  moss: '#4f6f3f',
  sky: '#2f6f9a',
  rose: '#b0405e',
  amber: '#9a6410',
  plum: '#7a4a96',
};
export const exportColor = (c: string): string => EXPORT_NAMED[c] ?? c;

export const EXPORT_PAPER = '#f7f5f0';
export const EXPORT_INK = '#2a2621';

export type ColorFn = (c: string) => string;

/** Black or white, whichever reads better on a `#rrggbb` fill. Named colours use the page's paper. */
export function textOnFill(
  fill: string | null,
  named = 'var(--paper)',
  plain = 'var(--ink)',
): string {
  if (!fill) return plain;
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return named;
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1d2420' : '#ffffff';
}

export const dashArray = (style: MapStyle): string | undefined => {
  const w = style.width;
  if (style.dash === 'dashed') return `${w * 3} ${w * 2}`;
  if (style.dash === 'dotted') return `0.1 ${w * 2}`;
  return undefined;
};

/** What a pin looks like: its colour, and the icon it shows. */
export function pinLook(
  pin: MapPin,
  types: readonly MapMarkerType[],
): { color: string; icon: MapIcon } {
  const type = pin.props.type ? types.find((t) => t.id === pin.props.type) : undefined;
  return { color: pin.color, icon: pin.props.icon ?? type?.icon ?? 'pin' };
}
