/**
 * The View menu: display options (grid, rulers, overview map, names, compass) and drawing options
 * (tidy rough shapes, keep the tool, snapping).
 */
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { EditorSettings } from './editorTypes';

const ITEM =
  'tap flex cursor-pointer items-center gap-2 rounded-control px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-surface';

function Check({
  label,
  checked,
  onChange,
  keys,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  keys?: string;
}) {
  return (
    <RadixMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      onSelect={(e) => {
        e.preventDefault();
      }}
      className={ITEM}
    >
      <span aria-hidden="true" className="inline-block w-4">
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1">{label}</span>
      {keys ? <span className="text-xs text-ink-muted">{keys}</span> : null}
    </RadixMenu.CheckboxItem>
  );
}

/** What the canvas shows and how it behaves: grid, rulers, snapping, smart clean-up. */
export function ViewMenu({
  settings,
  onChange,
}: {
  settings: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
}) {
  const snaps = (p: Partial<EditorSettings['snaps']>) => {
    onChange({ snaps: { ...settings.snaps, ...p } });
  };
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <button type="button" className="btn tap shrink-0 text-sm">
          View
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="z-50 min-w-56 rounded-panel border border-rule bg-raised p-1 text-ink shadow-float"
        >
          <RadixMenu.Label className="px-3 py-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Show
          </RadixMenu.Label>
          <Check
            label="Grid"
            keys="Shift+G"
            checked={settings.grid}
            onChange={(v) => {
              onChange({ grid: v });
            }}
          />
          <Check
            label="Rulers and guides"
            keys="Shift+R"
            checked={settings.rulers}
            onChange={(v) => {
              onChange({ rulers: v });
            }}
          />
          <Check
            label="Overview map"
            checked={settings.minimap}
            onChange={(v) => {
              onChange({ minimap: v });
            }}
          />
          <Check
            label="Marker names"
            checked={settings.names}
            onChange={(v) => {
              onChange({ names: v });
            }}
          />
          <Check
            label="Compass"
            checked={settings.compass}
            onChange={(v) => {
              onChange({ compass: v });
            }}
          />
          <RadixMenu.Separator className="my-1 h-px bg-rule" />
          <RadixMenu.Label className="px-3 py-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Drawing
          </RadixMenu.Label>
          <Check
            label="Tidy up rough shapes"
            checked={settings.smart}
            onChange={(v) => {
              onChange({ smart: v });
            }}
          />
          <Check
            label="Keep the tool after drawing"
            checked={settings.keepTool}
            onChange={(v) => {
              onChange({ keepTool: v });
            }}
          />
          <RadixMenu.Separator className="my-1 h-px bg-rule" />
          <RadixMenu.Label className="px-3 py-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Snapping (hold Alt to pause)
          </RadixMenu.Label>
          <Check
            label="Snapping on"
            keys="Shift+S"
            checked={settings.snap}
            onChange={(v) => {
              onChange({ snap: v });
            }}
          />
          <Check
            label="To other objects"
            checked={settings.snaps.objects}
            onChange={(v) => {
              snaps({ objects: v });
            }}
          />
          <Check
            label="Line up with others"
            checked={settings.snaps.align}
            onChange={(v) => {
              snaps({ align: v });
            }}
          />
          <Check
            label="To the grid"
            checked={settings.snaps.grid}
            onChange={(v) => {
              snaps({ grid: v });
            }}
          />
          <Check
            label="Angles (every 15°)"
            checked={settings.snaps.angle}
            onChange={(v) => {
              snaps({ angle: v });
            }}
          />
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
