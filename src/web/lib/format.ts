const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

/** A real timestamp in the user's local time (hover text on a note's date). */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

/** The user's local calendar day for a timestamp, as `YYYY-MM-DD`. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A readable real date for a local day key, for the "no current date" fallback. */
export const formatLocalDay = (ms: number): string => dateOnly.format(new Date(ms));

/** A short, plural-aware count, for example `1 note` or `42 notes`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
