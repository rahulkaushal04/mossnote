import { round1, type MPt, type Pt } from '../vec';
import type { TextShape } from './types';

export interface TextLayout {
  lines: string[];
  /** Size of the text block. */
  textW: number;
  textH: number;
  pad: number;
  lineH: number;
  /** Size of the whole object: the card, or the bare text. */
  boxW: number;
  boxH: number;
}

/** Average glyph width as a fraction of font size. Text is measured, not rendered, so it is an estimate. */
const CHAR_W = 0.56;
const LINE_H = 1.25;

/** Break text into lines of at most `maxChars`, keeping explicit newlines and splitting long words. */
function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > maxChars) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    out.push(line);
  }
  return out;
}

/** Where the lines of a text object break, and how big it is. Used by drawing, hit tests and export. */
export function textLayout(shape: TextShape): TextLayout {
  const boxed = shape.kind !== 'plain';
  const pad = boxed ? 10 : 2;
  const lineH = shape.size * LINE_H;
  const width = shape.w ?? (boxed ? 180 : null);
  const lines =
    width === null
      ? shape.text.split('\n')
      : wrap(shape.text, Math.max(3, Math.floor((width - pad * 2) / (shape.size * CHAR_W))));
  const textW = Math.max(...lines.map((l) => l.length), 1) * shape.size * CHAR_W;
  const textH = lines.length * lineH;
  const boxW = width ?? textW + pad * 2;
  return { lines, textW, textH, pad, lineH, boxW, boxH: textH + pad * 2 };
}

/** The centre of a text object: its position is the top-left of the unrotated block. */
export function textCenter(shape: TextShape): MPt {
  const layout = textLayout(shape);
  return [shape.x + layout.boxW / 2, shape.y + layout.boxH / 2];
}

/** The `x`/`y` a text object needs so that its centre lands on `center`. */
export function textTopLeftForCenter(shape: TextShape, center: Pt): MPt {
  const layout = textLayout(shape);
  return [round1(center[0] - layout.boxW / 2), round1(center[1] - layout.boxH / 2)];
}
