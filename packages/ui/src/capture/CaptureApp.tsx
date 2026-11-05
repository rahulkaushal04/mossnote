import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bridge } from '@mossnote/core/rpc';
import { createClient } from '../rpc/client';
import { getBridge } from '../rpc/bridge';
import { applyTheme } from '../theme/applyTheme';

export interface CaptureAppProps {
  /** Defaults to window.mossnote. Only capture.save, app.status and prefs.get are ever called. */
  bridge?: Bridge;
  /** Defaults to window.close(). */
  onClose?: () => void;
}

/** The quick-capture window: type, Mod-Enter saves to Inbox, Esc closes. */
export function CaptureApp({ bridge, onClose = () => window.close() }: CaptureAppProps) {
  const client = useMemo(() => createClient(bridge ?? getBridge()), [bridge]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [problem, setProblem] = useState('');
  const busy = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef('');
  latest.current = text;

  useEffect(() => {
    void (async () => {
      const p = await client.call('prefs.get');
      applyTheme(p.ok ? p.value.theme : 'system');
      const st = await client.call('app.status');
      if (!st.ok || st.value.state === 'error')
        setProblem(
          st.ok ? (st.value.message ?? 'The workspace is not available.') : st.error.message,
        );
    })();
  }, [client]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Quit: main asks every window to flush. Save what is typed, then acknowledge (even on failure: no 2 s stall).
  useEffect(
    () =>
      client.onEvent((e) => {
        if (e.type !== 'flushRequest') return;
        void (async () => {
          if (latest.current.trim()) await client.call('capture.save', { text: latest.current });
          await client.call('app.flushed', { token: e.token });
        })();
      }),
    [client],
  );

  async function save() {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    const r = await client.call('capture.save', { text });
    busy.current = false;
    if (r.ok) {
      setText('');
      setMsg({ kind: 'ok', text: 'Saved to Inbox' });
      area.current?.focus();
    } else setMsg({ kind: 'error', text: `Not saved: ${r.error.message}` }); // the text stays
  }

  return (
    <main className="capture" aria-label="Quick capture">
      {problem && <p role="alert">{problem}</p>}
      <label htmlFor="capture-text">Quick note</label>
      <textarea
        id="capture-text"
        ref={area}
        autoFocus
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <button type="button" onClick={() => void save()}>
        Save to Inbox
      </button>
      <p role={msg?.kind === 'error' ? 'alert' : 'status'}>{msg?.text}</p>
      <p className="muted">Ctrl or Cmd+Enter saves. Esc closes.</p>
    </main>
  );
}
