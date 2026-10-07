/**
 * The small toolbar that floats above the selection.
 */
import type { Actions } from './editorTypes';
import { ColorPicker } from './ColorPicker';

const BTN = 'btn tap px-2 text-sm';

/**
 * A small bar that floats above the selection: the few things you reach for every time. Colour,
 * duplicate, a note, lock, delete. The rest is in the side panel and the right-click menu.
 */
export function QuickBar({
  at,
  color,
  actions,
  single,
  isPin,
  onColor,
  onDetails,
}: {
  at: { x: number; y: number };
  color: string;
  actions: Actions;
  single: boolean;
  isPin: boolean;
  onColor: (c: string) => void;
  onDetails: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Quick actions for the selection"
      className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-panel border border-rule bg-raised p-1 shadow-float"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <details className="relative">
        <summary className={`${BTN} cursor-pointer list-none`} aria-label="Colour">
          <span
            className="block size-4 rounded-full border border-rule"
            style={{
              background: color.startsWith('#')
                ? color
                : `var(--map-${color === 'ink' ? 'moss' : color})`,
            }}
          />
        </summary>
        <div className="absolute top-full left-0 z-30 mt-1 w-56 rounded-panel border border-rule bg-raised p-2 shadow-float">
          <ColorPicker
            value={color}
            label="Colour"
            onPick={(c) => {
              if (c) onColor(c);
            }}
          />
        </div>
      </details>
      {isPin ? (
        <button type="button" className={BTN} onClick={onDetails}>
          Details
        </button>
      ) : null}
      {single ? (
        <button
          type="button"
          className={BTN}
          onClick={() => {
            actions.rename();
          }}
        >
          Name
        </button>
      ) : null}
      <button
        type="button"
        className={BTN}
        onClick={actions.duplicate}
        aria-label="Duplicate"
        title="Duplicate (Mod+D)"
      >
        Copy
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => {
          actions.setLocked(true);
        }}
        aria-label="Lock"
        title="Lock"
      >
        Lock
      </button>
      <button
        type="button"
        className={`${BTN} text-danger`}
        onClick={actions.remove}
        aria-label="Delete"
        title="Delete"
      >
        Delete
      </button>
    </div>
  );
}
