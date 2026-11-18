import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "@project-v/perception-engine";
import {
  RoundSimulator, ScriptedPolicy, buildPolicyView, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS,
  type DecisionPolicy, type PolicyDecision, type PolicyView,
} from "../src/index.js";
import type { SimPlayer, SimState } from "../src/index.js";
import { AVERAGE_SKILLS } from "@project-v/combat-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function mk(id: string, side: "attack" | "defense", zoneId: string, facing = { x: 1, y: 0 }): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing, health: 100, armor: 0, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

describe("PolicyView does not leak enemy ground truth (DECISION-004)", () => {
  it("teammates are own-team only, and an unseen enemy's position is absent", () => {
    // attacker faces away from the defender; the defender sits far with a unique coordinate
    const atk = mk("atk", "attack", "a-lobby", { x: -1, y: 1 });
    const def: SimPlayer = { ...mk("def", "defense", "b-site"), position: { x: 424242.5, y: -98765.25, z: 100 } };
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [atk, def],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const view = buildPolicyView("attack", state, new PerceptionEngine(spatial));

    // own-team only
    expect(view.teammates.map((t) => t.id)).toEqual(["atk"]);
    expect(view.teammates.some((t) => t.teamId === "defenders")).toBe(false);
    // the enemy's secret live coordinate must not appear anywhere in the view
    expect(JSON.stringify(view)).not.toContain("424242.5");
    // enemies are reachable only through observation (here: unseen → none)
    expect(view.observation.visibleEnemies.some((e) => e.currentlyVisible)).toBe(false);
  });

  it("the object handed to a team policy is a PolicyView with no WorldState fields", () => {
    const keys = new Set<string>();
    const spy: DecisionPolicy = {
      decide(view: PolicyView): PolicyDecision {
        for (const k of Object.keys(view)) keys.add(k);
        const v = view as unknown as Record<string, unknown>;
        expect(v).not.toHaveProperty("players");
        expect(v).not.toHaveProperty("enemies");
        return { strategy: "default", roles: [], commands: [] };
      },
    };
    new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: spy, defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
      config: { seed: 1, roundTimeMs: 4000 },
    }).runRound(makeSyntheticRound(spatial));
    // teammates is own-team state; enemies only via observation/belief
    expect(keys.has("teammates")).toBe(true);
    expect(keys.has("observation")).toBe(true);
    expect(keys.has("belief")).toBe(true);
  });
});
