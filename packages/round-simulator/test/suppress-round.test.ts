import { describe, it, expect } from "vitest";
import { buildAbilityCatalog, abilitySpecFromCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { loadSpatial, loadWeapons } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

// catalog with a KAY/O-style suppress ult and an Omen smoke
const catalog: AbilityCatalog = buildAbilityCatalog([
  abilitySpecFromCatalog({ abilityId: "kayo:Ultimate", slot: "Ultimate", name: "NULL/cmd", effectTypes: ["suppress"], params: { radiusMeters: 30, durationMs: 8000, makesSound: true } }, { charges: 1, ultPoints: 8 }),
  abilitySpecFromCatalog({ abilityId: "omen:Ability2", slot: "Ability2", name: "Dark Cover", effectTypes: ["smoke"], params: { radiusMeters: 5, durationMs: 15000, blocksVision: true } }, { charges: 1 }),
]);

function mk(id: string, side: "attack" | "defense", zoneId: string, abilityId: string): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 100, alive: true, weaponId: "Classic",
    skills: { ...AVERAGE_SKILLS, aim: 0.01, reaction: 0.01 }, // near-harmless so nobody dies before the test resolves
    abilities: [{ abilityId, slot: abilityId.endsWith("Ultimate") ? "ultimate" : "basic", chargesRemaining: 1, lastUsedAtMs: null }],
    ultimatePoints: abilityId.endsWith("Ultimate") ? 8 : 0, ultimateCost: 8, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

/** attacker casts suppress on tick 0; defender tries to cast its smoke every decision. */
const attackPolicy: DecisionPolicy = {
  decide(view: PolicyView): PolicyDecision {
    const p = view.teammates.find((t) => t.alive);
    const commands = p && view.timeRemainingMs > 59000 ? [{ playerId: p.id, kind: "useAbility" as const, abilityId: "kayo:Ultimate" }] : [];
    return { strategy: "default", roles: [], commands };
  },
};
const defensePolicy: DecisionPolicy = {
  decide(view: PolicyView): PolicyDecision {
    const commands = view.teammates.filter((t) => t.alive).map((t) => ({ playerId: t.id, kind: "useAbility" as const, abilityId: "omen:Ability2" }));
    return { strategy: "default", roles: [], commands };
  },
};

describe("suppress stops a silenced player from casting (round integration)", () => {
  it("the defender's smoke is rejected as 'suppressed' while the suppression is active", () => {
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [mk("atk", "attack", "a-site", "kayo:Ultimate"), mk("def", "defense", "a-site", "omen:Ability2")],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: catalog,
      policies: { attack: attackPolicy, defense: defensePolicy },
      config: { seed: 1, roundTimeMs: 6000, traceCommands: true },
    }).runRound(state);

    // the attacker's suppress fired
    expect(r.events.some((e) => e.kind === "abilityUsed" && e.actor === "atk" && e.detail === "kayo:Ultimate")).toBe(true);
    // the defender's smoke was rejected as suppressed, and never actually fired
    expect(r.commandTrace!.some((e) => e.playerId === "def" && e.phase === "ability" && e.result === "suppressed")).toBe(true);
    expect(r.events.some((e) => e.kind === "abilityUsed" && e.actor === "def")).toBe(false);
  });
});
