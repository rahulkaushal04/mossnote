import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useStore } from '../app/store';
import type { Client } from '../rpc/client';
import type { TrashActions } from '../trash/trashActions';
import { flattenFolders } from './folderRows';
import { MoveToDialog } from './MoveToDialog';
import type { NavStore } from './navStore';
import { useLoad } from './useLoad';

export interface FolderTreeHandle {
  /** New folder inside the selected folder (or at the top level), opened for naming. */
  newFolder(): Promise<void>;
  /** Starts inline rename of the selected folder (no-op if a fixed entry is selected). */
  renameSelected(): void;
}
export interface FolderTreeProps {
  client: Client;
  nav: NavStore;
  /** Only `deleteFolder` is used (Delete key and the "Move to Trash" menu item). */
  actions: Pick<TrashActions, 'deleteFolder'>;
  /** Imperative handle for the `folder.new` / `folder.rename` commands. */
  ref?: Ref<FolderTreeHandle>;
}

type Kind = 'all' | 'favorites' | 'trash' | 'folder';
interface RowModel {
  key: string;
  kind: Kind;
  id?: string;
  label: string;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  posinset?: number;
  setsize?: number;
  parentKey?: string;
}

interface RowProps {
  rowKey: string;
  kind: Kind;
  label: string;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  posinset?: number;
  setsize?: number;
  active: boolean;
  selected: boolean;
  renaming: boolean;
  count?: number;
  onCommit(value: string): Promise<boolean>;
  onCancel(): void;
}

// Memoized with primitive props only: an arrow key re-renders two rows, not 10 000.
const Row = memo(function Row(p: RowProps) {
  return (
    <li
      role="treeitem"
      data-key={p.rowKey}
      aria-level={p.level}
      aria-selected={p.selected}
      aria-expanded={p.hasChildren ? p.expanded : undefined}
      aria-posinset={p.posinset}
      aria-setsize={p.setsize}
      tabIndex={p.active ? 0 : -1}
      style={{ paddingInlineStart: `calc(var(--sp-2) + ${p.level - 1} * var(--sp-3))` }}
    >
      {p.kind === 'folder' && (
        <span aria-hidden="true" data-chevron="">
          {p.hasChildren ? (p.expanded ? '▾ ' : '▸ ') : '  '}
        </span>
      )}
      {p.renaming ? (
        <RenameInput label={p.label} onCommit={p.onCommit} onCancel={p.onCancel} />
      ) : (
        p.label
      )}
      {p.count !== undefined && ` (${p.count})`}
    </li>
  );
});

