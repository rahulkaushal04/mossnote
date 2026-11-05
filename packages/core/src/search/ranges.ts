/** Marker characters passed to FTS5 highlight()/snippet(); both are control characters FTS5 treats as separators. */
export const MARK_OPEN = '\u0002';
export const MARK_CLOSE = '\u0003';

/** Replace marker characters in user text (before the database call) so they cannot forge highlights. */
export function stripMarkerChars(text: string): string {
  return text.replaceAll(MARK_OPEN, ' ').replaceAll(MARK_CLOSE, ' ');
}

export interface MarkedText {
  text: string;
  /** [start, end) UTF-16 code-unit offsets into `text`; ordered and non-overlapping. */
  ranges: Array<[number, number]>;
}

/**
 * Remove single-character markers from `marked` and return the ranges they enclosed.
 * Nested/duplicate opens and stray closes are ignored; an unclosed open runs to the end.
 */
export function rangesFromMarked(marked: string, open: string, close: string): MarkedText {
  const ranges: Array<[number, number]> = [];
  if (open.length !== 1 || close.length !== 1 || open === close) return { text: marked, ranges };
  let text = '';
  let start = -1;
  for (const ch of marked) {
    if (ch === open) {
      if (start < 0) start = text.length;
    } else if (ch === close) {
      if (start >= 0 && text.length > start) ranges.push([start, text.length]);
      start = -1;
    } else text += ch;
  }
  if (start >= 0 && text.length > start) ranges.push([start, text.length]);
  return { text, ranges };
}
