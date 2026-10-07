/**
 * Draws a map document as SVG. The same component renders the canvas and, with fixed colours, the
 * SVG, PNG and PDF exports.
 */
import { memo, useMemo } from 'react';
import type { MapMarkerType } from '@shared/schemas/map';
import type { MapPin } from '@shared/types';
import { isVisible, type Doc } from '../engine/doc';
import {
  connectorGeometry,
  placedShape,
  polylineD,
  smoothPathD,
  textLayout,
  type ObjInfo,
  type Objects,
} from '../engine/shapes';
import { angleOf, deg, type MPt } from '../engine/vec';
import { cssColor, dashArray, pinLook, textOnFill, type ColorFn } from './colors';
import { placeLabels } from './labels';
import { MarkerGlyph } from './MarkerGlyph';

export interface SceneViewProps {
  doc: Doc;
  objs: Objects;
  colorOf?: ColorFn | undefined;
  /** The page background and text colour, for halos and cards. */
  paper?: string | undefined;
  ink?: string | undefined;
  /** Screen pixels per world unit. */
  scale: number;
  /** Screen position of a world point, for placing pin names. */
  toScreen?: ((x: number, y: number) => MPt) | undefined;
  markerTypes: readonly MapMarkerType[];
  /** Show pin names. */
  labels?: boolean | undefined;
  /** Pins can be left out of an export of the drawing alone. */
  pins?: boolean | undefined;
}

const FILL_ALPHA = 0.2;

