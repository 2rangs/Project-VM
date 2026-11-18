/**
 * World→minimap projection (PV-4 transform). Pure; the transform values come
 * from PV-4 datasets/spatial/<map>/coordinate-system.json (carried in
 * replay.meta.coordinateTransform). This module does NOT own the transform — it
 * only applies it, so the viewer and any analysis agree on one projection.
 */
import type { CoordinateTransform, Vec3 } from './types.ts';

export interface MinimapPoint { readonly mx: number; readonly my: number }

/** Project a world position into normalized minimap space (nominally [0,1]). */
export function projectToMinimap(pos: Vec3, t: CoordinateTransform): MinimapPoint {
  return {
    mx: pos.y * t.xMultiplier + t.xScalarToAdd,
    my: pos.x * t.yMultiplier + t.yScalarToAdd,
  };
}

/** Project into pixel space of a size×size minimap image. */
export function projectToPixels(pos: Vec3, t: CoordinateTransform, size: number): MinimapPoint {
  const p = projectToMinimap(pos, t);
  return { mx: p.mx * size, my: p.my * size };
}

/** True when a projected point lands inside the minimap image bounds. */
export function inMinimap(p: MinimapPoint): boolean {
  return p.mx >= 0 && p.mx <= 1 && p.my >= 0 && p.my <= 1;
}
