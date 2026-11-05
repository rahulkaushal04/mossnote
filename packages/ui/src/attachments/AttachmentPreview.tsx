import { useEffect, useRef, useState } from 'react';
import type { Client } from '../rpc/client';
import type { NativeBridge } from './native';
import { DAMAGED_MESSAGE, formatSize, type AttachmentRef } from './types';

/** Text previews read at most this many bytes. */
export const TEXT_PREVIEW_CAP = 64 * 1024;

type Loader = (url: string, cap: number) => Promise<string>;

export interface PreviewProps {
  attachment: AttachmentRef;
  client: Client;
  native?: NativeBridge | undefined;
  /**
   * Reads the first `cap` bytes of a text attachment. The page itself never fetches (the CSP has
   * `connect-src 'none'` and the offline gate forbids fetch), so the default is main's optional
   * `native.readText`; without either, the card says to use Save copy.
   */
  fetchText?: Loader;
}

function InfoCard({
  a,
  native,
  note,
}: {
  a: AttachmentRef;
  native?: NativeBridge | undefined;
  note?: string;
}) {
  return (
    <div className="att-card">
      <p>
        <bdi>{a.name}</bdi>
      </p>
      <p className="muted">
        {a.kind}, {formatSize(a.size)}
        {a.mime ? `, ${a.mime}` : ''}
      </p>
      {note && <p className="muted">{note}</p>}
      {!native && <p className="muted">Use the desktop app to save or reveal this file.</p>}
    </div>
  );
}

function TextPreview({ a, load }: { a: AttachmentRef; load: Loader }) {
  const [st, setSt] = useState<{ text?: string; failed?: true }>({});
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setSt({});
    loader.current(a.url, TEXT_PREVIEW_CAP).then(
      (t) => live && setSt({ text: t.slice(0, TEXT_PREVIEW_CAP) }),
      () => live && setSt({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [a.url]);
  if (st.failed)
    return <p role="status">The text could not be previewed. Use Save copy to read it.</p>;
  if (st.text === undefined) return <p role="status">Loading preview…</p>;
  return (
    <pre className="att-text" tabIndex={0} aria-label={`Text of ${a.name}`}>
      {st.text}
      {a.size > TEXT_PREVIEW_CAP ? '\n…' : ''}
    </pre>
  );
}

/**
 * One attachment's preview. Names and file contents are untrusted: they only ever reach text nodes.
 * SVG is an <img> (never inline, never an iframe), PDF is a card (no rendering in v1).
 */
export function AttachmentPreview({ attachment: a, client, native, fetchText }: PreviewProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const onError = () => {
    setBroken(DAMAGED_MESSAGE);
    void client
      .call('attachments.info', { sha256: a.sha256, noteId: a.noteId, verify: true })
      .then((r) =>
        setBroken(
          r.ok ? (r.value.message ?? 'This file could not be displayed.') : r.error.message,
        ),
      );
  };
  if (broken !== null) return <p role="alert">{broken}</p>;
  switch (a.kind) {
    case 'image':
    case 'svg':
      return <img className="att-image" src={a.url} alt={a.name} onError={onError} />;
    case 'audio':
      return <audio controls src={a.url} aria-label={a.name} onError={onError} />;
    case 'video':
      return (
        <video controls src={a.url} aria-label={a.name} onError={onError} className="att-image" />
      );
    case 'text': {
      const load: Loader | undefined =
        fetchText ??
        (native?.readText
          ? async (_url, cap) => {
              const r = await native.readText!(a.sha256, a.noteId, cap);
              if (!r.ok) throw new Error(r.error.message);
              return r.value.text;
            }
          : undefined);
      if (!load)
        return (
          <InfoCard
            a={a}
            native={native}
            note="A text preview is not available here. Use Save copy to read it."
          />
        );
      return <TextPreview a={a} load={load} />;
    }
    case 'pdf':
      return (
        <InfoCard
          a={a}
          native={native}
          note="PDF pages are not shown in the app. Its text is searchable."
        />
      );
    case 'executable':
      return (
        <InfoCard
          a={a}
          native={native}
          note="This file can be revealed in the file manager but is never opened by Mossnote."
        />
      );
    default:
      return <InfoCard a={a} native={native} />;
  }
}
