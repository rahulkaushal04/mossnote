import { useEffect, useMemo } from 'react';
import type { Bridge } from '@mossnote/core/rpc';
import type { EditorFactory } from '../editor/EditorPane';
import { createRegistry } from '../commands/registry';
import { Shell } from '../layout/Shell';
import { Toasts } from '../toast/Toasts';
import { getBridge } from '../rpc/bridge';
import type { Timers } from '../editor/autosave';
import { AppContext } from './context';
import { attachEvents, createModel, type AppModel } from './model';
import { useStore } from './store';

export interface AppProps {
  /** Defaults to window.mossnote. */
  bridge?: Bridge;
  timers?: Timers;
  createEditor?: EditorFactory;
  /** Defaults to the `app.quit` RPC (main flushes and quits). */
  onQuit?: () => void;
  /** Hands the model to later stages (command registry) and to tests. */
  onReady?: (model: AppModel) => void;
}

export function App({ bridge, timers, createEditor, onQuit, onReady }: AppProps) {
  const model = useMemo(
    () => createModel({ bridge: bridge ?? getBridge(), ...(timers ? { timers } : {}) }),
    [bridge, timers],
  );
  const registry = useMemo(() => createRegistry(), []);
  const boot = useStore(model.store, (s) => s.boot);
  const fatal = useStore(model.store, (s) => s.fatal);

  useEffect(() => {
    // Menu clicks from main arrive as `command` events and run the same handlers as the keys.
    const off = attachEvents(model, (id) => void registry.run(id));
    // Fallback only: the real quit path is the flushRequest handshake from main.
    const onUnload = () => void model.hooks.flush?.();
    window.addEventListener('beforeunload', onUnload);
    onReady?.(model);
    void model.start();
    return () => {
      off();
      window.removeEventListener('beforeunload', onUnload);
      model.dispose();
    };
  }, [model, registry]);

  if (boot === 'fatal')
    return (
      <main aria-label="Mossnote cannot start" className="pane-msg">
        <h1>Mossnote can’t open your notes</h1>
        <p role="alert">{fatal}</p>
        <button type="button" onClick={onQuit ?? (() => void model.client.call('app.quit'))}>
          Quit
        </button>
      </main>
    );
  if (boot === 'loading') return <p className="pane-msg muted">Loading…</p>;
  return (
    <AppContext.Provider value={{ model, registry, ...(createEditor ? { createEditor } : {}) }}>
      <Shell />
      <Toasts store={model.toasts} />
    </AppContext.Provider>
  );
}
