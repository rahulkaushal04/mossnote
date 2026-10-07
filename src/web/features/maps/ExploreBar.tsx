/**
 * The bar shown in exploration mode: drop a marker, draw a path, undo, done.
 */
import type { Tool } from './editorTypes';

const BIG = 'btn tap min-h-14 min-w-20 flex-col gap-0 px-3 text-base';

/**
 * Exploring mode: three big buttons for the loop of play. Drop a marker, draw the way you went,
 * jot a note, and carry on. Everything stays selected as a tool until you leave.
 */
export function ExploreBar({
  tool,
  onTool,
  onDone,
  onUndo,
  canUndo,
  hasMarker,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  onDone: () => void;
  onUndo: () => void;
  canUndo: boolean;
  hasMarker: boolean;
}) {
  const pressed = (t: Tool) => tool === t;
  return (
    <div
      role="toolbar"
      aria-label="Exploring"
      className="absolute inset-x-0 bottom-9 z-20 flex flex-col items-center gap-1 px-2"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <p
        className="m-0 rounded-control bg-raised px-3 py-1 text-xs text-ink-muted shadow-float"
        role="status"
      >
        {tool === 'pin'
          ? 'Tap the map to drop a marker, then type its name.'
          : tool === 'draw'
            ? hasMarker
              ? 'Draw the way you went. It starts from your last marker.'
              : 'Draw the way you went.'
            : 'Tap the map to put a note down.'}
      </p>
      <div className="flex items-center gap-2 rounded-panel border border-rule bg-raised p-2 shadow-float">
        <button
          type="button"
          aria-pressed={pressed('pin')}
          className={`${BIG} ${pressed('pin') ? 'btn-primary' : ''}`}
          onClick={() => {
            onTool('pin');
          }}
        >
          <span>Marker</span>
          <span className="text-xs opacity-70">K</span>
        </button>
        <button
          type="button"
          aria-pressed={pressed('draw')}
          className={`${BIG} ${pressed('draw') ? 'btn-primary' : ''}`}
          onClick={() => {
            onTool('draw');
          }}
        >
          <span>Path</span>
          <span className="text-xs opacity-70">B</span>
        </button>
        <button
          type="button"
          aria-pressed={pressed('note')}
          className={`${BIG} ${pressed('note') ? 'btn-primary' : ''}`}
          onClick={() => {
            onTool('note');
          }}
        >
          <span>Note</span>
          <span className="text-xs opacity-70">S</span>
        </button>
        <button type="button" className="btn tap min-h-14" disabled={!canUndo} onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="btn tap min-h-14" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
