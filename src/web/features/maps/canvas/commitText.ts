import { LIMITS } from '@shared/constants';
import type { MapShape } from '@shared/schemas/map';
import type { CanvasApi } from '../editorTypes';
import { updateShape } from '../engine/doc';
import { makeText } from '../engine/make';
import { addShape, drawStyleOf } from './helpers';
import type { TextEdit } from './types';

/**
 * Save what was typed into a text box: add a new text object, change an existing one, or delete
 * the object if it was emptied. A new, empty box is simply dropped.
 */
export function commitTextEdit(api: CanvasApi, edit: TextEdit, text: string): void {
  const value = text.trim().slice(0, LIMITS.mapText);
  if (edit.id === null) {
    if (value === '') return;
    addShape(api, makeText(edit.at, value, edit.kind, drawStyleOf(api), api.layer));
    api.finishTool();
    return;
  }
  const id = edit.id;
  if (value === '') {
    api.commit((d) => ({
      ...d,
      scene: { ...d.scene, shapes: d.scene.shapes.filter((s) => s.id !== id) },
    }));
    api.setSelection([]);
    return;
  }
  api.commit((d) => updateShape(d, id, (s) => (s.t === 'text' ? { ...s, text: value } : s)));
}

/** The text box state for editing an existing text object, or null if it is not text. */
export function editStateFor(shape: MapShape | undefined, id: string): TextEdit | null {
  if (shape?.t !== 'text') return null;
  return {
    id,
    at: [shape.x, shape.y],
    kind: shape.kind === 'sticky' ? 'sticky' : 'plain',
    text: shape.text,
  };
}
