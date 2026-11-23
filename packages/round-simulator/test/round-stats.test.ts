import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(seed: number, collectStats: boolean) {
  const s = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed, collectStats },
  });
  return s.runRound(makeSyntheticRound(spatial));
}

describe("report-only round stats (config.collectStats)", () => {
  it("is passive: the round plays out identically with and without it", () => {
    for (const seed of [1, 2, 3]) {
      const off = run(seed, false);
      const { stats, ...on } = run(seed, true);
      expect(stats).toBeDefined();
      expect(off.stats).toBeUndefined();
      expect(on).toEqual(off);
    }
  });

  it("records attacker routes from spawn, site arrivals in order, and crowd counters", () => {
    const r = run(5, true);
    const s = r.stats!;
    expect(s.ticks).toBe(r.endedAtTick);
    expect(s.overlapTicks).toBeLessThanOrEqual(s.ticks);
    for (const route of Object.values(s.attackerRoutes)) expect(route[0]).toBe("attacker-spawn");
    for (let i = 1; i < s.siteArrivals.length; i++) expect(s.siteArrivals[i]!.atMs).toBeGreaterThanOrEqual(s.siteArrivals[i - 1]!.atMs);
    for (const a of s.siteArrivals) {
      expect(spatial.isPlantableZone(a.zoneId)).toBe(true);
      expect(s.attackerRoutes[a.playerId]!.at(-1)).toBe(a.zoneId);
    }
    for (const v of Object.values(s.crowd)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
