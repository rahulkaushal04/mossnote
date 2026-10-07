import type { MapStyle } from '@shared/schemas/map';
import { ColorPicker } from '../ColorPicker';
import type { DrawStyle } from '../editorTypes';
import { BUTTON_CLASS, ChoiceGroup, Row } from './parts';

const WIDTHS = [1, 2, 3, 5, 8, 14];
const DASHES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
] as const satisfies readonly { value: MapStyle['dash']; label: string }[];

interface StyleControlsProps {
  style: DrawStyle | MapStyle;
  onChange: (patch: Partial<MapStyle>) => void;
  showFill?: boolean;
  showStroke?: boolean;
}

/** Colour, fill, width and dash controls, for the drawing defaults and for a selection alike. */
export function StyleControls({
  style,
  onChange,
  showFill = true,
  showStroke = true,
}: StyleControlsProps) {
  return (
    <>
      {showStroke ? (
        <Row label="Line colour">
          <ColorPicker
            value={style.stroke}
            label="Line colour"
            onPick={(color) => {
              if (color) onChange({ stroke: color });
            }}
          />
        </Row>
      ) : null}
      {showFill ? (
        <Row label="Fill">
          <ColorPicker
            value={style.fill}
            label="Fill colour"
            allowNone
            onPick={(color) => {
              onChange({ fill: color });
            }}
          />
        </Row>
      ) : null}
      <Row label="Line width">
        <div role="group" aria-label="Line width" className="flex flex-wrap gap-1">
          {WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              aria-pressed={Math.round(style.width) === width}
              className={`${BUTTON_CLASS} min-w-9`}
              onClick={() => {
                onChange({ width });
              }}
            >
              {width}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Line style">
        <ChoiceGroup
          label="Line style"
          options={DASHES}
          value={style.dash}
          onChange={(dash) => {
            onChange({ dash });
          }}
        />
      </Row>
    </>
  );
}
