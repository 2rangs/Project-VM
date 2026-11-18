import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, type SimPlayer, type SimState } from "../src/index.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function mk(id: string, side: "attack" | "defense", zoneId: string): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 50, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

describe("spike pickup", () => {
  it("an attacker on a dropped spike picks it up and can plant it", () => {
    const aSite = spatial.getZone("a-site")!.position;
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 100000,
      players: [mk("atk2", "attack", "a-site"), mk("def1", "defense", "b-site")],
      // spike dropped on A site (previous carrier died), no current carrier
      spike: { phase: "carried", carrierId: null, zoneId: "a-site", position: { ...aSite }, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const result = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq) },
      config: { seed: 2 },
    }).runRound(state);

    expect(result.events.some((e) => e.kind === "spikePickup" && e.actor === "atk2")).toBe(true);
    // after pickup the spike can be planted (plant event follows)
    expect(result.events.some((e) => e.kind === "planted")).toBe(true);
  });
});
