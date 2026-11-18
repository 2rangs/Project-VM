import type { CoordinateTransform, Vec2, Vec3 } from "./types.js";

/**
 * Game-world <-> minimap coordinate conversion for VALORANT maps.
 *
 * The valorant-api transform maps Unreal game (x,y) into normalized minimap
 * space [0,1] with an axis swap:
 *   minimapX = gameY * xMultiplier + xScalarToAdd
 *   minimapY = gameX * yMultiplier + yScalarToAdd
 *
 * Verified for Ascent: all 22 callouts land in [0,1] (see
 * tools/map-processor/verify-transform.mjs). z is ignored by the minimap.
 */
export class MapCoordinateSystem {
  constructor(private readonly t: CoordinateTransform) {}

  /** game (x,y[,z]) -> normalized minimap (x,y) in [0,1]. */
  toMinimap(game: Vec2 | Vec3): Vec2 {
    return {
      x: game.y * this.t.xMultiplier + this.t.xScalarToAdd,
      y: game.x * this.t.yMultiplier + this.t.yScalarToAdd,
    };
  }

  /** normalized minimap (x,y) -> game (x,y). z cannot be recovered. */
  toGame(minimap: Vec2): Vec2 {
    return {
      y: (minimap.x - this.t.xScalarToAdd) / this.t.xMultiplier,
      x: (minimap.y - this.t.yScalarToAdd) / this.t.yMultiplier,
    };
  }
}
