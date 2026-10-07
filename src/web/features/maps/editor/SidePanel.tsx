/** The side panel: Details (inspector) and Layers tabs. */
import type { Actions, DrawStyle } from '../editorTypes';
import {
  addLayer,
  moveLayer,
  moveToLayer,
  objectsOf,
  removeLayer,
  renameObject,
  setFlag,
  updateLayer,
  type Doc,
} from '../engine/doc';
import type { Objects } from '../engine/shapes';
import { Inspector } from '../Inspector';
import { LayersPanel } from '../LayersPanel';

export type PanelTab = 'inspect' | 'layers';

interface SidePanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  doc: Doc;
  objs: Objects;
  /** Selected objects the person may change. */
  editableIds: string[];
  selection: ReadonlySet<string>;
  setSelection: (ids: Iterable<string>) => void;
  activeLayer: string;
  onActiveLayer: (id: string) => void;
  draw: DrawStyle;
  setDraw: (patch: Partial<DrawStyle>) => void;
  commit: (fn: (d: Doc) => Doc, options?: { coalesce?: string }) => void;
  actions: Actions;
  onOpenPin: (id: string) => void;
  onManageTypes: () => void;
  onAddSuggestedLayers: () => void;
}

export function SidePanel(p: SidePanelProps) {
  const { commit, doc } = p;
  const selected = () => new Set(p.editableIds);
  return (
    <div id="map-panel" className="flex min-h-0 flex-col gap-3">
      <div role="tablist" aria-label="Side panel" className="flex gap-1">
        {(['inspect', 'layers'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={p.tab === tab}
            className={`btn tap flex-1 text-sm ${p.tab === tab ? 'btn-primary' : ''}`}
            onClick={() => {
              p.onTab(tab);
            }}
          >
            {tab === 'inspect' ? 'Details' : 'Layers'}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 overflow-y-auto pr-1">
        {p.tab === 'inspect' ? (
          <Inspector
            doc={doc}
            objs={p.objs}
            ids={p.editableIds}
            draw={p.draw}
            setDraw={p.setDraw}
            commit={commit}
            actions={p.actions}
            onOpenPin={p.onOpenPin}
            onManageTypes={p.onManageTypes}
            onAddSuggestedLayers={p.onAddSuggestedLayers}
          />
        ) : (
          <LayersPanel
            doc={doc}
            objs={p.objs}
            activeLayer={p.activeLayer}
            selection={p.selection}
            onActiveLayer={p.onActiveLayer}
            onSelect={p.setSelection}
            onAddLayer={() => {
              commit((d) => addLayer(d, `Layer ${d.scene.layers.length + 1}`));
            }}
            onRenameLayer={(id, name) => {
              commit((d) => updateLayer(d, id, { name }));
            }}
            onToggle={(id, flag) => {
              commit((d) =>
                updateLayer(d, id, { [flag]: !d.scene.layers.find((l) => l.id === id)?.[flag] }),
              );
            }}
            onMoveLayer={(id, direction) => {
              commit((d) => moveLayer(d, id, direction));
            }}
            onRemoveLayer={(id) => {
              commit((d) => removeLayer(d, id));
            }}
            onToggleObject={(id, flag) => {
              commit((d) => setFlag(d, new Set([id]), flag, !objectsOf(d).get(id)?.[flag]));
            }}
            onRenameObject={(id, name) => {
              commit((d) => renameObject(d, id, name));
            }}
            onMoveSelectionToLayer={(layer) => {
              commit((d) => moveToLayer(d, selected(), layer));
            }}
          />
        )}
      </div>
    </div>
  );
}
