/** Shown when a save would replace a newer copy written in another window. */
export function ConflictNotice({
  message,
  onReload,
  onKeepMine,
}: {
  message: string;
  onReload: () => void;
  onKeepMine: () => void;
}) {
  return (
    <div role="alert" className="mt-2 rounded-md border border-danger p-3 text-sm">
      <p className="font-semibold">{message}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn tap" onClick={onReload}>
          Reload
        </button>
        <button type="button" className="btn tap" onClick={onKeepMine}>
          Keep mine
        </button>
      </div>
    </div>
  );
}
