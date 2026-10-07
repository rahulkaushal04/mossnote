import Markdown, { type Components } from 'react-markdown';

/** Only http and https links survive; anything else (javascript:, data:, …) is plain text. */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * The rendered Markdown subset (spec section 5.2): paragraphs with preserved line breaks,
 * **bold**, *italic*, inline code, lists, block quotes and http(s) links. Headings, tables,
 * images, code blocks and raw HTML are shown as plain text. Nothing is injected as HTML.
 */
export function NoteBody({ value, className = '' }: { value: string; className?: string }) {
  const raw = ({
    node,
  }: {
    node?: { position?: { start: { offset?: number }; end: { offset?: number } } };
  }) => {
    const start = node?.position?.start.offset;
    const end = node?.position?.end.offset;
    return (
      <p className="whitespace-pre-wrap">
        {start === undefined || end === undefined ? '' : value.slice(start, end)}
      </p>
    );
  };

  const components: Components = {
    h1: raw,
    h2: raw,
    h3: raw,
    h4: raw,
    h5: raw,
    h6: raw,
    table: raw,
    img: raw,
    pre: raw,
    hr: raw,
    p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
    a: ({ href, children }) =>
      href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span>{children}</span>
      ),
    code: ({ children }) => (
      <code className="rounded-sm bg-surface px-1 font-sans text-[0.9em]">{children}</code>
    ),
    ul: ({ children }) => <ul className="ml-6 list-disc">{children}</ul>,
    ol: ({ children }) => <ol className="ml-6 list-decimal">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-rule pl-4 text-ink-muted">{children}</blockquote>
    ),
  };

  return (
    <div className={`reading flex flex-col gap-3 ${className}`}>
      <Markdown urlTransform={safeUrl} components={components}>
        {value}
      </Markdown>
    </div>
  );
}
