import { describe, it, expect } from "vitest";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState, type ZoneId,
} from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

function mk(id: string, side: "attack" | "defense", zoneId: string, facing: { x: number; y: number }): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing, health: 100, armor: 100, alive: true, weaponId: "Classic",
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

// defender holds a-site watching `aimZone`; attacker holds a-main facing the defender.
function holdPolicies(aimZone: ZoneId): Record<"attack" | "defense", DecisionPolicy> {
  const defense: DecisionPolicy = {
    decide: (v: PolicyView): PolicyDecision => ({
      strategy: "defaultHold", roles: [],
      commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone })),
    }),
  };
  const attack: DecisionPolicy = {
    decide: (v: PolicyView): PolicyDecision => ({
      strategy: "default", roles: [],
      commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone: "a-site" })),
    }),
  };
  return { attack, defense };
}

function runWithDefenderAim(aimZone: ZoneId) {
  const aMain = spatial.getZone("a-main")!.position;
  const aSite = spatial.getZone("a-site")!.position;
  const atk = mk("atk", "attack", "a-main", { x: aSite.x - aMain.x, y: aSite.y - aMain.y }); // faces a-site
  const def = mk("def", "defense", "a-site", { x: 1, y: 0 });
  const state: SimState = {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 20000,
    players: [atk, def],
    spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES, policies: holdPolicies(aimZone),
    config: { seed: 1, roundTimeMs: 20000, traceCommands: true },
  }).runRound(state);
}

describe("hold-facing: aimZone orients a stationary player's FOV", () => {
  it("a defender watching the attacker's entry sees it; one watching elsewhere does not", () => {
    const watching = runWithDefenderAim("a-main"); // toward the attacker
    const away = runWithDefenderAim("b-site"); // away from the attacker
    const e1 = watching.engagementTrace?.[0];
    const e2 = away.engagementTrace?.[0];
    expect(e1).toBeDefined();
    // watching the entry → the defender sees the attacker (mutual or defender-first)
    expect(e1!.defenderSawAttacker).toBe(true);
    // the opposite aim must change the defender's sight picture (it does not see the entry)
    if (e2) expect(e2.defenderSawAttacker).toBe(false);
  });

  it("is deterministic", () => {
    expect(runWithDefenderAim("a-main").engagementTrace).toEqual(runWithDefenderAim("a-main").engagementTrace);
  });
});
