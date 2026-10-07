/** The shortcut list shown by `?` and in Settings. `mod` is ⌘ or Ctrl. */
export interface Shortcut {
  keys: string;
  scope: string;
  action: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'mod+K', scope: 'Everywhere', action: 'Open search and commands' },
  { keys: '/', scope: 'Outside text fields', action: 'Open search' },
  { keys: 'n', scope: 'Outside text fields', action: 'New note' },
  {
    keys: 'g then t, j, p, f, m, s',
    scope: 'Outside text fields',
    action: 'Go to Today, Journal, People, Farm, Maps, Settings',
  },
  {
    keys: 'd then n, p, s',
    scope: 'Outside text fields',
    action: 'Next day, previous day, set the in-game date',
  },
  { keys: '[ and ]', scope: 'Day page', action: 'Previous and next in-game day' },
  {
    keys: 'V H B L A R O Y C T S K M',
    scope: 'Map editor',
    action:
      'Select, Pan, Draw, Line, Arrow, Box, Circle, Area, Connect, Text, Note, Marker, Measure',
  },
  { keys: 'E', scope: 'Map editor', action: 'Exploring mode: marker, path, note' },
  { keys: 'Space (hold)', scope: 'Map editor', action: 'Pan with the pointer' },
  { keys: 'Alt (hold)', scope: 'Map editor', action: 'Pause snapping while drawing or moving' },
  {
    keys: 'Shift (hold)',
    scope: 'Map editor',
    action: 'Square or circle; straight angles; keep proportions; one direction when moving',
  },
  {
    keys: 'Arrows, Shift+Arrows',
    scope: 'Map editor',
    action: 'Nudge the selection by 1 or by a grid step',
  },
  { keys: 'mod+Z, mod+Shift+Z', scope: 'Map editor', action: 'Undo and redo' },
  {
    keys: 'mod+C, mod+X, mod+V, mod+D',
    scope: 'Map editor',
    action: 'Copy, cut, paste, duplicate',
  },
  { keys: 'mod+G, mod+Shift+G', scope: 'Map editor', action: 'Group and ungroup' },
  {
    keys: 'mod+], mod+[',
    scope: 'Map editor',
    action: 'Bring forward, send backward (add Shift for front and back)',
  },
  { keys: 'mod+A, Delete', scope: 'Map editor', action: 'Select all, delete the selection' },
  { keys: 'Enter, F2', scope: 'Map editor', action: 'Open a marker or edit text; rename' },
  {
    keys: '+ - 0, Shift+1, Shift+2',
    scope: 'Map editor',
    action: 'Zoom in, zoom out, 100%, fit the map, fit the selection',
  },
  {
    keys: 'Shift+G, Shift+R, Shift+S, Shift+F',
    scope: 'Map editor',
    action: 'Grid, rulers, snapping, full screen',
  },
  { keys: 'u', scope: 'While an Undo message is showing', action: 'Undo' },
  { keys: '?', scope: 'Outside text fields', action: 'Show this list' },
  { keys: 'mod+Enter', scope: 'Composer', action: 'Save the note' },
  { keys: 'mod+Enter', scope: 'Editing a note', action: 'Finish editing' },
  { keys: 'Esc', scope: 'Picker open', action: 'Close the picker and keep the text' },
  { keys: 'Esc', scope: 'Composer or editor', action: 'Leave the text box; the draft is kept' },
  { keys: 'Esc', scope: 'Dialog, popover or search', action: 'Close' },
  { keys: '↑ ↓ Enter Tab', scope: 'Picker', action: 'Move, select, select' },
  { keys: '↑ ↓ Enter mod+Enter', scope: 'Search', action: 'Move, open, open all results' },
  { keys: 'e', scope: 'A focused note', action: 'Edit it in place' },
  {
    keys: 'Digits, arrows, Enter, Esc',
    scope: 'Date picker',
    action: 'Type the day, move, confirm, cancel',
  },
];

export const formatKeys = (keys: string, mod: string): string => keys.replaceAll('mod', mod);
