/**
 * A short, human name for a browser, made from its user agent, for the list of paired devices.
 * Order matters: iPads and Android tablets also name another system, so they are checked first.
 */

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android.*Mobile/, 'Android phone'],
  [/Android/, 'Android tablet'],
  [/Windows/, 'Windows PC'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/CrOS/, 'Chromebook'],
  [/Linux/, 'Linux PC'],
];

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/EdgiOS|EdgA|Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/FxiOS|Firefox/, 'Firefox'],
  [/CriOS|Chrome/, 'Chrome'],
  [/Safari/, 'Safari'],
];

export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (system && browser) return `${system} (${browser})`;
  return system ?? browser ?? 'Unknown device';
}
