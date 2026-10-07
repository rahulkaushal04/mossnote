/**
 * The editor toolbar: tools, undo and redo, zoom, view, panel, full screen, history, export.
 */
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { modLabel } from '../../lib/hotkeys';
import { TOOLS, type EditorSettings, type Tool } from './editorTypes';
import { ViewMenu } from './ViewMenu';

const BTN = 'btn tap shrink-0 text-sm';
const MENU_ITEM =
  'tap flex cursor-pointer items-center gap-2 rounded-control px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-surface';

export interface ToolbarProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  settings: EditorSettings;
  onSettings: (p: Partial<EditorSettings>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  panelOpen: boolean;
  onPanel: () => void;
  explore: boolean;
  onExplore: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  onHistory: () => void;
  onDuplicateMap: () => void;
  onExport: (kind: 'png' | 'svg' | 'pdf' | 'json') => void;
  exporting: boolean;
  onMarkerTypes: () => void;
}

/** Tools on the first row, everything else on the second. Both scroll sideways on a phone. */
export function Toolbar(p: ToolbarProps) {
  const mod = modLabel();
  return (
    <div className="flex flex-col gap-1">
      <div
        role="toolbar"
        aria-label="Map tools"
        className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 pb-1 wide:mx-0 wide:flex-wrap wide:overflow-visible wide:px-0"
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={p.tool === t.id}
            aria-keyshortcuts={t.key}
            title={`${t.hint} (${t.key})`}
            onClick={() => {
              p.onTool(t.id);
            }}
            className={`${BTN} ${p.tool === t.id ? 'btn-primary' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="toolbar"
        aria-label="Map controls"
        className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 pb-1 wide:mx-0 wide:flex-wrap wide:overflow-visible wide:px-0"
      >
        <button
          type="button"
          className={BTN}
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title={`Undo (${mod}Z)`}
        >
          Undo
        </button>
        <button
          type="button"
          className={BTN}
          onClick={p.onRedo}
          disabled={!p.canRedo}
          title={`Redo (${mod}⇧Z)`}
        >
          Redo
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden="true" />
        <button
          type="button"
          aria-label="Zoom out"
          className={BTN}
          onClick={() => {
            p.onZoom(0.8);
          }}
          title="Zoom out (-)"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          className={BTN}
          onClick={() => {
            p.onZoom(1.25);
          }}
          title="Zoom in (+)"
        >
          +
        </button>
        <button type="button" className={BTN} onClick={p.onFit} title="Fit the whole map (Shift+1)">
          Fit
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={p.explore}
          className={`${BTN} ${p.explore ? 'btn-primary' : ''}`}
          onClick={p.onExplore}
          title="Exploring mode (E): marker, path, note, repeat"
        >
          Explore
        </button>
        <ViewMenu settings={p.settings} onChange={p.onSettings} />
        <button
          type="button"
          aria-pressed={p.panelOpen}
          className={BTN}
          onClick={p.onPanel}
          title="Show or hide the side panel"
        >
          Panel
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden="true" />
        <RadixMenu.Root>
          <RadixMenu.Trigger asChild>
            <button type="button" className={BTN} disabled={p.exporting}>
              {p.exporting ? 'Exporting…' : 'Export'}
            </button>
          </RadixMenu.Trigger>
          <RadixMenu.Portal>
            <RadixMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-52 rounded-panel border border-rule bg-raised p-1 text-ink shadow-float"
            >
              <RadixMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  p.onExport('png');
                }}
              >
                Picture (PNG)
              </RadixMenu.Item>
              <RadixMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  p.onExport('svg');
                }}
              >
                Vector drawing (SVG)
              </RadixMenu.Item>
              <RadixMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  p.onExport('pdf');
                }}
              >
                Document (PDF)
              </RadixMenu.Item>
              <RadixMenu.Separator className="my-1 h-px bg-rule" />
              <RadixMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  p.onExport('json');
                }}
              >
                Editable project file
              </RadixMenu.Item>
            </RadixMenu.Content>
          </RadixMenu.Portal>
        </RadixMenu.Root>
        <button type="button" className={BTN} onClick={p.onHistory}>
          History
        </button>
        <RadixMenu.Root>
          <RadixMenu.Trigger asChild>
            <button type="button" className={BTN} aria-label="More map actions">
              More
            </button>
          </RadixMenu.Trigger>
          <RadixMenu.Portal>
            <RadixMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-52 rounded-panel border border-rule bg-raised p-1 text-ink shadow-float"
            >
              <RadixMenu.Item className={MENU_ITEM} onSelect={p.onDuplicateMap}>
                Duplicate this map
              </RadixMenu.Item>
              <RadixMenu.Item className={MENU_ITEM} onSelect={p.onMarkerTypes}>
                Marker types…
              </RadixMenu.Item>
              <RadixMenu.Item className={MENU_ITEM} onSelect={p.onFullscreen}>
                {p.fullscreen ? 'Leave full screen' : 'Full screen'}
              </RadixMenu.Item>
            </RadixMenu.Content>
          </RadixMenu.Portal>
        </RadixMenu.Root>
      </div>
    </div>
  );
}
