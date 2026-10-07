import { Fragment } from 'react';

/**
 * Render a search snippet. The server marks matches with U+0001 (start) and U+0002 (end); they
 * become `<mark>` elements. User text is never injected as HTML.
 */
export function Snippet({ text }: { text: string }) {
  const parts: { text: string; mark: boolean }[] = [];
  let buffer = '';
  let marked = false;
  for (const ch of text) {
    if (ch === '\u0001' || ch === '\u0002') {
      if (buffer) parts.push({ text: buffer, mark: marked });
      buffer = '';
      marked = ch === '\u0001';
    } else {
      buffer += ch;
    }
  }
  if (buffer) parts.push({ text: buffer, mark: marked });
  return (
    <>
      {parts.map((part, i) =>
        part.mark ? (
          <mark
            key={i}
            className="rounded-sm bg-surface font-semibold text-ink underline decoration-accent underline-offset-2"
          >
            {part.text}
          </mark>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** The plain text of a snippet, without markers. */
export const plainSnippet = (text: string): string =>
  text.replaceAll('\u0001', '').replaceAll('\u0002', '');
