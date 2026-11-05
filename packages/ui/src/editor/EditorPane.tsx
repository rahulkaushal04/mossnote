import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import type { Note } from '@mossnote/core/rpc';
import { useApp } from '../app/context';
import { AttachmentsPanel, type PanelApi } from '../attachments/AttachmentsPanel';
import { firstLine } from '../app/model';
import { useStore } from '../app/store';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { createAutosave, type Autosave, type Base } from './autosave';
import { FormatToolbar } from './FormatToolbar';
import { FavoriteButton } from '../nav/FavoriteButton';
import { MoveToDialog } from '../nav/MoveToDialog';
import { NoteTags } from '../nav/NoteTags';
import { isReadOnlyNote, isTrashedError, TrashedNoteBanner } from '../trash/TrashedNoteBanner';
import { createEditor, type EditorHandle, type EditorOptions } from './createEditor';
import { formattingCommands } from './formatting';

/** Injected so tests can use a plain fake instead of CodeMirror. */
export type EditorFactory = (parent: HTMLElement, opts: EditorOptions) => EditorHandle;
const defaultFactory: EditorFactory = createEditor;

type View = 'none' | 'loading' | 'error' | 'ready';

export function EditorPane() {
  const { model, createEditor: factory = defaultFactory } = useApp();
  const { client } = model;
  const openId = useStore(model.store, (s) => s.openId);
  const save = useStore(model.store, (s) => s.save);
  const recovered = useStore(model.store, (s) => s.recovered);
  const focusMode = useStore(model.store, (s) => s.focusMode);
  // `loaded` is the note actually in the editor; `openId` runs ahead of it during a switch.
  const [loaded, setLoaded] = useState<string | null>(null);
  const row = useStore(model.store, (s) => s.notes.find((n) => n.id === loaded));
  const [moving, setMoving] = useState(false);
  // Set when the editor shows journaled text that is not in the saved note (savedAt of the journal row).
  const [journalFrom, setJournalFrom] = useState<number | null>(null);
  const [confirmSaved, setConfirmSaved] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<EditorHandle | null>(null);
  const machine = useRef<Autosave | null>(null);
  const loadedId = useRef<string | null>(null);
  const seq = useRef(0);
  const [view, setView] = useState<View>('none');
  const [errorMsg, setErrorMsg] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Enter in the list asks for focus before the note has loaded; the host is hidden until then
  // (focus() on a hidden element does nothing).
  const viewRef = useRef<View>('none');
  viewRef.current = view;
  const wantFocus = useRef(false);

  function startMachine(note: Note, base?: Base, journaled = false) {
    machine.current?.dispose();
    machine.current = createAutosave({
      noteId: note.id,
      base: base ?? { rev: note.rev, contentHash: note.contentHash },
      initialText: note.body,
      journaled,
      getText: () => ed.current?.getText() ?? '',
      writeDraft: (noteId, text, base) => client.call('drafts.write', { noteId, text, base }),
      flushDrafts: (noteId) => client.call('drafts.flush', { noteId }),
      save: (id, body, expectedContentHash) =>
        client.call('notes.save', { id, body, expectedContentHash }),
      timers: model.timers,
      onState: (s) => {
        model.store.set({ save: s });
        if (s.kind === 'saved') {
          model.clearUnsaved(note.id);
          setJournalFrom(null); // the journal rows went with the save
        }
        if (s.kind === 'error' && isTrashedError({ code: s.code })) {
          ed.current?.setReadOnly(true);
          setReadOnly(true);
        }
      },
      onSaved: (r) => model.patchRow(note.id, r),
    });
  }

  // One editor for the life of the pane; notes are swapped in with setText.
  useEffect(() => {
    if (!host.current) return;
    // onDirty copies nothing: the text is read only when a draft or a save is actually sent.
    const handle = factory(host.current, { doc: '', onDirty: () => machine.current?.change() });
    ed.current = handle;
    model.hooks.flush = async () => void (await machine.current?.flushAll());
    model.hooks.focusEditor = () => {
      const open = model.store.get().openId;
      if (viewRef.current === 'ready' && loadedId.current === open) handle.view.focus();
      else if (open) wantFocus.current = true; // focus once the requested note has loaded
    };
    model.hooks.retry = () => void machine.current?.retry();
    model.hooks.discardLoaded = async (noteId) => {
      if (noteId !== loadedId.current) return false;
      await dropJournal();
      return true;
    };
    model.hooks.draftError = (noteId, message) => {
      if (!machine.current || noteId !== loadedId.current) return false;
      machine.current.fail(message);
      return true;
    };
    // Programmatic edits (palette, menu) go through the same guard as typing: no editor state, no edit.
    model.hooks.canFormat = () => !!loadedId.current && handle.view.state?.readOnly === false;
    model.hooks.runFormat = (id) =>
      !!model.hooks.canFormat?.() &&
      (formattingCommands[id as keyof typeof formattingCommands]?.(handle.view) ?? false);
    model.hooks.insertText = (text) => {
      const v = handle.view;
      if (!loadedId.current || v.state?.readOnly !== false || !v.dispatch) return false;
      const at = v.state.selection.main.head;
      v.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        userEvent: 'input',
      });
      return true;
    };
    return () => {
      machine.current?.dispose();
      machine.current = null;
      handle.destroy();
      ed.current = null;
      model.hooks.flush =
        model.hooks.focusEditor =
        model.hooks.retry =
        model.hooks.draftError =
        model.hooks.discardLoaded =
        model.hooks.canFormat =
        model.hooks.runFormat =
        model.hooks.insertText =
          undefined;
    };
  }, [factory, model]);

  useEffect(() => {
    const my = ++seq.current;
    void (async () => {
      const handle = ed.current;
      if (!handle) return;
      const old = machine.current;
      if (old) {
        // Land the old note first. If that fails, or text arrived meanwhile, it stays in the journal and is flagged.
        await old.flushAll();
        if (loadedId.current && (old.state().kind === 'error' || old.dirty()))
          model.markUnsaved(loadedId.current, firstLine(handle.getText()) || 'Untitled');
        if (my !== seq.current) return;
        old.dispose();
        machine.current = null;
      }
      loadedId.current = null;
      setLoaded(null);
      setNotice('');
      setSavedVersion(null);
      setJournalFrom(null);
      model.store.set({ save: { kind: 'saved' } });
      if (!openId) {
        handle.setText('');
        return setView('none');
      }
      setView('loading');
      const r = await client.call('notes.get', { id: openId });
      if (my !== seq.current) return;
      if (!r.ok) {
        setErrorMsg(r.error.message);
        return setView('error');
      }
      const note = r.value;
      const ro = isReadOnlyNote(note);
      // Unsaved journal text for this note wins over the saved body: opening the saved version and
      // typing would make core's save delete the journal rows (B1). Trashed notes show it read-only.
      const fl = await client.call('drafts.flush', { noteId: note.id });
      const rec = fl.ok ? await client.call('drafts.recover', { noteId: note.id }) : undefined;
      if (my !== seq.current) return;
      if (!fl.ok || !rec?.ok) {
        // Never open the saved body silently: typing over it would delete the journal rows.
        const why = !fl.ok ? fl.error.message : rec?.ok === false ? rec.error.message : '';
        setErrorMsg(`could not check for unsaved text (${why})`);
        return setView('error');
      }
      const j = rec.value.find((d) => d.noteId === note.id && !d.matchesNote);
      loadedId.current = note.id;
      setLoaded(note.id);
      handle.setText(j ? j.body : note.body);
      handle.setReadOnly(ro);
      setReadOnly(ro);
      // base: journal text of a changed note goes through the conflict flow when saved.
      // journaled: opening saves nothing; the first real edit does.
      if (!ro) startMachine(note, j?.base, !!j);
      setJournalFrom(j ? j.savedAt : null);
      setView('ready');
    })();
    // startMachine only closes over stable refs and `model`.
  }, [openId, tick]);

  useEffect(() => {
    if (view === 'ready' && wantFocus.current) ed.current?.view.focus();
    if (view !== 'loading') wantFocus.current = false;
  }, [view]);

  /** The banner restored the note: load it again like any open (journal lookup included). */
  function afterRestored() {
    setTick((t) => t + 1);
    void model.refreshList();
  }

  async function keepAsNewNote() {
    const id = loadedId.current;
    if (!id) return;
    const text = ed.current?.getText() ?? '';
    // The copy goes where the original lives.
    const orig = await client.call('notes.get', { id });
    const folderId = orig.ok ? orig.value.folderId : (row?.folderId ?? null);
    const c = await client.call('notes.create', { body: text, ...(folderId ? { folderId } : {}) });
    if (!c.ok) return setNotice(c.error.message);
    // Only journal rows up to the copied text are redundant; text typed since must stay.
    await machine.current?.flushAll();
    await client.call('drafts.flush', { noteId: id });
    const d = await client.call('drafts.recover', { noteId: id });
    const jr = d.ok ? d.value.find((x) => x.noteId === id) : undefined;
    if (jr && jr.body === text) {
      await client.call('drafts.discard', { noteId: id, upToSeq: jr.seq });
      model.clearUnsaved(id);
    } else if (jr) model.markUnsaved(id, firstLine(jr.body) || 'Untitled');
    machine.current?.dispose();
    machine.current = null;
    model.openNote(c.value.id);
    void model.refreshList();
  }

  /** Drops the loaded note's journal rows and reopens the saved note (also the banner's Discard). */
  async function dropJournal() {
    const id = loadedId.current;
    if (!id) return;
    const m = machine.current;
    m?.dispose(); // nothing may save the journal text over the note meanwhile
    machine.current = null;
    await m?.settled(); // a write still on its way would recreate the row after the discard
    await client.call('drafts.flush', { noteId: id });
    const d = await client.call('drafts.recover', { noteId: id });
    const jr = d.ok ? d.value.find((x) => x.noteId === id) : undefined;
    if (jr) await client.call('drafts.discard', { noteId: id, upToSeq: jr.seq });
    model.clearUnsaved(id);
    setConfirmSaved(false);
    setTick((t) => t + 1);
  }

  async function showSaved() {
    const id = loadedId.current;
    if (!id) return;
    const n = await client.call('notes.get', { id });
    if (n.ok) setSavedVersion(n.value.body);
    else setNotice(n.error.message);
  }

  const registerAttach = useCallback(
    (api: PanelApi | null) => {
      if (api) model.hooks.attach = api;
      else delete model.hooks.attach;
    },
    [model],
  );
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  // A dropped file must never navigate the window, so it is always consumed; adding needs the native bridge.
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (model.hooks.attach?.canAttach()) model.hooks.attach.drop([...e.dataTransfer.files]);
  };
  const onDragOver = (e: DragEvent) => hasFiles(e) && e.preventDefault();
  // Image-only clipboards are attached; anything with text keeps the normal paste.
  const onPaste = (e: ClipboardEvent) => {
    const d = e.clipboardData;
    const types = [...(d?.types ?? [])];
    const image = [...(d?.items ?? [])].some(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    if (!image || types.includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    if (model.hooks.attach?.canAttach()) model.hooks.attach.paste();
  };

  const conflict = view === 'ready' && save.kind === 'error' && save.code === 'conflict';
  return (
    <>
      {recovered.length > 0 && (
        <section className="banner" aria-label="Recovered text">
          <p>Unsaved text was found from your last session.</p>
          <ul>
            {recovered.map(({ draft, title }) => (
              <li key={draft.seq}>
                {title} ({new Date(draft.savedAt).toLocaleString()}){' '}
                <button type="button" onClick={() => void model.restoreDraft(draft)}>
                  {draft.baseChanged ? 'Restore as new note' : 'Restore'}
                </button>{' '}
                <button type="button" onClick={() => void model.discardDraft(draft)}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => model.dismissRecovered()}>
            Decide later
          </button>
        </section>
      )}
      {readOnly && view === 'ready' && loaded && (
        <TrashedNoteBanner
          client={client}
          noteId={loaded}
          onRestored={afterRestored}
          onOpenTrash={() => model.nav.select({ kind: 'trash' })}
        />
      )}
      {journalFrom !== null && view === 'ready' && (
        <section className="banner" aria-label="Unsaved text">
          <p>Showing unsaved text from {new Date(journalFrom).toLocaleString()}.</p>
          <button type="button" onClick={() => setConfirmSaved(true)}>
            Use saved version
          </button>
        </section>
      )}
      {confirmSaved && (
        <ConfirmDialog
          title="Use the saved version?"
          description={`The unsaved text from ${new Date(journalFrom ?? 0).toLocaleString()} will be discarded for good.`}
          confirmLabel="Discard unsaved text"
          onConfirm={dropJournal}
          onCancel={() => setConfirmSaved(false)}
        />
      )}
      {conflict && (
        <section className="banner" aria-label="Note changed elsewhere">
          <p>
            The saved version of this note changed. Your text is kept and nothing was overwritten.
          </p>
          <button type="button" onClick={() => void keepAsNewNote()}>
            Keep my text as a new note
          </button>{' '}
          <button type="button" onClick={() => void showSaved()}>
            Show the saved version
          </button>
          {savedVersion !== null && <pre aria-label="Saved version">{savedVersion}</pre>}
        </section>
      )}
      {notice && (
        <p className="banner" role="alert">
          {notice}
        </p>
      )}
      {view === 'ready' && loaded && <FormatToolbar disabled={readOnly} hidden={focusMode} />}
      {view === 'ready' && loaded && (
        <div className="banner toolbar" role="group" aria-label="Note actions" hidden={focusMode}>
          <FavoriteButton
            client={client}
            noteId={loaded}
            favorite={row?.favorite ?? false}
            disabled={readOnly}
            onChange={() => void model.refreshList()}
          />{' '}
          <button type="button" disabled={readOnly} onClick={() => setMoving(true)}>
            Move to…
          </button>
          <NoteTags client={client} noteId={loaded} readOnly={readOnly} />
        </div>
      )}
      {moving && loaded && (
        <MoveToDialog
          client={client}
          entity="note"
          id={loaded}
          label={row?.title || 'Untitled'}
          currentFolderId={row?.folderId ?? null}
          onClose={() => setMoving(false)}
        />
      )}
      {view === 'none' && <p className="pane-msg muted">Select or create a note</p>}
      {view === 'loading' && <p className="pane-msg muted">Loading note…</p>}
      {view === 'error' && (
        <div className="pane-msg" role="alert">
          <p>Couldn’t open note: {errorMsg}</p>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}
      <div
        ref={host}
        className="editor-host"
        hidden={view !== 'ready'}
        onDropCapture={onDrop}
        onDragOverCapture={onDragOver}
        onPasteCapture={onPaste}
      />
      {view === 'ready' && loaded && (
        <div hidden={focusMode}>
          <AttachmentsPanel
            key={loaded}
            client={client}
            noteId={loaded}
            readOnly={readOnly}
            insert={(t) => model.hooks.insertText?.(t) ?? false}
            register={registerAttach}
          />
        </div>
      )}
    </>
  );
}
