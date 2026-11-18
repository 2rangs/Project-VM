import { describe, it, expect } from "vitest";
import { MapCoordinateSystem } from "../src/coordinate.js";
import { loadAscent, loadTransform } from "./fixture.js";

describe("coordinate transform", () => {
  const transform = loadTransform();
  const coords = new MapCoordinateSystem(transform);
  const map = loadAscent();

  it("maps every Ascent zone into normalized [0,1] minimap space", () => {
    for (const z of map.zones) {
      const m = coords.toMinimap(z.position);
      expect(m.x, `${z.name}.x`).toBeGreaterThanOrEqual(0);
      expect(m.x, `${z.name}.x`).toBeLessThanOrEqual(1);
      expect(m.y, `${z.name}.y`).toBeGreaterThanOrEqual(0);
      expect(m.y, `${z.name}.y`).toBeLessThanOrEqual(1);
    }
  });

  it("round-trips game -> minimap -> game within floating-point tolerance", () => {
    for (const z of map.zones) {
      const back = coords.toGame(coords.toMinimap(z.position));
      expect(back.x).toBeCloseTo(z.position.x, 6);
      expect(back.y).toBeCloseTo(z.position.y, 6);
    }
  });

  it("round-trips an arbitrary game point", () => {
    const p = { x: 1234.5, y: -6789.0, z: 250 };
    const back = coords.toGame(coords.toMinimap(p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });
});
