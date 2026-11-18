import { describe, it, expect } from "vitest";
import { abilitySpecFromCatalog, primaryEffect, UNITS_PER_METER, type CatalogEffectRecord } from "../src/index.js";

describe("PV-1 catalog alignment", () => {
  it("converts metres to world units in exactly one place (×100)", () => {
    const rec: CatalogEffectRecord = {
      abilityId: "omen:Ability2", slot: "Ability2", name: "Dark Cover",
      effectTypes: ["smoke"], params: { radiusMeters: 5, rangeMeters: 40, durationMs: 15000, blocksVision: true, makesSound: true },
    };
    const spec = abilitySpecFromCatalog(rec, { cost: 150, charges: 1 });
    expect(spec.radiusUnits).toBe(5 * UNITS_PER_METER);
    expect(spec.rangeUnits).toBe(40 * UNITS_PER_METER);
    expect(spec.durationMs).toBe(15000);
    expect(spec.blocksVision).toBe(true);
    expect(spec.cost).toBe(150);
    expect(spec.charges).toBe(1);
  });

  it("picks a primary effect from a combined effectTypes array", () => {
    expect(primaryEffect(["slow", "smoke"])).toBe("smoke");
    expect(primaryEffect(["recon", "flash"])).toBe("flash"); // flash gates combat
    expect(primaryEffect(["slow"])).toBe("slow");
  });

  it("derives flash blind duration from the effect duration when not given explicitly", () => {
    const rec: CatalogEffectRecord = {
      abilityId: "breach:Ability2", slot: "Ability2", name: "Flashpoint",
      effectTypes: ["flash"], params: { durationMs: 2000, makesSound: true },
    };
    expect(abilitySpecFromCatalog(rec).flashDurationMs).toBe(2000);
  });

  it("maps destructibleHp to wall HP and defaults blocksVision true for occluders", () => {
    const rec: CatalogEffectRecord = {
      abilityId: "sage:Ability3", slot: "Ability2", name: "Barrier Orb",
      effectTypes: ["wall"], params: { destructibleHp: 800, makesSound: true },
    };
    const spec = abilitySpecFromCatalog(rec);
    expect(spec.wallHp).toBe(800);
    expect(spec.blocksVision).toBe(true); // occluder default
  });

  it("leaves unsourced numerics null (never invents a value)", () => {
    const rec: CatalogEffectRecord = {
      abilityId: "x:Ability1", slot: "Ability1", name: "X",
      effectTypes: ["molly"], params: { makesSound: true },
    };
    const spec = abilitySpecFromCatalog(rec);
    expect(spec.radiusUnits).toBeNull();
    expect(spec.durationMs).toBeNull();
  });
});
