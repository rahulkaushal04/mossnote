/**
 * Collects what a drag can snap to (object points and edges, other objects' alignment lines,
 * guides) from the document, leaving out the objects being dragged.
 */
import { isVisible, type Doc } from './doc';
import { anchorPoints, outlineSegments, type Objects } from './shapes';
import { gridStep, type SnapContext, type SnapSettings } from './snap';

/**
 * What a drag can snap to: every visible object that is not itself being moved. Built once when a
 * drag starts, so the drag stays cheap however many objects the map holds.
 */
export function buildSnapContext(
  doc: Doc,
  objs: Objects,
  exclude: ReadonlySet<string>,
  scale: number,
  settings: SnapSettings,
): SnapContext {
  const points: SnapContext['points'] = [];
  const segments: SnapContext['segments'] = [];
  const lines: SnapContext['lines'] = [];
  for (const info of objs.values()) {
    if (exclude.has(info.id) || !isVisible(doc, info)) continue;
    for (const pt of anchorPoints(info, objs)) points.push({ pt, id: info.id });
    for (const [a, b] of outlineSegments(info, objs)) segments.push({ a, b, id: info.id });
    const b = info.box;
    lines.push(
      { axis: 'x', pos: b.minX },
      { axis: 'x', pos: (b.minX + b.maxX) / 2 },
      { axis: 'x', pos: b.maxX },
      { axis: 'y', pos: b.minY },
      { axis: 'y', pos: (b.minY + b.maxY) / 2 },
      { axis: 'y', pos: b.maxY },
    );
  }
  for (const g of doc.scene.guides ?? []) lines.push({ axis: g.axis, pos: g.pos });
  return { scale, settings, gridStep: gridStep(scale), points, segments, lines };
}
