/** Previews of what is being drawn, inside the map's coordinate space. */
import { useMemo } from 'react';
import type { MapMarkerType } from '@shared/schemas/map';
import type { DrawStyle } from '../editorTypes';
import { objectsOf, type Doc } from '../engine/doc';
import { SceneView } from '../render/SceneView';
import { cssColor } from '../render/colors';
import type { Draft } from './types';

interface DraftLayerProps {
  draft: Draft | null;
  doc: Doc;
  scale: number;
  draw: DrawStyle;
  markerTypes: readonly MapMarkerType[];
}

export function DraftLayer({ draft, doc, scale, draw, markerTypes }: DraftLayerProps) {
  const draftShape = draft?.k === 'shape' ? draft.shape : null;
  const shapeDoc: Doc | null = useMemo(
    () => (draftShape ? { scene: { ...doc.scene, shapes: [draftShape] }, pins: [] } : null),
    [draftShape, doc.scene],
  );
  const shapeObjs = useMemo(
    () =>
      draftShape
        ? objectsOf({ scene: { ...doc.scene, shapes: [draftShape] }, pins: doc.pins }, scale)
        : null,
    [draftShape, doc.scene, doc.pins, scale],
  );

  return (
    <>
      {draft?.k === 'stroke' ? (
        <polyline
          points={draft.pts.map((q) => q.join(',')).join(' ')}
          fill="none"
          stroke={cssColor(draw.stroke)}
          strokeWidth={draw.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
          pointerEvents="none"
        />
      ) : null}
      {shapeDoc && shapeObjs ? (
        <g opacity={0.8} pointerEvents="none">
          <SceneView
            doc={shapeDoc}
            objs={shapeObjs}
            scale={scale}
            markerTypes={markerTypes}
            pins={false}
          />
        </g>
      ) : null}
      {draft?.k === 'poly' ? (
        <g pointerEvents="none">
          <polyline
            points={[...draft.pts, ...(draft.cursor ? [draft.cursor] : [])]
              .map((q) => q.join(','))
              .join(' ')}
            fill={draw.fill ? cssColor(draw.fill) : 'none'}
            fillOpacity={0.15}
            stroke={cssColor(draw.stroke)}
            strokeWidth={draw.width}
            strokeDasharray="6 4"
          />
          {draft.pts.map((q, i) => (
            <circle
              key={i}
              cx={q[0]}
              cy={q[1]}
              r={4 / scale}
              fill="var(--raised)"
              stroke="var(--accent)"
              strokeWidth={1.5 / scale}
            />
          ))}
        </g>
      ) : null}
    </>
  );
}
