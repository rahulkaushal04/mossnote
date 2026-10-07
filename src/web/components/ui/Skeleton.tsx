import { useEffect, useState } from 'react';

/** True once `pending` has lasted `ms`, so quick loads never flash a skeleton (spec section 8). */
export function useDelayed(pending: boolean, ms = 150): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      const reset = setTimeout(() => {
        setLate(false);
      }, 0);
      return () => {
        clearTimeout(reset);
      };
    }
    const timer = setTimeout(() => {
      setLate(true);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, ms]);
  return pending && late;
}

/** Quiet text-line placeholders, shown only after 150 ms. */
export function ListSkeleton({ pending }: { pending: boolean }) {
  const show = useDelayed(pending);
  if (!show) return null;
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4 py-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 w-3/4 rounded-control bg-surface" />
          <div className="h-4 w-1/2 rounded-control bg-surface" />
        </div>
      ))}
    </div>
  );
}

/** Error with Retry, for lists that failed to load. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="py-6 text-danger">
      Couldn&apos;t load this.{' '}
      <button type="button" className="tap underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}
