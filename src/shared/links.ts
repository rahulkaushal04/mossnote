/**
 * Pages the person can choose to open in their own browser. They are plain links that Mossnote
 * never fetches itself; `check:network` allows this file, and only this file, to name them.
 */

/** The feature-request form on the project's issue tracker, for asking for a game template. */
export const REQUEST_TEMPLATE_URL =
  'https://github.com/rahulkaushal04/mossnote/issues/new?template=feature_request.yml';

/** The documentation, published on GitHub Pages. */
export const DOCS_URL = 'https://rahulkaushal04.github.io/mossnote/docs/';

/** A documentation page by its file name (`troubleshooting`), optionally at a heading. */
export const docsUrl = (page: string, heading?: string) =>
  `${DOCS_URL}${page}/${heading ? `#${heading}` : ''}`;
