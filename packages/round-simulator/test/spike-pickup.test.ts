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

  it("a carrier cut down mid-plant drops the spike (not orphaned on a dead carrier)", () => {
    // Regression for the man-advantage close-out: when the planter died while the spike phase was
    // "planting", the drop did not fire (it only triggered on phase "carried"), so carrierId kept
    // pointing at a dead player and the ground spike had a null zone — no teammate could pick it up
    // and a 4v1 attack ran the clock out. The planter here is on 1 HP against a full-HP defender in
    // the same zone, so it is traded in the first duel while planting; a waiting teammate (atk2)
    // must then recover the spike.
    const aSite = spatial.getZone("a-site")!.position;
    const strong = { aim: 1, reaction: 1, tracking: 1, firstBulletAccuracy: 1, crosshairPlacement: 1, movement: 1, weaponControl: 1 };
    // atk1 plants on 1 HP, facing away from a defender who holds the site with a pre-aim edge: it is
    // traded in the opening tick, while the spike phase is "planting". atk2 is on the site and trades
    // the defender back, then must be able to recover the dropped spike.
    const carrier = { ...mk("atk1", "attack", "a-site"), health: 1, armor: 0, facing: { x: -1, y: 0 } };
    const mate = { ...mk("atk2", "attack", "a-site"), skills: strong, position: { x: aSite.x + 5, y: aSite.y, z: aSite.z }, facing: { x: 1, y: 0 } };
    const defender = { ...mk("def1", "defense", "a-site"), skills: strong, position: { x: aSite.x + 300, y: aSite.y, z: aSite.z }, facing: { x: -1, y: 0 } };
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 100000,
      players: [carrier, mate, defender],
      // the spike is being planted by atk1 (phase "planting", carrier atk1)
      spike: { phase: "planting", carrierId: "atk1", zoneId: "a-site", position: { ...aSite }, plantProgressMs: 1000, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const result = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq) },
      config: { seed: 2 },
    }).runRound(state);

    // atk1 is killed while planting ...
    expect(result.events.some((e) => e.kind === "kill" && e.target === "atk1")).toBe(true);
    // ... and the spike it was planting is not lost with it: a teammate recovers it. Before the fix
    // the dropped spike kept the dead carrierId with a null zone, so this pickup never happened.
    expect(result.events.some((e) => e.kind === "spikePickup" && e.actor === "atk2")).toBe(true);
  });
});
