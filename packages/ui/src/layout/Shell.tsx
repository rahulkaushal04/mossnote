import { useCallback, useEffect, useRef, useState } from 'react';
import { bindCommands } from '../app/bindings';
import { useApp } from '../app/context';
import { useStore } from '../app/store';
import { useGlobalShortcuts } from '../commands/registry';
import { CleanupDialog } from '../attachments/CleanupDialog';
import { BulkMoveDialog, BulkTagDialog } from '../portability/BulkBar';
import { DataDialog, type DataIntent } from '../portability/DataDialog';
import { EditorPane } from '../editor/EditorPane';
import { NoteList } from '../list/NoteList';
import { SavedSearches } from '../search/SavedSearches';
import { SearchPane } from '../search/SearchPane';
import { FolderTree, type FolderTreeHandle } from '../nav/FolderTree';
import { TagList } from '../nav/TagList';
import { Palette } from '../palette/Palette';
import { ShortcutsView } from '../shortcuts/ShortcutsView';
import { TrashView } from '../trash/TrashView';
import { SaveStatus } from '../status/SaveStatus';
import './shell.css';
import { Splitter } from './Splitter';
import { clampSizes, maxFor, NAV, LIST, SPLITTER_W, type Sizes } from './sizes';

const PERSIST_MS = 300;

function useWindowWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

type Overlay =
  'none' | 'palette' | 'shortcuts' | 'cleanup' | 'data' | 'bulkMove' | 'bulkTag' | 'bulkUntag';
type PaletteNotes = { notes?: { id: string; title: string }[]; error?: string };

/** Every note title for the palette, whatever the nav selection shows. Loaded when it opens. */
function usePaletteNotes(open: boolean, tries: number): PaletteNotes {
  const { model } = useApp();
  const [r, setR] = useState<PaletteNotes>({});
  useEffect(() => {
    if (!open) return;
    let live = true;
    setR({});
    void model.client.call('notes.list', { limit: 100_000 }).then((x) => {
      if (live) setR(x.ok ? { notes: x.value } : { error: x.error.message });
    });
    return () => {
      live = false;
    };
  }, [open, tries, model]);
  return r;
}

