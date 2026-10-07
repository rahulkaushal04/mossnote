/** What the inspector shows with nothing selected: defaults for new drawings, scale, layers. */
import { useState } from 'react';
import { SUGGESTED_LAYERS } from '@shared/mapDefaults';
import { StylePresets } from '../StylePresets';
import type { Doc } from '../engine/doc';
import type { DrawStyle } from '../editorTypes';
import { BUTTON_CLASS, FIELD_CLASS, Section } from './parts';
import { StyleControls } from './StyleControls';

interface DrawingDefaultsProps {
  doc: Doc;
  draw: DrawStyle;
  setDraw: (patch: Partial<DrawStyle>) => void;
  commit: (fn: (d: Doc) => Doc) => void;
  onManageTypes: () => void;
  onAddSuggestedLayers: () => void;
}

const MAX_UNIT_NAME = 12;

export function DrawingDefaults({
  doc,
  draw,
  setDraw,
  commit,
  onManageTypes,
  onAddSuggestedLayers,
}: DrawingDefaultsProps) {
  const scale = doc.scene.scale;
  const [unit, setUnit] = useState(scale?.unit ?? '');
  const [size, setSize] = useState(scale ? String(scale.size) : '');

  /** Save the scale when both fields are valid; clear it when both are empty; otherwise wait. */
  const saveScale = () => {
    const cellSize = Number(size);
    const unitName = unit.trim();
    const isValid = unitName !== '' && Number.isFinite(cellSize) && cellSize > 0;
    if (isValid) {
      commit((d) => ({
        ...d,
        scene: { ...d.scene, scale: { unit: unitName.slice(0, MAX_UNIT_NAME), size: cellSize } },
      }));
    } else if (unitName === '' && size === '') {
      commit((d) => ({ ...d, scene: { ...d.scene, scale: undefined } }));
    }
  };

  const hasSuggestedLayers = SUGGESTED_LAYERS.every((name) =>
    doc.scene.layers.some((layer) => layer.name === name),
  );

  return (
    <div className="flex flex-col gap-4">
      <Section title="New drawings">
        <StyleControls style={draw} onChange={setDraw} />
        <StylePresets current={draw} onApply={setDraw} />
      </Section>
      <Section title="Measuring">
        <p className="m-0 text-sm text-ink-muted">
          Say how big one grid square is, so the Measure tool can use your units.
        </p>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Units per grid cell</span>
            <input
              inputMode="decimal"
              value={size}
              onChange={(e) => {
                setSize(e.target.value);
              }}
              onBlur={saveScale}
              placeholder="20"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Unit name</span>
            <input
              value={unit}
              maxLength={MAX_UNIT_NAME}
              onChange={(e) => {
                setUnit(e.target.value);
              }}
              onBlur={saveScale}
              placeholder="steps"
              className={FIELD_CLASS}
            />
          </label>
        </div>
      </Section>
      <Section title="Layers and markers">
        {!hasSuggestedLayers ? (
          <button
            type="button"
            className={`${BUTTON_CLASS} self-start`}
            onClick={onAddSuggestedLayers}
          >
            Add suggested layers
          </button>
        ) : null}
        <button type="button" className={`${BUTTON_CLASS} self-start`} onClick={onManageTypes}>
          Marker types…
        </button>
      </Section>
    </div>
  );
}
