import { describe, it, expect } from "vitest";
import { buildAbilityCatalog, abilitySpecFromCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState, type ZoneId,
} from "../src/index.js";
import { loadSpatial, loadWeapons, scenePos } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

const flashCatalog: AbilityCatalog = buildAbilityCatalog([
  abilitySpecFromCatalog({ abilityId: "breach:Ability2", slot: "Ability2", name: "Flashpoint", effectTypes: ["flash"], params: { radiusMeters: 12, rangeMeters: 100, durationMs: 2000, makesSound: true } }, { charges: 1 }),
]);
const shortSmoke: AbilityCatalog = buildAbilityCatalog([
  abilitySpecFromCatalog({ abilityId: "omen:Ability2", slot: "Ability2", name: "Dark Cover", effectTypes: ["smoke"], params: { radiusMeters: 5, rangeMeters: 0.1, durationMs: 15000, blocksVision: true } }, { charges: 1 }),
]);

function mk(id: string, side: "attack" | "defense", zoneId: string, facing: { x: number; y: number }, abilityId?: string): SimPlayer {
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...scenePos(spatial, zoneId) }, zoneId, facing, health: 100, armor: 100, alive: true, weaponId: "Classic",
    skills: AVERAGE_SKILLS, abilities: abilityId ? [{ abilityId, slot: "basic", chargesRemaining: 1, lastUsedAtMs: null }] : [],
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

/** attacker at a-main throws `abilityId` to `targetZone` on the first decision; both hold. */
function throwPolicies(abilityId: string, targetZone: ZoneId): Record<"attack" | "defense", DecisionPolicy> {
  return {
    attack: { decide: (v: PolicyView): PolicyDecision => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => v.timeRemainingMs > 59000 ? { playerId: p.id, kind: "useAbility" as const, abilityId, targetZone } : { playerId: p.id, kind: "hold" as const, aimZone: "a-site" }) }) },
    defense: { decide: (v: PolicyView): PolicyDecision => ({ strategy: "defaultHold", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone: "a-main" })) }) },
  };
}

function run(catalog: AbilityCatalog, abilityId: string, targetZone: ZoneId) {
  const aMain = spatial.getZone("a-main")!.position, aSite = spatial.getZone("a-site")!.position;
  const atk = mk("atk", "attack", "a-main", { x: aSite.x - aMain.x, y: aSite.y - aMain.y }, abilityId);
  const def = mk("def", "defense", "a-site", { x: aMain.x - aSite.x, y: aMain.y - aSite.y });
  const state: SimState = {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
    players: [atk, def],
    spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
  return new RoundSimulator({
    spatial, weapons, abilities: catalog, policies: throwPolicies(abilityId, targetZone),
    config: { seed: 1, roundTimeMs: 6000, traceCommands: true },
  }).runRound(state);
}

describe("target-zone ability placement", () => {
  it("a flash thrown to the defender's zone blinds the defender (placed at target, not caster)", () => {
    const r = run(flashCatalog, "breach:Ability2", "a-site"); // thrown onto the defender
    expect(r.events.some((e) => e.kind === "abilityUsed" && e.actor === "atk")).toBe(true);
    const e = r.engagementTrace?.[0];
    expect(e).toBeDefined();
    expect(e!.defenderFlashedMs).toBeGreaterThan(0); // the flash landed on a-site, not at a-main
  });

  it("the same flash thrown to a far zone does NOT blind the defender", () => {
    const r = run(flashCatalog, "breach:Ability2", "b-site"); // thrown away from the defender
    const e = r.engagementTrace?.[0];
    if (e) expect(e.defenderFlashedMs).toBe(0);
  });

  it("rejects a throw beyond the ability range (outOfRange, no cast)", () => {
    const r = run(shortSmoke, "omen:Ability2", "b-site"); // 0.1 m range, far target
    expect(r.commandTrace!.some((e) => e.playerId === "atk" && e.phase === "ability" && e.result === "outOfRange")).toBe(true);
    expect(r.events.some((e) => e.kind === "abilityUsed" && e.actor === "atk")).toBe(false);
  });

  it("is deterministic", () => {
    expect(run(flashCatalog, "breach:Ability2", "a-site").engagementTrace).toEqual(run(flashCatalog, "breach:Ability2", "a-site").engagementTrace);
  });
});
