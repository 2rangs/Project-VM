/**
 * Spatial primitives.
 *
 * Units: VALORANT world coordinate units (the same units the replay/engine use).
 * The simulation keeps positions in world units; conversion to minimap pixels is a
 * concern of the spatial-engine (PV-4) via a CoordinateTransform, not of these types.
 */

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec2 = (x: number, y: number): Vector2 => ({ x, y });
export const vec3 = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

export const ZERO_VEC2: Vector2 = Object.freeze({ x: 0, y: 0 });
export const ZERO_VEC3: Vector3 = Object.freeze({ x: 0, y: 0, z: 0 });
