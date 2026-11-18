import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, type SimPlayer, type SimState } from "../src/index.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function mkPlayer(id: string, side: "attack" | "defense", zoneId: string, weaponId: string, skill: number, facing: { x: number; y: number }, armor = 0): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing, health: 100, armor, alive: true, weaponId,
    skills: { ...AVERAGE_SKILLS, aim: skill, reaction: skill, firstBulletAccuracy: skill, crosshairPlacement: skill, tracking: skill, movement: skill, weaponControl: skill },
    abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

/** Spike already planted on A site; one defuser on site, one attacker pushing from A main. */
function plantedState(): SimState {
  const aSite = spatial.getZone("a-site")!;
  return {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 100000,
    players: [
      // attacker: strong, pushes in from lobby (no tick-0 sightline to the site)
      mkPlayer("atk", "attack", "a-lobby", "Vandal", 0.95, { x: 1, y: -1 }),
      // defuser: weak, on site, facing AWAY from A main (toward +x) so it is caught off guard
      mkPlayer("def", "defense", "a-site", "Classic", 0.2, { x: 1, y: -1 }, 0),
    ],
    spike: { phase: "planted", carrierId: null, zoneId: "a-site", position: { ...aSite.position }, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: 60000 },
  };
}

describe("defuse interruption", () => {
  it("killing the defuser mid-defuse interrupts the defuse", () => {
    const sim = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq) },
      // long defuse so the attacker reliably arrives and kills the defuser mid-defuse
      config: { seed: 3, defuseDurationMs: 15000 },
    });
    const result = sim.runRound(plantedState());

    expect(result.events.some((e) => e.kind === "defuseStart")).toBe(true);
    expect(result.events.some((e) => e.kind === "defuseInterrupted")).toBe(true);
    // the defuse did not complete
    expect(result.events.some((e) => e.kind === "defused")).toBe(false);
    // attacker eliminated the lone defender → attack win
    expect(result.winner).toBe("attack");
  });
});
