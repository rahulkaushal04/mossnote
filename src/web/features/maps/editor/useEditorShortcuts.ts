/** Keyboard shortcuts for the map editor. Space (hold) pans; everything else is a key press. */
import { useEffect, useRef } from 'react';
import { isTypingTarget, overlayOpen } from '../../../lib/hotkeys';
import type { Actions, EditorSettings, Tool } from '../editorTypes';
import type { Objects } from '../engine/shapes';
import { panBy, type View } from '../geometry';

/** The key that picks each tool. Letters are matched lower-case. */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  b: 'draw',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  y: 'polygon',
  c: 'connector',
  t: 'text',
  s: 'note',
  k: 'pin',
  m: 'measure',
};

/** How far an arrow key pans the view when nothing is selected, in screen px. */
const PAN_STEP_PX = 60;

export interface ShortcutDeps {
  actions: Actions;
  undo: () => void;
  redo: () => void;
  objs: Objects;
  /** Selected objects that exist. */
  ids: string[];
  settings: EditorSettings;
  setSettings: (patch: Partial<EditorSettings>) => void;
  setTool: (tool: Tool) => void;
  /** Back to Select and clear what is selected. */
  resetToSelect: () => void;
  menuOpen: boolean;
  closeMenu: () => void;
  setSpaceDown: (down: boolean) => void;
  openPinSheet: (id: string) => void;
  editText: (id: string) => void;
  setView: (update: (v: View) => View) => void;
  fitAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleExplore: () => void;
  toggleFullscreen: () => void;
}

/** Handle a key chord with Ctrl or Cmd held. Returns nothing; the caller stops after it. */
function handleModifierKey(e: KeyboardEvent, key: string, d: ShortcutDeps): void {
  const stop = () => {
    e.preventDefault();
  };
  const { actions } = d;
  if (key === 'z') {
    stop();
    if (e.shiftKey) d.redo();
    else d.undo();
  } else if (key === 'y') {
    stop();
    d.redo();
  } else if (key === 'a') {
    stop();
    actions.selectAll();
  } else if (key === 'c') {
    stop();
    actions.copy();
  } else if (key === 'x') {
    stop();
    actions.cut();
  } else if (key === 'v') {
    stop();
    actions.paste();
  } else if (key === 'd') {
    stop();
    actions.duplicate();
  } else if (key === 'g') {
    stop();
    if (e.shiftKey) actions.ungroup();
    else actions.group();
  } else if (key === ']') {
    stop();
    actions.order(e.shiftKey ? 'front' : 'forward');
  } else if (key === '[') {
    stop();
    actions.order(e.shiftKey ? 'back' : 'backward');
  } else if (key === 'l' && e.shiftKey) {
    stop();
    actions.setLocked(true);
  } else if (key === 'h' && e.shiftKey) {
    stop();
    actions.setHidden(true);
  }
}

/** Handle Shift + key chords: fit, grid, rulers, snap and full screen. */
function handleShiftKey(e: KeyboardEvent, key: string, d: ShortcutDeps): void {
  if (key === '1' || e.key === '!') {
    e.preventDefault();
    d.fitAll();
  } else if (key === '2' || e.key === '@') {
    e.preventDefault();
    d.actions.fitSelection();
  } else if (key === 'g') d.setSettings({ grid: !d.settings.grid });
  else if (key === 'r') d.setSettings({ rulers: !d.settings.rulers });
  else if (key === 's') d.setSettings({ snap: !d.settings.snap });
  else if (key === 'f') d.toggleFullscreen();
}

function handleKeyDown(e: KeyboardEvent, d: ShortcutDeps): void {
  if (isTypingTarget(e.target) || overlayOpen()) return;
  const hasModifier = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === ' ' && !hasModifier) {
    e.preventDefault();
    d.setSpaceDown(true);
    return;
  }
  if (hasModifier) {
    handleModifierKey(e, key, d);
    return;
  }
  if (e.altKey) return;
  if (e.key === 'Escape') {
    if (d.menuOpen) d.closeMenu();
    else d.resetToSelect();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    d.actions.remove();
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    if (d.ids[0]) d.actions.rename();
    return;
  }
  if (e.key === 'Enter') {
    const only = d.ids.length === 1 ? d.ids[0] : undefined;
    if (only && d.objs.get(only)?.kind === 'pin') {
      e.preventDefault();
      d.openPinSheet(only);
    } else if (only && d.objs.get(only)?.shape?.t === 'text') {
      e.preventDefault();
      d.editText(only);
    }
    return;
  }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (d.ids.length > 0) d.actions.nudge(dx, dy, e.shiftKey);
    else d.setView((v) => panBy(v, -dx * PAN_STEP_PX, -dy * PAN_STEP_PX));
    return;
  }
  if (e.shiftKey) {
    handleShiftKey(e, key, d);
    return;
  }
  if (key === '+' || key === '=') d.zoomIn();
  else if (key === '-') d.zoomOut();
  else if (key === '0') d.resetZoom();
  else if (key === 'e') d.toggleExplore();
  else {
    const tool = TOOL_KEYS[key];
    if (tool) d.setTool(tool);
  }
}

/**
 * Listen for the editor's shortcuts. The handler is replaced on every render so it always sees the
 * current selection and settings, while the listener itself is attached only once.
 */
export function useEditorShortcuts(deps: ShortcutDeps): void {
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      handleKeyDown(e, latest.current);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') latest.current.setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}
