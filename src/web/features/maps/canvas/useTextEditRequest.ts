import { useEffect, useRef, useState } from 'react';
import type { CanvasApi } from '../editorTypes';
import type { Objects } from '../engine/shapes';
import { editStateFor } from './commitText';
import type { TextEdit } from './types';

/**
 * The editor can ask for a text object to be edited, for example after pinning a note card to
 * something. The request arrives as `editTextId`; this opens the text box for it once, then tells
 * the editor it was received.
 */
export function useTextEditRequest(
  api: CanvasApi,
  objs: Objects,
  setEdit: (edit: TextEdit | null) => void,
): void {
  const { editTextId } = api;
  const [handled, setHandled] = useState<string | null>(null);
  const onEditStarted = useRef(api.onEditStarted);
  useEffect(() => {
    onEditStarted.current = api.onEditStarted;
  });

  // Read while rendering and acknowledged once, so the request never loops.
  if (editTextId && editTextId !== handled) {
    setHandled(editTextId);
    const next = editStateFor(objs.get(editTextId)?.shape, editTextId);
    if (next) setEdit(next);
  }
  if (!editTextId && handled !== null) setHandled(null);

  useEffect(() => {
    if (editTextId) onEditStarted.current();
  }, [editTextId]);
}
