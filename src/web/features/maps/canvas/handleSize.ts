/** Half the drawn size of a resize or vertex handle, in screen pixels. */
export const HANDLE_VISIBLE_RADIUS = 5;

/** WCAG 2.5.5 and platform guides: a touch target is at least 44px, so a 22px radius. */
const TOUCH_HIT_RADIUS = 22;

/**
 * How far from a handle's centre a press still grabs it. The handle is drawn small so it does not
 * hide the shape; a finger needs a much larger invisible area around it.
 */
export function handleHitRadius(coarsePointer: boolean): number {
  return coarsePointer ? TOUCH_HIT_RADIUS : HANDLE_VISIBLE_RADIUS;
}
