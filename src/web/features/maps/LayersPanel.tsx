/**
 * The Layers tab: add, rename, reorder, hide, lock and delete layers, and list what is on each.
 */
import { useState } from 'react';
import type { Doc } from './engine/doc';
import { focusOnMount } from './focusOnMount';
import type { Objects } from './engine/shapes';
import type { ObjInfo } from './engine/shapes';

const ICON_BTN =
  'tap inline-flex items-center justify-center rounded-md px-1.5 text-sm hover:bg-surface';

function label(info: ObjInfo): string {
  if (info.kind === 'pin') {
    const name = info.pin?.label;
    return name !== undefined && name !== '' ? name : 'Unnamed marker';
  }
  const s = info.shape;
  if (!s) return 'Object';
  if (s.name) return s.name;
  switch (s.t) {
    case 'text':
      return s.text.length > 24 ? `${s.text.slice(0, 24)}…` : s.text;
    case 'path':
      return s.closed ? 'Loop' : 'Path';
    case 'rect':
      return 'Box';
    case 'ellipse':
      return 'Oval';
    case 'polygon':
      return 'Area';
    case 'connector':
      return s.head === 'none' ? 'Line' : 'Arrow';
  }
}

export interface LayersPanelProps {
  doc: Doc;
  objs: Objects;
  activeLayer: string;
  selection: ReadonlySet<string>;
  onActiveLayer: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onAddLayer: () => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggle: (id: string, flag: 'hidden' | 'locked') => void;
  onMoveLayer: (id: string, dir: 1 | -1) => void;
  onRemoveLayer: (id: string) => void;
  onToggleObject: (id: string, flag: 'hidden' | 'locked') => void;
  onRenameObject: (id: string, name: string) => void;
  onMoveSelectionToLayer: (layer: string) => void;
}

/**
 * Layers, top of the stack first. Click a layer to draw on it; open it to see what is on it. Each
 * layer and each object can be hidden or locked, and renamed by double-clicking.
 */
