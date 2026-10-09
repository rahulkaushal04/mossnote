/**
 * The map editor. It owns the document (through `useMapDoc`), the tools and panels around the
 * canvas, and wires together the pieces in `editor/`: preferences, viewport, actions, shortcuts
 * and the context menu. What the pointer does on the canvas itself is in `Canvas.tsx`.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ulid } from 'ulid';
import type { MapShape } from '@shared/schemas/map';
import { SUGGESTED_LAYERS } from '@shared/mapDefaults';
import type { LinkRef, MapDetail, MapPin } from '@shared/types';
import { SavedIndicator } from '../../components/ui/SavedIndicator';
import { useIsNarrow, useIsPhone } from '../../lib/useViewport';
import { useMarkerTypes } from '../settings/useMarkerTypes';
import { Canvas } from './Canvas';
import { ContextMenu, type MenuItems } from './ContextMenu';
import type { CanvasApi, Tool } from './editorTypes';
import {
  addLayer,
  firstUnlockedLayer,
  isEditable,
  objectsOf,
  removeObjects,
  selectionBox,
  setStyle,
  updatePin,
  updatePinProps,
} from './engine/doc';
import { useMapDoc } from './engine/useMapDoc';
import { toWorld } from './geometry';
import { buildMenuItems } from './editor/menuItems';
import { quickBarPosition } from './editor/layout';
import { LastMarkerRing, MarkerNameInput } from './editor/MarkerNameInput';
import { CleanupNotice, Notice } from './editor/Notices';
import { useEditorPreferences } from './editor/preferences';
import { SidePanel, type PanelTab } from './editor/SidePanel';
import { useEditorActions } from './editor/useEditorActions';
import { useEditorShortcuts } from './editor/useEditorShortcuts';
import { useMapFileActions } from './editor/useMapFileActions';
import { useViewport } from './editor/useViewport';
import { ExploreBar } from './ExploreBar';
import { MarkerTypesDialog } from './MarkerTypesDialog';
import { Minimap } from './Minimap';
import { PinSheet } from './PinSheet';
import { QuickBar } from './QuickBar';
import { Compass, StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { VersionsDialog } from './VersionsDialog';

/** How long a passing message, or the offer to keep the original drawing, stays up. */
const NOTICE_MS = 4000;
const CLEANUP_OFFER_MS = 7000;

interface CleanupOffer {
  label: string;
  id: string;
  raw: MapShape;
}

