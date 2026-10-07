/** The text box that opens over the canvas to type a label or a note. */
import { useMemo } from 'react';
import { LIMITS } from '@shared/constants';
import { textLayout, type Objects } from '../engine/shapes';
import { focusOnMount } from '../focusOnMount';
import { toScreen, type Size, type View } from '../geometry';
import type { TextEdit } from './types';

/** Width of a new note or label box before it has any text, in map units and pixels. */
const NEW_NOTE_WIDTH = 180;
const NEW_LABEL_WIDTH_PX = 220;
const MIN_WIDTH_PX = 120;
const MIN_FONT_PX = 12;

interface TextEditorProps {
  edit: TextEdit;
  objs: Objects;
  view: View;
  size: Size;
  /** Called with the text on Enter or when focus leaves. */
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({ edit, objs, view, size, onCommit, onCancel }: TextEditorProps) {
  const position = useMemo(() => {
    const existing = edit.id ? objs.get(edit.id) : undefined;
    const shape = existing?.shape?.t === 'text' ? existing.shape : undefined;
    const fontPx = (shape?.size ?? 16) * view.scale;
    const [left, top] = toScreen(view, size, edit.at[0], edit.at[1]);
    const width = shape
      ? textLayout(shape).boxW * view.scale
      : edit.kind === 'sticky'
        ? NEW_NOTE_WIDTH * view.scale
        : NEW_LABEL_WIDTH_PX;
    return {
      left,
      top,
      width: Math.max(MIN_WIDTH_PX, width),
      fontSize: Math.max(MIN_FONT_PX, fontPx),
    };
  }, [edit, objs, view, size]);

  return (
    <textarea
      aria-label={edit.kind === 'sticky' ? 'Note text' : 'Label text'}
      ref={focusOnMount}
      defaultValue={edit.text}
      className="absolute z-10 resize-none rounded-control border border-accent bg-raised px-2 py-1 text-ink shadow-float"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        fontSize: position.fontSize,
        minHeight: position.fontSize * 2.2,
      }}
      maxLength={LIMITS.mapText}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          onCancel();
        } else if (
          e.key === 'Enter' &&
          (e.metaKey || e.ctrlKey || (!e.shiftKey && edit.kind === 'plain'))
        ) {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        }
      }}
      onBlur={(e) => {
        onCommit(e.currentTarget.value);
      }}
    />
  );
}