export function LayersPanel(p: LayersPanelProps) {
  const [open, setOpen] = useState<Set<string>>(new Set([p.activeLayer]));
  const layers = [...p.doc.scene.layers].reverse();
  const top = p.doc.scene.layers.length - 1;
  const objectsOn = (layerId: string) =>
    [...p.objs.values()].filter((o) => o.layer === layerId).reverse();
  const toggleOpen = (id: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold text-ink-2">Layers</h3>
        <button type="button" className="btn tap px-2 text-sm" onClick={p.onAddLayer}>
          New layer
        </button>
      </div>
      <ul aria-label="Layers" className="m-0 flex list-none flex-col gap-1 p-0">
        {layers.map((layer) => {
          const index = p.doc.scene.layers.findIndex((l) => l.id === layer.id);
          const items = open.has(layer.id) ? objectsOn(layer.id) : [];
          const active = p.activeLayer === layer.id;
          return (
            <li
              key={layer.id}
              className={`rounded-md border ${active ? 'border-accent' : 'border-line'}`}
            >
              <div className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  aria-expanded={open.has(layer.id)}
                  aria-label={`${open.has(layer.id) ? 'Collapse' : 'Expand'} ${layer.name}`}
                  className={ICON_BTN}
                  onClick={() => {
                    toggleOpen(layer.id);
                  }}
                >
                  {open.has(layer.id) ? '▾' : '▸'}
                </button>
                <LayerName
                  name={layer.name}
                  active={active}
                  onPick={() => {
                    p.onActiveLayer(layer.id);
                  }}
                  onRename={(n) => {
                    p.onRenameLayer(layer.id, n);
                  }}
                />
                <button
                  type="button"
                  className={ICON_BTN}
                  aria-pressed={layer.hidden ?? false}
                  aria-label={`${layer.hidden ? 'Show' : 'Hide'} ${layer.name}`}
                  title={layer.hidden ? 'Show layer' : 'Hide layer'}
                  onClick={() => {
                    p.onToggle(layer.id, 'hidden');
                  }}
                >
                  {layer.hidden ? '◌' : '●'}
                </button>
                <button
                  type="button"
                  className={ICON_BTN}
                  aria-pressed={layer.locked ?? false}
                  aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  onClick={() => {
                    p.onToggle(layer.id, 'locked');
                  }}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
                <button
                  type="button"
                  className={ICON_BTN}
                  aria-label={`Move ${layer.name} up`}
                  disabled={index === top}
                  onClick={() => {
                    p.onMoveLayer(layer.id, 1);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={ICON_BTN}
                  aria-label={`Move ${layer.name} down`}
                  disabled={index === 0}
                  onClick={() => {
                    p.onMoveLayer(layer.id, -1);
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`${ICON_BTN} text-danger`}
                  aria-label={`Delete ${layer.name}`}
                  disabled={p.doc.scene.layers.length <= 1}
                  onClick={() => {
                    p.onRemoveLayer(layer.id);
                  }}
                >
                  ×
                </button>
              </div>
              {open.has(layer.id) ? (
                <ul className="m-0 flex list-none flex-col border-t border-line p-1">
                  {items.length === 0 ? (
                    <li className="px-2 py-1 text-sm text-ink-muted">Empty</li>
                  ) : null}
                  {items.map((o) => (
                    <li
                      key={o.id}
                      className={`flex items-center gap-1 rounded-md pl-2 ${p.selection.has(o.id) ? 'bg-surface' : ''}`}
                    >
                      <ObjectName
                        info={o}
                        onSelect={() => {
                          p.onSelect([o.id]);
                        }}
                        onRename={(n) => {
                          p.onRenameObject(o.id, n);
                        }}
                      />
                      <button
                        type="button"
                        className={ICON_BTN}
                        aria-pressed={o.hidden}
                        aria-label={`${o.hidden ? 'Show' : 'Hide'} ${label(o)}`}
                        onClick={() => {
                          p.onToggleObject(o.id, 'hidden');
                        }}
                      >
                        {o.hidden ? '◌' : '●'}
                      </button>
                      <button
                        type="button"
                        className={ICON_BTN}
                        aria-pressed={o.locked}
                        aria-label={`${o.locked ? 'Unlock' : 'Lock'} ${label(o)}`}
                        onClick={() => {
                          p.onToggleObject(o.id, 'locked');
                        }}
                      >
                        {o.locked ? '🔒' : '🔓'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {p.selection.size > 0 && p.doc.scene.layers.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          <span>Move selection to</span>
          <select
            aria-label="Move selection to layer"
            value=""
            onChange={(e) => {
              if (e.target.value) p.onMoveSelectionToLayer(e.target.value);
            }}
            className="field-input"
          >
            <option value="">Choose a layer</option>
            {p.doc.scene.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function LayerName({
  name,
  active,
  onPick,
  onRename,
}: {
  name: string;
  active: boolean;
  onPick: () => void;
  onRename: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        ref={focusOnMount}
        defaultValue={name}
        aria-label="Layer name"
        maxLength={40}
        className="tap min-w-0 flex-1 rounded-md border border-accent bg-paper px-2 text-sm"
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value.trim() !== '' && e.target.value !== name)
            onRename(e.target.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      title="Click to draw on this layer. Double-click to rename."
      className={`tap min-w-0 flex-1 truncate rounded-md px-2 text-left text-sm ${active ? 'font-semibold' : ''}`}
      onClick={onPick}
      onDoubleClick={() => {
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') setEditing(true);
      }}
    >
      {name}
      {active ? ' · drawing here' : ''}
    </button>
  );
}

function ObjectName({
  info,
  onSelect,
  onRename,
}: {
  info: ObjInfo;
  onSelect: () => void;
  onRename: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        ref={focusOnMount}
        defaultValue={info.kind === 'pin' ? (info.pin?.label ?? '') : (info.shape?.name ?? '')}
        aria-label="Object name"
        className="tap min-w-0 flex-1 rounded-md border border-accent bg-paper px-2 text-sm"
        onBlur={(e) => {
          setEditing(false);
          onRename(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="tap min-w-0 flex-1 truncate rounded-md px-1 text-left text-sm"
      onClick={onSelect}
      onDoubleClick={() => {
        setEditing(true);
      }}
      title="Click to select. Double-click to rename."
    >
      {label(info)}
    </button>
  );
}
