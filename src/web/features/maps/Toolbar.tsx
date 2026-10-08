/**
 * The editor toolbar: tools, undo and redo, zoom, view, panel, full screen, history, export.
 * Buttons are icons; the names show beside them from 900px up. On a phone the rows can be hidden
 * to give the canvas the whole screen, leaving Undo and Redo within reach.
 */
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cx } from '../../lib/cx';
import { modLabel } from '../../lib/hotkeys';
import { useIsPhone } from '../../lib/useViewport';
import {
  ArrowIcon,
  BoxIcon,
  ChevronUpIcon,
  CircleIcon,
  ClockIcon,
  ConnectIcon,
  DownloadIcon,
  EllipsisIcon,
  ExploreIcon,
  FitIcon,
  HandIcon,
  LineIcon,
  MeasureIcon,
  NoteIcon,
  PanelIcon,
  PenIcon,
  PinIcon,
  PolygonIcon,
  RedoIcon,
  SelectIcon,
  TextIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../../components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu';
import { TOOLS, type EditorSettings, type Tool } from './editorTypes';
import { ViewMenu } from './ViewMenu';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const TOOL_ICONS: Record<Tool, Icon> = {
  select: SelectIcon,
  hand: HandIcon,
  draw: PenIcon,
  line: LineIcon,
  arrow: ArrowIcon,
  rect: BoxIcon,
  ellipse: CircleIcon,
  polygon: PolygonIcon,
  connector: ConnectIcon,
  text: TextIcon,
  note: NoteIcon,
  pin: PinIcon,
  measure: MeasureIcon,
};

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
  /** On a phone, hide the tool rows to give the canvas more room. Ignored from 640px up. */
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}

/** A toolbar button: an icon, with its name beside it on wide screens and for screen readers. */
function Btn({
  icon: Icon,
  label,
  className,
  ...rest
}: {
  icon: Icon;
  label: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  'aria-pressed'?: boolean;
  'aria-keyshortcuts'?: string;
}) {
  return (
    <button type="button" {...rest} className={cx('btn btn-icon shrink-0 wide:px-3', className)}>
      <Icon className="size-5" />
      <span className="sr-only wide:not-sr-only">{label}</span>
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;

export function Toolbar(p: ToolbarProps) {
  const mod = modLabel();
  const phone = useIsPhone();
  const hidden = phone && p.collapsed;
  const row =
    'scroll-row -mx-4 flex items-center gap-1 overflow-x-auto px-4 pb-1 phone:mx-0 phone:flex-wrap phone:overflow-visible phone:px-0';

  const extras: ReactNode = (
    <>
      <Divider />
      <Btn
        icon={ZoomOutIcon}
        label="Zoom out"
        title="Zoom out (-)"
        onClick={() => {
          p.onZoom(0.8);
        }}
      />
      <Btn
        icon={ZoomInIcon}
        label="Zoom in"
        title="Zoom in (+)"
        onClick={() => {
          p.onZoom(1.25);
        }}
      />
      <Btn icon={FitIcon} label="Fit" title="Fit the whole map (Shift+1)" onClick={p.onFit} />
      <Divider />
      <Btn
        icon={ExploreIcon}
        label="Explore"
        aria-pressed={p.explore}
        className={p.explore ? 'btn-primary' : ''}
        title="Exploring mode (E): marker, path, note, repeat"
        onClick={p.onExplore}
      />
      <ViewMenu settings={p.settings} onChange={p.onSettings} />
      <Btn
        icon={PanelIcon}
        label="Panel"
        aria-pressed={p.panelOpen}
        title="Show or hide the side panel"
        onClick={p.onPanel}
      />
      <Divider />
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="btn btn-icon shrink-0 wide:px-3" disabled={p.exporting}>
            <DownloadIcon className="size-5" />
            <span className="sr-only wide:not-sr-only">
              {p.exporting ? 'Exporting…' : 'Export'}
            </span>
          </button>
        </MenuTrigger>
        <MenuContent className="min-w-52">
          <MenuItem
            onSelect={() => {
              p.onExport('png');
            }}
          >
            Picture (PNG)
          </MenuItem>
          <MenuItem
            onSelect={() => {
              p.onExport('svg');
            }}
          >
            Vector drawing (SVG)
          </MenuItem>
          <MenuItem
            onSelect={() => {
              p.onExport('pdf');
            }}
          >
            Document (PDF)
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              p.onExport('json');
            }}
          >
            Editable project file
          </MenuItem>
        </MenuContent>
      </Menu>
      <Btn icon={ClockIcon} label="History" onClick={p.onHistory} />
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="btn btn-icon shrink-0" aria-label="More map actions">
            <EllipsisIcon className="size-5" />
          </button>
        </MenuTrigger>
        <MenuContent className="min-w-52">
          <MenuItem onSelect={p.onDuplicateMap}>Duplicate this map</MenuItem>
          <MenuItem onSelect={p.onMarkerTypes}>Marker types…</MenuItem>
          <MenuItem onSelect={p.onFullscreen}>
            {p.fullscreen ? 'Leave full screen' : 'Full screen'}
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  );

  return (
    <div className="flex flex-col gap-1">
      {hidden ? null : (
        <div role="toolbar" aria-label="Map tools" className={row}>
          {TOOLS.map((t) => (
            <Btn
              key={t.id}
              icon={TOOL_ICONS[t.id]}
              label={t.label}
              aria-pressed={p.tool === t.id}
              aria-keyshortcuts={t.key}
              title={`${t.hint} (${t.key})`}
              className={p.tool === t.id ? 'btn-primary' : ''}
              onClick={() => {
                p.onTool(t.id);
              }}
            />
          ))}
        </div>
      )}
      <div role="toolbar" aria-label="Map controls" className={row}>
        {phone ? (
          <Btn
            icon={ChevronUpIcon}
            label={p.collapsed ? 'Show tools' : 'Hide tools'}
            aria-pressed={undefined}
            className={p.collapsed ? '[&_svg]:rotate-180' : ''}
            onClick={() => {
              p.onCollapsed(!p.collapsed);
            }}
          />
        ) : null}
        <Btn
          icon={UndoIcon}
          label="Undo"
          disabled={!p.canUndo}
          title={`Undo (${mod}Z)`}
          onClick={p.onUndo}
        />
        <Btn
          icon={RedoIcon}
          label="Redo"
          disabled={!p.canRedo}
          title={`Redo (${mod}⇧Z)`}
          onClick={p.onRedo}
        />
        {hidden ? null : extras}
      </div>
    </div>
  );
}
