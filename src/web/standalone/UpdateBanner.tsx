import { applyUpdate, useUpdateReady } from './serviceWorker';

/** Tells the person a newer version of the app is ready, and switches when they say so. */
export function UpdateBanner() {
  if (!useUpdateReady()) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-raised p-3 text-ink shadow-2"
    >
      <span>A new version of Mossnote is ready.</span>
      <button type="button" className="btn btn-primary tap" onClick={applyUpdate}>
        Reload to update
      </button>
    </div>
  );
}
