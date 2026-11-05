export { parseQuery, toFtsMatch, toFtsExclude } from './query.ts';
export type { ParsedQuery, QueryTerm } from './query.ts';
export { MARK_OPEN, MARK_CLOSE, stripMarkerChars, rangesFromMarked } from './ranges.ts';
export type { MarkedText } from './ranges.ts';
export { createSearchApi } from './api.ts';
export type { SearchApi, SearchApiOptions } from './api.ts';
export type {
  Marked,
  SearchHit,
  SearchPage,
  SearchParams,
  SearchSort,
  SearchSpec,
} from './params.ts';
export type { IndexStatus, Progress, StepResult } from './rebuild.ts';
export type { SavedSearch } from './saved.ts';
