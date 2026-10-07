import type { MapShape } from '@shared/schemas/map';

/** The name a shape goes by in the inspector's heading. */
export function kindLabel(shape: MapShape | undefined): string {
  switch (shape?.t) {
    case 'path':
      return shape.closed ? 'Loop' : 'Path';
    case 'rect':
      return shape.w === shape.h ? 'Square' : 'Box';
    case 'ellipse':
      return shape.rx === shape.ry ? 'Circle' : 'Oval';
    case 'polygon':
      return 'Area';
    case 'connector':
      return shape.head === 'none' ? 'Line' : 'Arrow';
    case 'text':
      return TEXT_KIND_HEADINGS[shape.kind];
    default:
      return 'Object';
  }
}

const TEXT_KIND_HEADINGS = {
  plain: 'Text',
  sticky: 'Sticky note',
  callout: 'Callout',
  card: 'Note card',
} as const;
