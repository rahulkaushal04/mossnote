/** Short messages that float over the canvas. */

const STOP_PRESS = (e: { stopPropagation: () => void }) => {
  e.stopPropagation();
};

/** Offered after smart drawing tidies a stroke, so the original can be kept. */
export function CleanupNotice({
  label,
  onKeepOriginal,
  onDismiss,
}: {
  label: string;
  onKeepOriginal: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1 text-sm shadow-2"
      onPointerDown={STOP_PRESS}
    >
      <span>Tidied up as {label.toLowerCase()}.</span>
      <button type="button" className="tap rounded-md px-2 underline" onClick={onKeepOriginal}>
        Keep my drawing
      </button>
      <button type="button" aria-label="Dismiss" className="tap px-1" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

/** A passing message, such as a limit being reached. */
export function Notice({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="absolute top-2 left-1/2 z-20 m-0 -translate-x-1/2 rounded-lg border border-line bg-raised px-3 py-1 text-sm shadow-2"
    >
      {message}
    </p>
  );
}