function RenameInput(p: {
  label: string;
  onCommit(v: string): Promise<boolean>;
  onCancel(): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    if (!(await p.onCommit(ref.current?.value ?? ''))) done.current = false;
  };
  return (
    <input
      ref={ref}
      defaultValue={p.label}
      aria-label={`Rename folder ${p.label}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (!done.current) {
            done.current = true;
            p.onCancel();
          }
        }
      }}
      onBlur={() => void commit()}
    />
  );
}

/**
 * The navigation tree: All notes, Favorites, the folder hierarchy (any depth), Trash with its
 * count. One tab stop (roving tabindex). Up/Down/Home/End move, Right/Left expand, collapse or
 * jump to the child/parent, Enter selects, F2 renames inline (Enter saves, Esc cancels), Delete
 * moves a folder to Trash through the undo toast, ContextMenu or Shift+F10 opens the actions menu
 * (New subfolder, Rename, Move to…, Move to Trash). Reloads itself on `changed` events.
 */
export function FolderTree({ client, nav, actions, ref }: FolderTreeProps) {
  const folders = useLoad(client, () => client.call('folders.list'), ['folder']);
  const trash = useLoad(client, () => client.call('trash.list'), ['trash']);
  const selKind = useStore(nav, (s) => s.kind);
  const selId = useStore(nav, (s) => s.id);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const ulRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const rows = useMemo<RowModel[]>(() => {
    const out: RowModel[] = [
      {
        key: 'all',
        kind: 'all',
        label: 'All notes',
        level: 1,
        hasChildren: false,
        expanded: false,
      },
      {
        key: 'favorites',
        kind: 'favorites',
        label: 'Favorites',
        level: 1,
        hasChildren: false,
        expanded: false,
      },
    ];
    for (const r of flattenFolders(folders.data ?? [], (id) => expanded.has(id)))
      out.push({
        key: `f:${r.folder.id}`,
        kind: 'folder',
        id: r.folder.id,
        label: r.folder.name,
        level: r.level,
        hasChildren: r.hasChildren,
        expanded: r.expanded,
        posinset: r.posinset,
        setsize: r.setsize,
        parentKey: r.parentId ? `f:${r.parentId}` : undefined,
      });
    out.push({
      key: 'trash',
      kind: 'trash',
      label: 'Trash',
      level: 1,
      hasChildren: false,
      expanded: false,
    });
    return out;
  }, [folders.data, expanded]);

  const selectedKey = selKind === 'folder' ? `f:${selId}` : selKind;
  const active =
    activeKey && rows.some((r) => r.key === activeKey)
      ? activeKey
      : rows.some((r) => r.key === selectedKey)
        ? selectedKey
        : 'all';

  // The selected folder vanished (deleted or trashed): fall back to All notes.
  useEffect(() => {
    if (
      folders.status === 'ready' &&
      selKind === 'folder' &&
      !folders.data?.some((f) => f.id === selId)
    )
      nav.select({ kind: 'all' });
  }, [folders.status, folders.data, selKind, selId, nav]);

  const rowEl = (key: string) =>
    [...(ulRef.current?.children ?? [])].find((c) => (c as HTMLElement).dataset.key === key) as
      HTMLElement | undefined;
  useEffect(() => {
    const k = pendingFocus.current;
    if (!k) return;
    const el = rowEl(k);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });
  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setActiveKey(key);
    rowEl(key)?.focus();
  };

  const L = useRef({ rows, folders: folders.data ?? [] });
  L.current = { rows, folders: folders.data ?? [] };
  const folderOf = (id: string) => L.current.folders.find((f) => f.id === id);

  const expand = (id: string, on: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const select = (r: RowModel) => {
    setActiveKey(r.key);
    nav.select(r.kind === 'folder' ? { kind: 'folder', id: r.id } : { kind: r.kind });
  };

  const renamingRef = useRef<string | null>(null);
  renamingRef.current = renaming;
  const onCommit = useCallback(
    async (value: string): Promise<boolean> => {
      const id = renamingRef.current;
      const f = id ? folderOf(id) : undefined;
      if (!id || !f) return true;
      const name = value.trim();
      if (!name) {
        setErr('A folder needs a name.');
        return false;
      }
      if (name !== f.name) {
        const r = await client.call('folders.rename', { id, name });
        if (!r.ok) {
          setErr(r.error.message);
          return false;
        }
      }
      setErr('');
      pendingFocus.current = `f:${id}`;
      setRenaming(null);
      return true;
    },
    [client],
  );
  const onCancel = useCallback(() => {
    pendingFocus.current = renamingRef.current ? `f:${renamingRef.current}` : null;
    setErr('');
    setRenaming(null);
  }, []);

  const startRename = (id: string) => {
    setErr('');
    setActiveKey(`f:${id}`);
    setRenaming(id);
  };
  const newFolder = async (parentId: string | null) => {
    const r = await client.call('folders.create', { name: 'New folder', parentId });
    if (!r.ok) return setErr(r.error.message);
    setErr('');
    if (parentId) expand(parentId, true);
    startRename(r.value.id);
  };
  const selectedFolderId = selKind === 'folder' ? (selId ?? null) : null;
  useImperativeHandle(ref, () => ({
    newFolder: () => newFolder(selectedFolderId),
    // F2 renames the row that has focus (a folder can be focused without being selected).
    renameSelected: () => {
      const f = rowOf(document.activeElement);
      const id = f?.kind === 'folder' ? f.id : selectedFolderId;
      if (id) startRename(id);
    },
  }));

  const trashFolder = async (r: RowModel) => {
    const rs = L.current.rows;
    const i = rs.findIndex((x) => x.key === r.key);
    let j = i + 1;
    while (j < rs.length && rs[j]!.level > r.level) j++; // skip the subtree
    const neighbour = rs[j] ?? rs[i - 1];
    const res = await actions.deleteFolder(r.id!, r.label);
    if (!res.ok) return setErr(res.message);
    setErr('');
    pendingFocus.current = neighbour?.key ?? 'all';
    setActiveKey(neighbour?.key ?? 'all');
  };

  const rowOf = (target: EventTarget | null) => {
    const key = (target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    return L.current.rows.find((r) => r.key === key);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const rs = L.current.rows;
    const r = rowOf(e.target);
    if (!r) return;
    const i = rs.indexOf(r);
    if (e.key === 'ArrowDown') focusRow(rs[Math.min(rs.length - 1, i + 1)]?.key);
    else if (e.key === 'ArrowUp') focusRow(rs[Math.max(0, i - 1)]?.key);
    else if (e.key === 'Home') focusRow(rs[0]?.key);
    else if (e.key === 'End') focusRow(rs[rs.length - 1]?.key);
    else if (e.key === 'ArrowRight' && r.hasChildren) {
      if (!r.expanded) expand(r.id!, true);
      else focusRow(rs[i + 1]?.key);
    } else if (e.key === 'ArrowLeft' && r.kind === 'folder') {
      if (r.expanded) expand(r.id!, false);
      else focusRow(r.parentKey);
    } else if (e.key === 'Enter' || e.key === ' ') select(r);
    else if (e.key === 'F2' && r.kind === 'folder') startRename(r.id!);
    else if (e.key === 'Delete' && r.kind === 'folder') void trashFolder(r);
    else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && r.kind === 'folder')
      setMenu(r.id!);
    else return;
    e.preventDefault();
  };

  const trashCount = trash.data?.length;
  const menuFolder = menu ? folderOf(menu) : undefined;
  return (
    <div>
      <button type="button" onClick={() => void newFolder(selectedFolderId)}>
        New folder
      </button>
      {folders.status === 'loading' && <p className="muted">Loading folders…</p>}
      {folders.status === 'ready' && folders.data?.length === 0 && (
        <p className="muted">No folders yet. Use “New folder” to add one.</p>
      )}
      {folders.status === 'error' && (
        <div role="alert">
          <p>Couldn’t load folders: {folders.error}</p>
          <button type="button" onClick={() => void folders.reload()}>
            Retry
          </button>
        </div>
      )}
      <ul
        ref={ulRef}
        role="tree"
        aria-label="Folders"
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const r = rowOf(e.target);
          if (!r) return;
          if ((e.target as HTMLElement).closest('[data-chevron]') && r.hasChildren)
            expand(r.id!, !r.expanded);
          else select(r);
        }}
        onContextMenu={(e) => {
          const r = rowOf(e.target);
          if (r?.kind === 'folder') {
            e.preventDefault();
            setMenu(r.id!);
          }
        }}
      >
        {rows.map((r) => (
          <Row
            key={r.key}
            rowKey={r.key}
            kind={r.kind}
            label={r.label}
            level={r.level}
            hasChildren={r.hasChildren}
            expanded={r.expanded}
            posinset={r.posinset}
            setsize={r.setsize}
            active={r.key === active}
            selected={r.key === selectedKey}
            renaming={r.kind === 'folder' && r.id === renaming}
            count={r.kind === 'trash' ? trashCount : undefined}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        ))}
      </ul>
      {err && <p role="alert">{err}</p>}
      {menuFolder && (
        <FolderMenu
          name={menuFolder.name}
          onClose={(restoreFocus) => {
            if (restoreFocus) pendingFocus.current = `f:${menuFolder.id}`;
            setMenu(null);
          }}
          items={[
            ['New subfolder', () => void newFolder(menuFolder.id)],
            ['Rename', () => startRename(menuFolder.id)],
            ['Move to…', () => setMoving(menuFolder.id)],
            [
              'Move to Trash',
              () => {
                const r = L.current.rows.find((x) => x.key === `f:${menuFolder.id}`);
                if (r) void trashFolder(r);
              },
            ],
          ]}
        />
      )}
      {moving && folderOf(moving) && (
        <MoveToDialog
          client={client}
          entity="folder"
          id={moving}
          label={folderOf(moving)!.name}
          currentFolderId={folderOf(moving)!.parentId}
          onClose={() => {
            pendingFocus.current = `f:${moving}`;
            setMoving(null);
          }}
        />
      )}
    </div>
  );
}

function FolderMenu(p: {
  name: string;
  items: [string, () => void][];
  onClose(restoreFocus: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els[els.length - 1]?.focus();
    else if (e.key === 'Enter' || e.key === ' ') els[i]?.click();
    else if (e.key === 'Escape' || e.key === 'Tab') p.onClose(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div ref={ref} role="menu" aria-label={`Actions for folder ${p.name}`} onKeyDown={onKeyDown}>
      {p.items.map(([label, run]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            p.onClose(false);
            run();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