export function Shell() {
  const { model, registry } = useApp();
  const prefs = useStore(model.store, (s) => s.prefs);
  const focusMode = useStore(model.store, (s) => s.focusMode);
  const navKind = useStore(model.nav, (s) => s.kind);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [tries, setTries] = useState(0);
  const [intent, setIntent] = useState<DataIntent>('open');
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const tree = useRef<FolderTreeHandle>(null);
  const palette = usePaletteNotes(overlay === 'palette', tries);
  useGlobalShortcuts(registry);
  const [sizes, setSizes] = useState<Sizes>({
    nav: prefs?.navWidth ?? 240,
    list: prefs?.listWidth ?? 320,
    navCollapsed: prefs?.navCollapsed ?? false,
  });
  const width = useWindowWidth();
  const eff = clampSizes(sizes, width);
  const timer = useRef<unknown>(undefined);

  // Debounced write of the PREFERRED sizes (a window shrink must not overwrite them).
  const update = useCallback(
    (next: Sizes) => {
      setSizes(next);
      if (timer.current !== undefined) model.timers.clearTimeout(timer.current);
      timer.current = model.timers.setTimeout(() => {
        timer.current = undefined;
        void model.client.call('prefs.set', {
          navWidth: next.nav,
          listWidth: next.list,
          navCollapsed: next.navCollapsed,
        });
      }, PERSIST_MS);
    },
    [model],
  );
  useEffect(
    () => () => {
      if (timer.current !== undefined) model.timers.clearTimeout(timer.current);
    },
    [model],
  );

  const toggleNav = useRef(() => {});
  toggleNav.current = () => update({ ...sizes, navCollapsed: !sizes.navCollapsed });
  useEffect(
    () =>
      bindCommands(registry, model, {
        tree: () => tree.current,
        togglePalette: () => setOverlay((o) => (o === 'palette' ? 'none' : 'palette')),
        toggleShortcuts: () => setOverlay((o) => (o === 'shortcuts' ? 'none' : 'shortcuts')),
        toggleNav: () => toggleNav.current(),
        openCleanup: () => setOverlay('cleanup'),
        openData: (i) => {
          setIntent(i);
          setOverlay('data');
        },
        openBulk: (k, ids) => {
          setBulkIds(ids);
          setOverlay(k === 'move' ? 'bulkMove' : k === 'tag' ? 'bulkTag' : 'bulkUntag');
        },
      }),
    [registry, model],
  );

  // Esc priority: dialog > palette (both own their Esc) > focus mode > editor tab-focus. Capture
  // phase and no defaultPrevented check: CodeMirror's own Esc handler marks the event handled.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[aria-modal=true], [role=alertdialog]'))
        return;
      e.preventDefault();
      e.stopPropagation();
      model.toggleFocusMode();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusMode, model]);

  const navMax = maxFor('nav', sizes, width);
  const listMax = maxFor('list', sizes, width);
  const cols = focusMode
    ? '0 0 0 0 minmax(0, 1fr)'
    : `${eff.navHidden ? 0 : eff.nav}px ${SPLITTER_W}px ${eff.list}px ${SPLITTER_W}px minmax(0, 1fr)`;
  return (
    <>
      <div className="shell" style={{ gridTemplateColumns: cols }}>
        <nav id="pane-nav" aria-label="Folders and tags" hidden={eff.navHidden || focusMode}>
          <h1 className="brand">Mossnote</h1>
          <FolderTree ref={tree} client={model.client} nav={model.nav} actions={model.actions} />
          <TagList client={model.client} nav={model.nav} />
          <SavedSearches />
        </nav>
        {!focusMode && (
          <Splitter
            label="Resize sidebar"
            controls="pane-nav"
            value={eff.nav}
            min={NAV.min}
            max={navMax}
            onChange={(v) => update({ ...sizes, nav: v, navCollapsed: false })}
            onToggle={() => update({ ...sizes, navCollapsed: !sizes.navCollapsed })}
          />
        )}
        <section id="pane-list" aria-label="Notes" hidden={focusMode}>
          <SearchPane>
            {navKind === 'trash' ? (
              <TrashView
                client={model.client}
                onBack={() => model.nav.select({ kind: 'all' })}
                onOpenNote={(id) => model.openNote(id)}
                onRestored={(_item, notice) =>
                  model.toasts.push({ message: notice, lifetimeMs: 4000 })
                }
              />
            ) : (
              <NoteList />
            )}
          </SearchPane>
        </section>
        {!focusMode && (
          <Splitter
            label="Resize note list"
            controls="pane-list"
            value={eff.list}
            min={LIST.min}
            max={Math.max(LIST.min, listMax)}
            onChange={(v) => update({ ...sizes, list: v })}
          />
        )}
        <main aria-label="Editor">
          <EditorPane />
        </main>
        <footer aria-label="Status" hidden={focusMode}>
          <SaveStatus />
        </footer>
      </div>
      {overlay === 'palette' && (
        <Palette
          commands={registry.list()}
          notes={palette.notes}
          {...(palette.error ? { notesError: palette.error } : {})}
          onRetryNotes={() => setTries((t) => t + 1)}
          // Choosing "Command palette" inside the palette only closes it (it already closed itself).
          onRunCommand={(id) => id !== 'view.palette' && void registry.run(id)}
          onOpenNote={(id) => model.openNote(id)}
          onCreateNote={(title) => void model.createNote(title)}
          onClose={() => setOverlay('none')}
        />
      )}
      {overlay === 'cleanup' && (
        <CleanupDialog
          client={model.client}
          prefs={prefs}
          onPrefs={(p) => model.store.set({ prefs: p })}
          onClose={() => setOverlay('none')}
        />
      )}
      {overlay === 'data' && (
        <DataDialog
          client={model.client}
          jobs={model.jobs}
          intent={intent}
          onClose={() => setOverlay('none')}
        />
      )}
      {overlay === 'bulkMove' && (
        <BulkMoveDialog
          client={model.client}
          count={bulkIds.length}
          onCancel={() => setOverlay('none')}
          onSubmit={async (folderId, label) => {
            // Close first: focus the bar after the dialog (and its focus trap) is gone.
            setOverlay('none');
            await model.bulk.move(bulkIds, folderId, label);
          }}
        />
      )}
      {(overlay === 'bulkTag' || overlay === 'bulkUntag') && (
        <BulkTagDialog
          client={model.client}
          count={bulkIds.length}
          on={overlay === 'bulkTag'}
          onCancel={() => setOverlay('none')}
          onSubmit={async (tagId, name) => {
            setOverlay('none');
            await model.bulk.tag(bulkIds, tagId, overlay === 'bulkTag', name);
          }}
        />
      )}
      {overlay === 'shortcuts' && <ShortcutsView onClose={() => setOverlay('none')} />}
    </>
  );
}
