import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "@pv/perception-engine";
import { AbilityEngine, abilitySpecFromCatalog, buildAbilityCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, SpatialQueryAdapter, buildPolicyView,
  type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { loadSpatial, loadWeapons } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();
const sq = new SpatialQueryAdapter(spatial);

const mollySpec = abilitySpecFromCatalog(
  { abilityId: "brimstone:Ability1", slot: "Ability1", name: "Incendiary", effectTypes: ["molly"], params: { radiusMeters: 4, durationMs: 7000, rangeMeters: 200, damage: 60 } },
  { charges: 1 },
);
const mollyCatalog: AbilityCatalog = buildAbilityCatalog([mollySpec]);

function mk(id: string, side: "attack" | "defense", zoneId: string, abilityId?: string): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 0, alive: true, weaponId: "Classic",
    skills: AVERAGE_SKILLS, abilities: abilityId ? [{ abilityId, slot: "basic", chargesRemaining: 1, lastUsedAtMs: null }] : [],
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

describe("molly / area-denial as a passable hazard", () => {
  it("exposes an observed molly to the policy, filtered by team sight (DECISION-004)", () => {
    const ae = new AbilityEngine(spatial);
    ae.use(mollySpec, { instanceId: "m1", abilityId: "brimstone:Ability1", ownerId: "x", teamId: "attackers", origin: spatial.getZone("a-site")!.position, startedAtMs: 0 });

    const onSite = mk("atk", "attack", "a-site"); // stands in the mollied zone → sees it
    const stateSee: SimState = { matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000, players: [onSite], spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null } };
    const seeing = buildPolicyView("attack", stateSee, new PerceptionEngine(spatial), sq, null, 0, { abilityEngine: ae });
    expect(seeing.visibleHazards?.some((h) => h.zoneId === "a-site" && h.remainingMs > 0)).toBe(true);

    // a player far away with no sight of a-site does not observe the molly
    const far = mk("atk2", "attack", "attacker-spawn");
    const stateBlind: SimState = { ...stateSee, players: [far] };
    const blind = buildPolicyView("attack", stateBlind, new PerceptionEngine(spatial), sq, null, 0, { abilityEngine: ae });
    expect(blind.visibleHazards?.some((h) => h.zoneId === "a-site")).toBe(false);
  });

  it("deals per-tick damage to someone standing in it (kills a holder over time)", () => {
    // a defender mollies the attacker's zone; the attacker holds there and burns.
    const holdInMolly: DecisionPolicy = { decide: (v: PolicyView): PolicyDecision => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const })) }) };
    const mollyThenHold: DecisionPolicy = {
      decide: (v: PolicyView): PolicyDecision => ({
        strategy: "default", roles: [],
        commands: v.teammates.filter((p) => p.alive).map((p) => v.timeRemainingMs > 59000 ? { playerId: p.id, kind: "useAbility" as const, abilityId: "brimstone:Ability1", targetZone: "a-site" } : { playerId: p.id, kind: "hold" as const }),
      }),
    };
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [mk("atk", "attack", "a-site"), mk("def", "defense", "b-site", "brimstone:Ability1")],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: mollyCatalog,
      policies: { attack: holdInMolly, defense: mollyThenHold },
      config: { seed: 1, roundTimeMs: 20000 },
    }).runRound(state);
    // the attacker standing in the molly dies to it
    expect(r.events.some((e) => e.kind === "kill" && e.target === "atk" && e.detail === "molly")).toBe(true);
    expect(r.winner).toBe("defense");
  });

  it("is deterministic", () => {
    const build = () => new RoundSimulator({
      spatial, weapons, abilities: mollyCatalog,
      policies: {
        attack: { decide: (v) => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const })) }) },
        defense: { decide: (v) => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => v.timeRemainingMs > 59000 ? { playerId: p.id, kind: "useAbility" as const, abilityId: "brimstone:Ability1", targetZone: "a-site" } : { playerId: p.id, kind: "hold" as const }) }) },
      },
      config: { seed: 7, roundTimeMs: 20000 },
    }).runRound({
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [mk("atk", "attack", "a-site"), mk("def", "defense", "b-site", "brimstone:Ability1")],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    });
    expect(build().events).toEqual(build().events);
  });
});
