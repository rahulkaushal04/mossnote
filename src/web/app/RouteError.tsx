import { useState } from 'react';
import { useRouteError } from 'react-router';

/** Route-level error boundary (spec section 8.12). Nothing is ever sent anywhere. */
export function RouteError() {
  const error = useRouteError();
  const [copied, setCopied] = useState(false);
  const details =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error);

  return (
    <main className="mx-auto flex max-w-[44rem] flex-col gap-4 px-4 py-16" role="alert">
      <h1 className="text-2xl font-semibold">Something went wrong on this page.</h1>
      <p>Your journal is safe. Reload the page, or copy the details if you want to report it.</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="btn btn-primary tap"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
        <button
          type="button"
          className="btn tap"
          onClick={() => {
            navigator.clipboard
              .writeText(details)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setCopied(false);
              });
          }}
        >
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </main>
  );
}