export function MapEditor({ map, focusPin = null }: { map: MapDetail; focusPin?: string | null }) {
  const client = useQueryClient();
  const narrow = useIsNarrow();
  const phone = useIsPhone();
  const markerTypes = useMarkerTypes();
  const store = useMapDoc(map);
  const { doc, docRef, commit } = store;
  const { settings, setSettings, draw, setDraw } = useEditorPreferences();

  // --- state --------------------------------------------------------------------------------------
  const [tool, setToolState] = useState<Tool>('select');
  const [selection, setSel] = useState<ReadonlySet<string>>(
    () => new Set(focusPin && map.pins.some((p) => p.id === focusPin) ? [focusPin] : []),
  );
  const [activeLayer, setActiveLayer] = useState(
    () => map.scene.layers[map.scene.layers.length - 1]?.id ?? 'layer-1',
  );
  const [panelTab, setPanelTab] = useState<PanelTab>('inspect');
  const [panelOpen, setPanelOpen] = useState(() => !narrow);
  const [fullscreen, setFullscreen] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [explore, setExplore] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [lastMarker, setLastMarker] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItems } | null>(null);
  const [pinSheet, setPinSheet] = useState<string | null>(null);
  const [pinName, setPinName] = useState<string | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupOffer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<readonly [number, number] | null>(null);
  const [editTextId, setEditTextId] = useState<string | null>(null);

  const viewport = useViewport({
    map,
    focusPin,
    docRef,
    layout: { fullscreen, panelOpen, narrow },
  });
  const { wrap, size, view, setView } = viewport;
  const files = useMapFileActions({ map, docRef, markerTypes, saveNow: store.saveNow });

  // --- derived ------------------------------------------------------------------------------------
  const objs = useMemo(() => objectsOf(doc, view.scale), [doc, view.scale]);
  const ids = useMemo(() => [...selection].filter((id) => objs.has(id)), [selection, objs]);
  const editableIds = useMemo(
    () =>
      ids.filter((id) => {
        const info = objs.get(id);
        return info ? isEditable(doc, info) : false;
      }),
    [ids, objs, doc],
  );
  const isLayerUsable = (id: string) =>
    doc.scene.layers.some((l) => l.id === id && !l.locked && !l.hidden);
  const layer = isLayerUsable(activeLayer) ? activeLayer : firstUnlockedLayer(doc);
  const editingPin = pinSheet ? (doc.pins.find((p) => p.id === pinSheet) ?? null) : null;
  const statuses = useMemo(
    () => [...new Set(doc.pins.map((p) => p.props.status).filter((s): s is string => !!s))],
    [doc.pins],
  );

  const setSelection = useCallback((next: Iterable<string>) => {
    setSel(new Set(next));
  }, []);
  const say = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => {
      setNotice((n) => (n === message ? null : n));
    }, NOTICE_MS);
  }, []);
  const setTool = useCallback((t: Tool) => {
    setToolState(t);
    if (t !== 'select') setPinName(null);
  }, []);
  /** After a drawing tool finishes: back to Select, unless the tool is kept or exploring. */
  const finishTool = useCallback(() => {
    setToolState((t) =>
      settings.keepTool || explore || t === 'draw' || t === 'pin' ? t : 'select',
    );
  }, [settings.keepTool, explore]);
  const toggleExplore = () => {
    setExplore((on) => {
      const next = !on;
      if (next) {
        setToolState('pin');
        setSettings({ smart: true });
        setPanelOpen(false);
      } else setToolState('select');
      return next;
    });
  };

  // --- actions, menu, keys ------------------------------------------------------------------------
  const { actions, pasteAt } = useEditorActions({
    mapId: map.id,
    doc,
    docRef,
    commit,
    objs,
    ids,
    editableIds,
    selection,
    setSelection,
    layer,
    layerUsable: isLayerUsable(layer),
    cursor,
    view,
    size,
    setView,
    say,
    lastMarker,
    setLastMarker,
    closePinSheet: () => {
      setPinSheet(null);
    },
    showInspector: () => {
      setPanelOpen(true);
      setPanelTab('inspect');
    },
    editText: setEditTextId,
  });

  useEditorShortcuts({
    actions,
    undo: store.undo,
    redo: store.redo,
    objs,
    ids,
    settings,
    setSettings,
    setTool,
    resetToSelect: () => {
      setSelection([]);
      setPinName(null);
      setToolState('select');
    },
    menuOpen: menu !== null,
    closeMenu: () => {
      setMenu(null);
    },
    setSpaceDown,
    openPinSheet: setPinSheet,
    editText: setEditTextId,
    setView,
    fitAll: viewport.fitAll,
    zoomIn: viewport.zoomIn,
    zoomOut: viewport.zoomOut,
    resetZoom: viewport.resetZoom,
    toggleExplore,
    toggleFullscreen: () => {
      setFullscreen((f) => !f);
    },
  });

  const menuItemsFor = (target: string | null, world: [number, number]): MenuItems =>
    buildMenuItems({
      target,
      world,
      objs,
      selectionSize: ids.length,
      actions,
      settings,
      setSettings,
      openPinSheet: setPinSheet,
      editText: setEditTextId,
      pasteAt,
      fitAll: viewport.fitAll,
    });

  // --- small operations ---------------------------------------------------------------------------
  const updateLabel = (id: string, label: string) => {
    commit((d) => updatePin(d, id, (p) => ({ ...p, label: label.trim().slice(0, 80) })), {
      coalesce: `pin:${id}`,
    });
  };
  const linkPin = (pin: MapPin, target: LinkRef | null) => {
    commit((d) => updatePin(d, pin.id, (p) => ({ ...p, target })));
    // A link shows up on the other side too, so refresh whatever might list it.
    for (const key of ['maps', 'note', 'person', 'planting']) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  };
  const addSuggestedLayers = () => {
    commit((d) => {
      let out = d;
      for (const name of SUGGESTED_LAYERS) {
        if (!out.scene.layers.some((l) => l.name === name)) out = addLayer(out, name);
      }
      return out;
    });
  };
  const offerCleanup = useCallback((info: CleanupOffer) => {
    setCleanup(info);
    setTimeout(() => {
      setCleanup((c) => (c?.id === info.id ? null : c));
    }, CLEANUP_OFFER_MS);
  }, []);
  /** Swap a tidied shape back for the stroke the person actually drew. */
  const keepOriginalDrawing = () => {
    if (!cleanup) return;
    const { id, raw } = cleanup;
    commit((d) => ({
      ...d,
      scene: {
        ...d.scene,
        shapes: d.scene.shapes.map((s) => (s.id === id ? { ...raw, id, layer: s.layer } : s)),
      },
    }));
    setCleanup(null);
  };

  // --- what the canvas needs ----------------------------------------------------------------------
  const canvasApi: CanvasApi = {
    mapId: map.id,
    doc,
    docRef,
    view,
    setView,
    size,
    tool,
    setTool,
    settings,
    draw,
    layer,
    markerTypes,
    selection,
    setSelection,
    commit,
    live: store.live,
    begin: store.begin,
    end: store.end,
    cancel: store.cancel,
    newPinId: ulid,
    onCleanup: offerCleanup,
    openPin: setPinSheet,
    onCursor: setCursor,
    notify: say,
    openMenu: (at, target) => {
      const rect = wrap.current?.getBoundingClientRect();
      const world = toWorld(view, size, at.x - (rect?.left ?? 0), at.y - (rect?.top ?? 0));
      setMenu({ at, items: menuItemsFor(target, world) });
    },
    finishTool,
    explore,
    lastMarker,
    setLastMarker,
    onPinPlaced: setPinName,
    spaceDown,
    editTextId,
    onEditStarted: () => {
      setEditTextId(null);
    },
  };

  // --- floating pieces ----------------------------------------------------------------------------
  const selectionBounds = selectionBox(objs, editableIds);
  const quickBarAt =
    selectionBounds && tool === 'select' && !explore
      ? quickBarPosition(selectionBounds, view, size)
      : null;
  const onePin =
    editableIds.length === 1 ? doc.pins.find((p) => p.id === editableIds[0]) : undefined;
  const oneShape =
    editableIds.length === 1 ? doc.scene.shapes.find((s) => s.id === editableIds[0]) : undefined;
  const quickBarColor = oneShape?.style.stroke ?? onePin?.color ?? 'ink';
  const toScreenX = (x: number) => (x - view.cx) * view.scale + size.w / 2;
  const toScreenY = (y: number) => (y - view.cy) * view.scale + size.h / 2;
  const namingPin = pinName ? doc.pins.find((p) => p.id === pinName) : undefined;
  const lastPin = explore && lastMarker ? doc.pins.find((p) => p.id === lastMarker) : undefined;

  const sidePanel = (
    <SidePanel
      tab={panelTab}
      onTab={setPanelTab}
      doc={doc}
      objs={objs}
      editableIds={editableIds}
      selection={selection}
      setSelection={setSelection}
      activeLayer={layer}
      onActiveLayer={setActiveLayer}
      draw={draw}
      setDraw={setDraw}
      commit={commit}
      actions={actions}
      onOpenPin={setPinSheet}
      onManageTypes={() => {
        setTypesOpen(true);
      }}
      onAddSuggestedLayers={addSuggestedLayers}
    />
  );

  // On a phone the shell's bars are hidden on this screen (see Shell), so the canvas takes what
  // is left under the name row and the toolbar rows. From 640px the editor is one grid: the
  // controls across the top, the tools in a strip on the left, then the canvas and the panel.
  const canvasHeight = fullscreen
    ? 'min-h-0 flex-1'
    : phone
      ? toolsCollapsed
        ? 'h-[calc(100dvh-7.75rem)] min-h-[300px]'
        : 'h-[calc(100dvh-11rem)] min-h-[300px]'
      : '';
  const gridHeight = fullscreen
    ? ''
    : 'phone:h-[calc(100dvh-9rem)] phone:min-h-[min(28rem,calc(100dvh-5rem))]';

  return (
    <div
      className={`map-grid relative flex flex-col gap-2 phone:grid ${fullscreen ? 'fixed inset-0 z-40 bg-paper p-3' : ''} ${gridHeight}`}
    >
      <Toolbar
        tool={tool}
        onTool={setTool}
        settings={settings}
        onSettings={setSettings}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        onUndo={store.undo}
        onRedo={store.redo}
        onZoom={viewport.zoomBy}
        onFit={viewport.fitAll}
        panelOpen={panelOpen}
        onPanel={() => {
          setPanelOpen((o) => !o);
        }}
        explore={explore}
        onExplore={toggleExplore}
        fullscreen={fullscreen}
        onFullscreen={() => {
          setFullscreen((f) => !f);
        }}
        onHistory={() => {
          setVersionsOpen(true);
        }}
        onDuplicateMap={() => void files.duplicate()}
        onExport={(kind) => void files.exportAs(kind)}
        exporting={files.exporting}
        onMarkerTypes={() => {
          setTypesOpen(true);
        }}
        collapsed={toolsCollapsed}
        onCollapsed={setToolsCollapsed}
      />
      <div className={`flex gap-2 phone:contents ${canvasHeight}`}>
        <div
          ref={wrap}
          className={`relative min-w-0 flex-1 overflow-hidden rounded-lg border border-hairline phone:[grid-area:canvas]`}
        >
          {size.w > 0 ? <Canvas ed={canvasApi} /> : null}
          {settings.compass ? <Compass /> : null}
          {settings.minimap ? (
            <div
              className="absolute right-2 bottom-9 z-10 hidden wide:block"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              <Minimap
                doc={doc}
                objs={objs}
                view={view}
                size={size}
                onGo={(cx, cy) => {
                  setView((v) => ({ ...v, cx, cy }));
                }}
              />
            </div>
          ) : null}
          {quickBarAt && editableIds.length > 0 ? (
            <QuickBar
              at={quickBarAt}
              color={quickBarColor}
              actions={actions}
              single={editableIds.length === 1}
              isPin={onePin !== undefined}
              onColor={(color) => {
                commit((d) => setStyle(d, new Set(editableIds), { stroke: color }), {
                  coalesce: 'style',
                });
                setDraw({ stroke: color });
              }}
              onDetails={() => {
                if (onePin) setPinSheet(onePin.id);
              }}
            />
          ) : null}
          {cleanup ? (
            <CleanupNotice
              label={cleanup.label}
              onKeepOriginal={keepOriginalDrawing}
              onDismiss={() => {
                setCleanup(null);
              }}
            />
          ) : null}
          {notice ? <Notice message={notice} /> : null}
          {lastPin ? (
            <LastMarkerRing
              at={{ x: toScreenX(lastPin.x), y: toScreenY(lastPin.y) }}
              width={size.w}
              height={size.h}
            />
          ) : null}
          {namingPin ? (
            <MarkerNameInput
              at={{ x: toScreenX(namingPin.x), y: toScreenY(namingPin.y) }}
              label={namingPin.label}
              onSave={(name) => {
                updateLabel(namingPin.id, name);
              }}
              onClose={() => {
                setPinName(null);
              }}
            />
          ) : null}
          {explore ? (
            <ExploreBar
              tool={tool}
              onTool={setTool}
              onDone={toggleExplore}
              onUndo={store.undo}
              canUndo={store.canUndo}
              hasMarker={lastPin !== undefined}
            />
          ) : null}
          <StatusBar
            cursor={cursor}
            zoom={view.scale}
            unit={doc.scene.scale}
            settings={settings}
            onChange={setSettings}
            onZoomReset={viewport.resetZoom}
            saved={
              store.saveState === 'error' ? (
                <span role="alert" className="text-danger">
                  {store.saveError ?? "Couldn't save."}{' '}
                  <button type="button" className="underline" onClick={() => void store.saveNow()}>
                    Retry
                  </button>
                </span>
              ) : (
                <SavedIndicator show={store.saveState === 'saved'} />
              )
            }
          />
          {panelOpen && narrow ? (
            <div
              className="absolute inset-x-0 bottom-0 z-30 max-h-[60%] overflow-y-auto rounded-t-lg border-t border-hairline bg-raised p-3 shadow-2"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              <div
                aria-hidden="true"
                className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-control"
              />
              {sidePanel}
            </div>
          ) : null}
        </div>
        {panelOpen && !narrow ? (
          <aside
            aria-label="Map details"
            className="flex min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-raised p-3 shadow-1 phone:ml-2 phone:[grid-area:panel]"
          >
            {sidePanel}
          </aside>
        ) : null}
      </div>

      {menu ? (
        <ContextMenu
          at={menu.at}
          items={menu.items}
          onClose={() => {
            setMenu(null);
          }}
        />
      ) : null}
      <PinSheet
        pin={editingPin}
        layers={doc.scene.layers}
        markerTypes={markerTypes}
        statuses={statuses}
        open={pinSheet !== null}
        onClose={() => {
          setPinSheet(null);
        }}
        onChange={(id, patch) => {
          commit((d) => updatePin(d, id, (p) => ({ ...p, ...patch })), { coalesce: `pin:${id}` });
        }}
        onProps={(id, patch) => {
          commit((d) => updatePinProps(d, id, patch), { coalesce: `props:${id}` });
        }}
        onDelete={(id) => {
          commit((d) => removeObjects(d, new Set([id])));
          setSelection([]);
        }}
        onLink={linkPin}
        onManageTypes={() => {
          setTypesOpen(true);
        }}
      />
      <MarkerTypesDialog
        open={typesOpen}
        onClose={() => {
          setTypesOpen(false);
        }}
      />
      <VersionsDialog
        mapId={map.id}
        open={versionsOpen}
        onClose={() => {
          setVersionsOpen(false);
        }}
        beforeOpen={store.saveNow}
        onRestored={(restored) => {
          store.replace(restored);
          setSelection([]);
          viewport.clearOverride();
        }}
      />
    </div>
  );
}