function Arrowhead({
  at,
  angle,
  color,
  size,
  width,
}: {
  at: MPt;
  angle: number;
  color: string;
  size: number;
  width: number;
}) {
  const a = (angle * Math.PI) / 180;
  const p1: MPt = [at[0] - size * Math.cos(a - 0.45), at[1] - size * Math.sin(a - 0.45)];
  const p2: MPt = [at[0] - size * Math.cos(a + 0.45), at[1] - size * Math.sin(a + 0.45)];
  return (
    <polyline
      points={`${p1[0]},${p1[1]} ${at[0]},${at[1]} ${p2[0]},${p2[1]}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

interface ShapeProps {
  info: ObjInfo;
  objs: Objects;
  colorOf: ColorFn;
  paper: string;
  ink: string;
  scale: number;
}

/** One drawn object. `data-oid` lets the editor find what was clicked. */
const ShapeView = memo(function ShapeView({ info, objs, colorOf, paper, ink, scale }: ShapeProps) {
  const shape = placedShape(info)!;
  const { style } = shape;
  const stroke = colorOf(style.stroke);
  const fill = style.fill ? colorOf(style.fill) : 'none';
  const hit = Math.max(14 / scale, style.width);
  const dash = dashArray(style);
  const common = { 'data-oid': shape.id, 'data-kind': shape.t } as const;
  const strokeProps = {
    stroke,
    strokeWidth: style.width,
    strokeDasharray: dash,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (shape.t) {
    case 'path': {
      const d = shape.smooth
        ? smoothPathD(shape.pts, shape.closed ?? false)
        : polylineD(shape.pts, shape.closed ?? false);
      return (
        <g {...common}>
          <path
            d={d}
            fill={shape.closed ? fill : 'none'}
            fillOpacity={FILL_ALPHA}
            {...strokeProps}
          />
          <path d={d} fill="none" stroke="transparent" strokeWidth={hit} data-hit />
        </g>
      );
    }
    case 'polygon': {
      const d = polylineD(shape.pts, true);
      return (
        <g {...common}>
          <path d={d} fill={fill} fillOpacity={FILL_ALPHA} {...strokeProps} />
          <path d={d} fill="transparent" stroke="transparent" strokeWidth={hit} data-hit />
        </g>
      );
    }
    case 'rect': {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      return (
        <rect
          {...common}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.r ?? 0}
          transform={shape.rot ? `rotate(${shape.rot} ${cx} ${cy})` : undefined}
          fill={fill === 'none' ? 'transparent' : fill}
          fillOpacity={fill === 'none' ? 1 : FILL_ALPHA}
          {...strokeProps}
        />
      );
    }
    case 'ellipse':
      return (
        <ellipse
          {...common}
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          transform={shape.rot ? `rotate(${shape.rot} ${shape.cx} ${shape.cy})` : undefined}
          fill={fill === 'none' ? 'transparent' : fill}
          fillOpacity={fill === 'none' ? 1 : FILL_ALPHA}
          {...strokeProps}
        />
      );
    case 'connector': {
      const g = connectorGeometry(shape, objs);
      const head = Math.max(11, style.width * 4);
      return (
        <g {...common}>
          <path d={g.d} fill="none" {...strokeProps} />
          {shape.head !== 'none' ? (
            <Arrowhead
              at={g.end.pt}
              angle={deg(g.end.angle)}
              color={stroke}
              size={head}
              width={style.width}
            />
          ) : null}
          {shape.head === 'both' ? (
            <Arrowhead
              at={g.start.pt}
              angle={deg(g.start.angle)}
              color={stroke}
              size={head}
              width={style.width}
            />
          ) : null}
          <path d={g.d} fill="none" stroke="transparent" strokeWidth={hit} data-hit />
        </g>
      );
    }
    case 'text': {
      const l = textLayout(shape);
      const boxed = shape.kind !== 'plain';
      const c = info.center;
      const textFill = boxed
        ? textOnFill(shape.kind === 'sticky' ? (style.fill ?? 'amber') : style.fill, paper, ink)
        : stroke;
      const boxFill =
        shape.kind === 'sticky'
          ? colorOf(style.fill ?? 'amber')
          : style.fill
            ? colorOf(style.fill)
            : paper;
      const target = shape.anchor ? objs.get(shape.anchor.ref) : undefined;
      let tail: string | null = null;
      if (shape.kind === 'callout') {
        // A small tail from the edge of the card towards the anchored object (or down-left when free).
        const from: MPt = [shape.x + l.boxW / 2, shape.y + l.boxH / 2];
        const tip: MPt = target ? target.center : [shape.x + 14, shape.y + l.boxH + 18];
        const a = angleOf(from, tip);
        const ex = Math.max(shape.x, Math.min(shape.x + l.boxW, from[0] + Math.cos(a) * 9999));
        const ey = Math.max(shape.y, Math.min(shape.y + l.boxH, from[1] + Math.sin(a) * 9999));
        const gap = Math.hypot(tip[0] - ex, tip[1] - ey);
        // Stop short of an object so the tail points at it rather than covering it.
        const reach = target ? Math.max(0, gap - 14) / Math.max(gap, 1) : 1;
        const px = ex + (tip[0] - ex) * reach;
        const py = ey + (tip[1] - ey) * reach;
        const nx = Math.cos(a + Math.PI / 2) * 8;
        const ny = Math.sin(a + Math.PI / 2) * 8;
        tail = `${ex + nx},${ey + ny} ${px},${py} ${ex - nx},${ey - ny}`;
      }
      return (
        <g {...common} transform={shape.rot ? `rotate(${shape.rot} ${c[0]} ${c[1]})` : undefined}>
          {boxed ? (
            <>
              {tail ? (
                <polygon
                  points={tail}
                  fill={boxFill}
                  stroke={stroke}
                  strokeWidth={Math.min(style.width, 2)}
                  strokeLinejoin="round"
                />
              ) : null}
              <rect
                x={shape.x}
                y={shape.y}
                width={l.boxW}
                height={l.boxH}
                rx={shape.kind === 'sticky' ? 2 : 8}
                fill={boxFill}
                stroke={stroke}
                strokeWidth={shape.kind === 'sticky' ? 0 : Math.min(style.width, 2)}
              />
              {tail ? <polygon points={tail} fill={boxFill} stroke="none" /> : null}
            </>
          ) : (
            <rect x={shape.x} y={shape.y} width={l.boxW} height={l.boxH} fill="transparent" />
          )}
          <text
            fontSize={shape.size}
            fill={textFill}
            stroke={boxed ? undefined : paper}
            strokeWidth={boxed ? undefined : 4}
            paintOrder="stroke"
            strokeLinejoin="round"
          >
            {l.lines.map((line, i) => (
              <tspan
                key={i}
                x={shape.x + l.pad}
                y={shape.y + l.pad + l.lineH * i + shape.size}
                xmlSpace="preserve"
              >
                {line === '' ? ' ' : line}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
  }
});

interface PinProps {
  pin: MapPin;
  scale: number;
  color: string;
  icon: Parameters<typeof MarkerGlyph>[0]['icon'];
  paper: string;
  ink: string;
  label: { dx: number; dy: number; anchor: 'middle' | 'start' | 'end' } | null;
}

/** A marker: a round badge with its icon, the same size on screen at every zoom. */
const PinView = memo(function PinView({ pin, scale, color, icon, paper, ink, label }: PinProps) {
  return (
    <g
      transform={`translate(${pin.x} ${pin.y}) scale(${1 / scale})`}
      data-oid={pin.id}
      data-kind="pin"
    >
      <circle r={13} fill={color} stroke={paper} strokeWidth={2.5} />
      <g color={paper}>
        <MarkerGlyph icon={icon} size={16} />
      </g>
      {pin.target ? (
        <circle cx={10} cy={-10} r={4.5} fill={paper} stroke={color} strokeWidth={2} />
      ) : null}
      {label && pin.label ? (
        <text
          x={label.dx}
          y={label.dy}
          textAnchor={label.anchor}
          fontSize={12.5}
          fontWeight={600}
          fill={ink}
          stroke={paper}
          strokeWidth={3.5}
          paintOrder="stroke"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        >
          {pin.label}
        </text>
      ) : null}
    </g>
  );
});

/**
 * Everything drawn on a map, in layer order. Used by the editor and, rendered to a string, by
 * the SVG, PNG and PDF exports, so what you see is what you save.
 */
export function SceneView({
  doc,
  objs,
  colorOf = cssColor,
  paper = 'var(--paper)',
  ink = 'var(--ink)',
  scale,
  toScreen,
  markerTypes,
  labels = true,
  pins = true,
}: SceneViewProps) {
  const labelPlacement = useMemo(() => {
    if (!labels || !toScreen)
      return new Map<string, { dx: number; dy: number; anchor: 'middle' | 'start' | 'end' }>();
    const boxes = doc.pins
      .filter((p) => p.label !== '')
      .map((p) => {
        const info = objs.get(p.id);
        const [x, y] = toScreen(p.x, p.y);
        return info && isVisible(doc, info)
          ? { id: p.id, x, y, w: p.label.length * 7.2 + 6 }
          : null;
      })
      .filter((b): b is { id: string; x: number; y: number; w: number } => b !== null);
    return placeLabels(boxes);
  }, [doc, objs, labels, toScreen]);

  const byLayer = useMemo(() => {
    const shapes = new Map<string, ObjInfo[]>();
    for (const s of doc.scene.shapes) {
      const info = objs.get(s.id);
      if (!info || !isVisible(doc, info)) continue;
      (shapes.get(info.layer) ?? shapes.set(info.layer, []).get(info.layer))?.push(info);
    }
    return shapes;
  }, [doc, objs]);

  return (
    <>
      {doc.scene.layers.map((layer) => {
        if (layer.hidden) return null;
        const layerPins = pins
          ? doc.pins.filter((p) => {
              const info = objs.get(p.id);
              return info?.layer === layer.id && isVisible(doc, info);
            })
          : [];
        return (
          <g key={layer.id} data-layer={layer.id}>
            {(byLayer.get(layer.id) ?? []).map((info) => (
              <ShapeView
                key={info.id}
                info={info}
                objs={objs}
                colorOf={colorOf}
                paper={paper}
                ink={ink}
                scale={scale}
              />
            ))}
            {layerPins.map((pin) => {
              const look = pinLook(pin, markerTypes);
              return (
                <PinView
                  key={pin.id}
                  pin={pin}
                  scale={scale}
                  color={colorOf(look.color)}
                  icon={look.icon}
                  paper={paper}
                  ink={ink}
                  label={
                    labelPlacement.get(pin.id) ??
                    (labels && !toScreen ? { dx: 0, dy: 28, anchor: 'middle' } : null)
                  }
                />
              );
            })}
          </g>
        );
      })}
    </>
  );
}
