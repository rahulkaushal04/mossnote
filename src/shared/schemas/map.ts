import { z } from 'zod';
import { LIMITS, MAP_COLORS, MAP_ICONS } from '../constants';
import { DEFAULT_STYLE, EMPTY_SCENE_LAYER_ID, emptyScene } from '../mapDefaults';
import {
  boundedText,
  customFieldsSchema,
  isoTimestamp,
  nameSchema,
  smallListLimit,
  ulidSchema,
} from './common';

/** A named colour (follows the theme) or a custom `#rrggbb` the user picked. */
export const mapColorSchema = z.union([z.enum(MAP_COLORS), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export type MapColor = z.infer<typeof mapColorSchema>;

const coord = z.number().min(-LIMITS.mapCoord).max(LIMITS.mapCoord);
const point = z.tuple([coord, coord]);
const objectId = z.string().min(1).max(40);

export const mapStyleSchema = z
  .object({
    stroke: mapColorSchema,
    fill: mapColorSchema.nullable(),
    width: z.number().min(0.5).max(40),
    dash: z.enum(['solid', 'dashed', 'dotted']),
  })
  .strict();

const base = {
  id: objectId,
  layer: objectId,
  name: z.string().max(LIMITS.shapeName).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  group: objectId.optional(),
  /** A short note attached to the object. */
  note: z.string().max(LIMITS.shapeNote).optional(),
  style: mapStyleSchema,
};
const rotation = z.number().min(-360).max(360).optional();

const path = z
  .object({
    ...base,
    t: z.literal('path'),
    pts: z.array(point).min(1).max(LIMITS.mapStrokePoints),
    closed: z.boolean().optional(),
    /** Draw as a smooth curve through the points. */
    smooth: z.boolean().optional(),
  })
  .strict();
const rect = z
  .object({
    ...base,
    t: z.literal('rect'),
    x: coord,
    y: coord,
    w: z
      .number()
      .min(1)
      .max(LIMITS.mapCoord * 2),
    h: z
      .number()
      .min(1)
      .max(LIMITS.mapCoord * 2),
    rot: rotation,
    r: z.number().min(0).max(1000).optional(),
  })
  .strict();
const ellipse = z
  .object({
    ...base,
    t: z.literal('ellipse'),
    cx: coord,
    cy: coord,
    rx: z.number().min(0.5).max(LIMITS.mapCoord),
    ry: z.number().min(0.5).max(LIMITS.mapCoord),
    rot: rotation,
  })
  .strict();
const polygon = z
  .object({
    ...base,
    t: z.literal('polygon'),
    pts: z.array(point).min(3).max(LIMITS.mapStrokePoints),
  })
  .strict();

/** One end of a connector: a free point, or an object it stays attached to (`pt` is its last place). */
export const connectorEndSchema = z.object({ pt: point, ref: objectId.optional() }).strict();
const connector = z
  .object({
    ...base,
    t: z.literal('connector'),
    from: connectorEndSchema,
    to: connectorEndSchema,
    route: z.enum(['straight', 'curve', 'elbow']),
    head: z.enum(['none', 'end', 'both']),
    /** Sideways bulge of a curve, in world units. */
    bend: z.number().min(-5000).max(5000).optional(),
  })
  .strict();
const text = z
  .object({
    ...base,
    t: z.literal('text'),
    x: coord,
    y: coord,
    text: z.string().min(1).max(LIMITS.mapText),
    size: z.number().min(6).max(400),
    rot: rotation,
    kind: z.enum(['plain', 'card', 'callout', 'sticky']),
    /** Card width; text wraps inside it. */
    w: z.number().min(40).max(2000).optional(),
    /** Stay at an offset from another object, and move with it. */
    anchor: z.object({ ref: objectId, dx: coord, dy: coord }).strict().optional(),
  })
  .strict();

export const mapShapeSchema = z.discriminatedUnion('t', [
  path,
  rect,
  ellipse,
  polygon,
  connector,
  text,
]);

export const mapLayerSchema = z
  .object({
    id: objectId,
    name: z.string().trim().min(1).max(40),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();

export const mapSceneSchema = z
  .object({
    v: z.literal(2),
    layers: z.array(mapLayerSchema).min(1).max(LIMITS.mapLayers),
    shapes: z.array(mapShapeSchema).max(LIMITS.mapShapes, 'This map has too many drawings.'),
    guides: z
      .array(z.object({ axis: z.enum(['x', 'y']), pos: coord }).strict())
      .max(LIMITS.mapGuides)
      .optional(),
    /** What one grid cell is worth, for the measure tool. */
    scale: z
      .object({ unit: z.string().trim().min(1).max(12), size: z.number().positive().max(1e6) })
      .strict()
      .optional(),
  })
  .strict();

export type MapShape = z.infer<typeof mapShapeSchema>;
export type MapScene = z.infer<typeof mapSceneSchema>;
export type MapLayer = z.infer<typeof mapLayerSchema>;
export type MapStyle = z.infer<typeof mapStyleSchema>;
export type ConnectorEnd = z.infer<typeof connectorEndSchema>;

/**
 * Read a stored scene. Version 1 was a flat list of strokes, areas, arrows and labels; it is
 * converted on the way in, so the rest of the code only ever sees version 2.
 */
export function readScene(raw: unknown): MapScene {
  const v2 = mapSceneSchema.safeParse(raw);
  if (v2.success) return v2.data;
  if (!Array.isArray(raw)) return emptyScene();
  const layer = EMPTY_SCENE_LAYER_ID;
  const shapes: unknown[] = [];
  for (const old of raw as Record<string, unknown>[]) {
    const id = typeof old.id === 'string' ? old.id : '';
    const color = old.color;
    if (old.t === 'stroke') {
      shapes.push({
        t: 'path',
        id,
        layer,
        pts: old.pts,
        smooth: true,
        style: { ...DEFAULT_STYLE, stroke: color, width: old.w },
      });
    } else if (old.t === 'area') {
      shapes.push({
        t: 'polygon',
        id,
        layer,
        pts: old.pts,
        name: old.name,
        style: { ...DEFAULT_STYLE, stroke: color, fill: color, width: 2 },
      });
    } else if (old.t === 'arrow') {
      shapes.push({
        t: 'connector',
        id,
        layer,
        from: { pt: old.a },
        to: { pt: old.b },
        route: 'straight',
        head: 'end',
        style: { ...DEFAULT_STYLE, stroke: color },
      });
    } else if (old.t === 'label') {
      shapes.push({
        t: 'text',
        id,
        layer,
        x: old.x,
        y: old.y,
        text: old.text,
        size: 16,
        kind: 'plain',
        style: { ...DEFAULT_STYLE, stroke: color },
      });
    }
  }
  const migrated = mapSceneSchema.safeParse({
    v: 2,
    layers: [{ id: layer, name: 'Layer 1' }],
    shapes,
  });
  return migrated.success ? migrated.data : emptyScene();
}

export const mapMarkerTypeSchema = z
  .object({
    id: objectId,
    name: z.string().trim().min(1).max(30),
    icon: z.enum(MAP_ICONS),
    color: mapColorSchema,
  })
  .strict();
export const markerTypesSchema = z.array(mapMarkerTypeSchema).max(LIMITS.markerTypes);
export type MapMarkerType = z.infer<typeof mapMarkerTypeSchema>;

export const pinPropsSchema = z
  .object({
    type: objectId.optional(),
    icon: z.enum(MAP_ICONS).optional(),
    status: z.string().trim().max(LIMITS.pinStatus).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(LIMITS.pinTags).optional(),
    fields: customFieldsSchema.max(LIMITS.pinFields).optional(),
    layer: objectId.optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    group: objectId.optional(),
  })
  .strict();
export type PinProps = z.infer<typeof pinPropsSchema>;

export const mapCreateSchema = z
  .object({
    id: ulidSchema.optional(),
    name: nameSchema(LIMITS.mapName).optional(),
    template: z.enum(['blank', 'layers']).optional(),
  })
  .strict();

export const mapPatchSchema = z
  .object({
    name: nameSchema(LIMITS.mapName).optional(),
    scene: mapSceneSchema.optional(),
    expectedUpdatedAt: isoTimestamp.optional(),
  })
  .strict();

export const mapListQuerySchema = z.object({
  limit: smallListLimit,
  cursor: z.string().max(500).optional(),
});

export const pinTargetSchema = z
  .object({ type: z.enum(['note', 'person', 'planting']), id: ulidSchema })
  .strict();

const pinBase = {
  x: coord,
  y: coord,
  label: z
    .string()
    .transform((s) => s.trim())
    .refine(
      (s) => s.length <= LIMITS.pinLabel,
      `Labels can be up to ${LIMITS.pinLabel} characters.`,
    ),
  color: mapColorSchema,
  note: boundedText(LIMITS.pinNote),
  target: pinTargetSchema.nullable(),
  props: pinPropsSchema,
};

export const pinCreateSchema = z
  .object({
    id: ulidSchema.optional(),
    x: pinBase.x,
    y: pinBase.y,
    label: pinBase.label.optional(),
    color: pinBase.color.optional(),
    note: pinBase.note.optional(),
    target: pinBase.target.optional(),
    props: pinBase.props.optional(),
  })
  .strict();

export const pinPatchSchema = z
  .object({
    x: pinBase.x.optional(),
    y: pinBase.y.optional(),
    label: pinBase.label.optional(),
    color: pinBase.color.optional(),
    note: pinBase.note.optional(),
    target: pinBase.target.optional(),
    props: pinBase.props.optional(),
  })
  .strict();

/** One request that saves the sketch and any pin changes together, so an undo is one write. */
export const mapChangesSchema = z
  .object({
    scene: mapSceneSchema.optional(),
    upsert: z
      .array(pinCreateSchema.extend({ id: ulidSchema }))
      .max(LIMITS.pinsPerMap)
      .optional(),
    remove: z.array(ulidSchema).max(LIMITS.pinsPerMap).optional(),
  })
  .strict();

export const mapDuplicateSchema = z
  .object({ id: ulidSchema.optional(), name: nameSchema(LIMITS.mapName).optional() })
  .strict();

export const versionCreateSchema = z
  .object({ name: z.string().trim().min(1).max(60).optional() })
  .strict();

export const pinsByTargetQuerySchema = z.object({
  type: z.enum(['note', 'person', 'planting']),
  id: ulidSchema,
});

export type MapCreate = z.infer<typeof mapCreateSchema>;
export type MapPatch = z.infer<typeof mapPatchSchema>;
export type MapListQuery = z.infer<typeof mapListQuerySchema>;
export type PinCreate = z.infer<typeof pinCreateSchema>;
export type PinPatch = z.infer<typeof pinPatchSchema>;
export type MapChanges = z.infer<typeof mapChangesSchema>;

/** The editable project file for one map. Scenes keep every object, so nothing is flattened. */
export const mapProjectSchema = z
  .object({
    format: z.literal('mossnote-map'),
    formatVersion: z.number().int().min(1).max(1),
    exportedAt: isoTimestamp.optional(),
    name: nameSchema(LIMITS.mapName),
    scene: z.unknown().transform((raw) => readScene(raw)),
    pins: z
      .array(
        z
          .object({
            id: ulidSchema,
            x: coord,
            y: coord,
            label: pinBase.label,
            color: mapColorSchema,
            note: pinBase.note,
            props: pinPropsSchema.default({}),
          })
          .strip(),
      )
      .max(LIMITS.pinsPerMap),
  })
  .strip();
