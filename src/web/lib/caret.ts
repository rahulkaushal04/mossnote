const COPIED = [
  'direction',
  'boxSizing',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

export interface CaretPosition {
  top: number;
  left: number;
  height: number;
}

/**
 * Where the caret is inside a textarea, relative to the textarea's top-left corner. Uses a hidden
 * mirrored element, not a dependency: copy the textarea's text metrics, lay out
 * the text up to the caret, and measure a marker span placed at the caret.
 */
export function caretPosition(textarea: HTMLTextAreaElement, offset: number): CaretPosition {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(textarea);
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  for (const prop of COPIED) mirror.style[prop] = computed[prop];
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(offset) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const lineHeight = Number.parseFloat(computed.lineHeight);
  const position = {
    top: marker.offsetTop - textarea.scrollTop,
    left: marker.offsetLeft - textarea.scrollLeft,
    height: Number.isFinite(lineHeight) ? lineHeight : marker.offsetHeight,
  };
  mirror.remove();
  return position;
}
