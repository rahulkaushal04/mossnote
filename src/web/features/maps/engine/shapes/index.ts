/** Geometry for map objects. Import from here, not from the files inside. */
export {
  boundaryPoint,
  connectorGeometry,
  curveControl,
  type ConnectorGeometry,
} from './connectors';
export { placedShape, resolveObjects } from './objects';
export { anchorPoints, outlineSegments, polylineD, smoothPathD } from './paths';
export { textCenter, textLayout, textTopLeftForCenter, type TextLayout } from './text';
export {
  applyXform,
  clean,
  rotateXform,
  scaleXform,
  translateXform,
  type Xform,
} from './transform';
export { PIN_R, type ObjInfo, type Objects } from './types';
