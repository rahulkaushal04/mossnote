import { WidgetType, type EditorView } from '@codemirror/view';
import { getNative } from '../attachments/native';

const DATA_IMAGE = /^data:image\//i;
/** Exactly the attachment protocol form (lowercase hex only); anything looser stays inert. */
const ATTACHMENT_URL = /^mossnote-attachment:\/\/a\/[0-9a-f]{64}$/;
const REMOTE_URL = /^https?:\/\//i;
export const INERT_IMAGE_TEXT = 'Image not loaded (remote or unsupported)';
export const MISSING_ATTACHMENT_TEXT =
  'Attachment not available. It may be missing or damaged; restore it from a backup.';
const KEY_FULL = 4096;

/** Only a `data:image/` URL or an exact attachment URL ever reaches an <img>; everything else is inert text. */
export function isRenderableImageUrl(head: string): boolean {
  return DATA_IMAGE.test(head) || ATTACHMENT_URL.test(head);
}

/** What eq() compares: the whole URL, or length + both ends for a huge data: URL (never copied whole). */
export function urlKey(len: number, head: string, tail: string): string {
  return len <= KEY_FULL ? head : `${len}|${head.slice(0, 128)}|${tail.slice(-128)}`;
}

function inert(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'cm-image-inert';
  s.textContent = text;
  return s;
}

/**
 * Reads the URL lazily in toDOM (data URLs can be megabytes, never copied per rebuild).
 * `key` stands for the URL in eq() (see urlKey), so editing a hash or a URL rebuilds the widget.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly from: number, // URL range in the document; from === to means no URL
    readonly to: number,
    readonly key: string = '',
  ) {
    super();
  }
  override eq(o: ImageWidget): boolean {
    return o.alt === this.alt && o.to - o.from === this.to - this.from && o.key === this.key;
  }
  override toDOM(view: EditorView): HTMLElement {
    const url = this.to > this.from ? view.state.sliceDoc(this.from, this.to) : '';
    if (isRenderableImageUrl(url)) return this.image(url);
    const s = inert(INERT_IMAGE_TEXT);
    const native = getNative();
    // No request is made by the page: Load asks main, which confirms with the user and fetches.
    if (!REMOTE_URL.test(url) || !native) return s;
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-remote';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Load image';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      native.loadRemoteImage(url).then(
        (r) => {
          if (r.ok && DATA_IMAGE.test(r.value.dataUrl))
            wrap.replaceChildren(this.image(r.value.dataUrl));
          else {
            s.textContent = r.ok ? INERT_IMAGE_TEXT : r.error.message;
            btn.disabled = false;
          }
        },
        () => {
          s.textContent = 'The image could not be loaded.';
          btn.disabled = false;
        },
      );
    });
    wrap.append(s, btn);
    return wrap;
  }
  private image(src: string): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-image';
    img.alt = this.alt;
    img.src = src;
    // A missing or damaged attachment: say so in place instead of a broken-image icon.
    img.addEventListener('error', () => img.replaceWith(inert(MISSING_ATTACHMENT_TEXT)));
    return img;
  }
}
