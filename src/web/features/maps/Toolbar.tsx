/**
 * The editor toolbar: tools, undo and redo, zoom, view, panel, full screen, history, export.
 * Buttons are icons; the names show beside them from 900px up. On a phone the rows can be hidden
 * to give the canvas the whole screen, leaving Undo and Redo within reach.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { cx } from '../../lib/cx';
import { modLabel } from '../../lib/hotkeys';
import { useLongPress } from '../../lib/useLongPress';
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

/** Shows a button's name when a finger rests on it, since touch has no hover. */
const HintContext = createContext<(label: string) => void>(() => undefined);

/** A toolbar button: an icon, with its name beside it on wide screens and for screen readers. */
function Btn({
  icon: Icon,
  label,
  className,
  iconOnly = false,
  ...rest
}: {
  icon: Icon;
  label: string;
  className?: string;
  /** Never show the name beside the icon (the tool strip: names are tooltips and screen-reader text). */
  iconOnly?: boolean;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  'aria-pressed'?: boolean;
  'aria-keyshortcuts'?: string;
}) {
  const hint = useContext(HintContext);
  const press = useLongPress(() => {
    hint(label);
  });
  return (
    <button
      type="button"
      {...rest}
      {...press}
      className={cx('btn btn-ghost btn-icon shrink-0', !iconOnly && 'wide:px-3', className)}
    >
      <Icon className="size-5" />
      <span className={iconOnly ? 'sr-only' : 'sr-only wide:not-sr-only'}>{label}</span>
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />;

export function Toolbar(p: ToolbarProps) {
  const mod = modLabel();
  const phone = useIsPhone();
  const hidden = phone && p.collapsed;
  // From 640px the toolbar is two cells of the editor's grid (see MapEditor): the controls above
  // the canvas, and the tools in a vertical strip beside it. On a phone both stay as scrolling rows.
  const panelBox =
    'phone:rounded-lg phone:border phone:border-hairline phone:bg-raised phone:p-1 phone:shadow-1';
  const controlsRow = cx(
    'scroll-row flex items-center gap-1 overflow-x-auto phone:flex-wrap phone:overflow-visible phone:[grid-area:controls]',
    panelBox,
  );
  const toolsRow = cx(
    'scroll-row flex items-center gap-1 overflow-x-auto phone:min-h-0 phone:flex-col phone:flex-nowrap phone:overflow-x-visible phone:overflow-y-auto phone:mr-2 phone:[grid-area:tools] phone:self-start phone:max-h-full',
    panelBox,
  );

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
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0 wide:px-3"
            disabled={p.exporting}
          >
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
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0"
            aria-label="More map actions"
          >
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

  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (hint === null) return;
    const timer = setTimeout(() => {
      setHint(null);
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [hint]);

  return (
    <HintContext value={setHint}>
      <div className="relative flex flex-col gap-1 rounded-lg border border-hairline bg-raised p-1 shadow-1 phone:contents">
        {hint ? (
          <p
            aria-hidden="true"
            data-testid="toolbar-hint"
            className="absolute top-full left-1/2 z-20 mt-1 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-sm whitespace-nowrap text-paper"
          >
            {hint}
          </p>
        ) : null}
        {hidden ? null : (
          <div
            role="toolbar"
            aria-label="Map tools"
            aria-orientation={phone ? 'horizontal' : 'vertical'}
            className={toolsRow}
          >
            {TOOLS.map((t) => (
              <Btn
                key={t.id}
                iconOnly
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
        <div role="toolbar" aria-label="Map controls" className={controlsRow}>
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
    </HintContext>
  );
}
