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

  it("burns someone standing on the patch only for as long as it takes to get off it", () => {
    // A defender mollies the attacker's zone. The fire is a patch (radius 4 m), not the whole
    // zone: the attacker caught on it runs out by the nearest edge — r / v = 400 / 675 s ≈ 0.59 s,
    // six 100 ms ticks at 6 HP — and is then clear of it for the rest of the burn.
    const holdInMolly: DecisionPolicy = { decide: (v: PolicyView): PolicyDecision => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const })) }) };
    const mollyThenHold: DecisionPolicy = {
      decide: (v: PolicyView): PolicyDecision => ({
        strategy: "default", roles: [],
        commands: v.teammates.filter((p) => p.alive).map((p) => v.timeRemainingMs > 59000 ? { playerId: p.id, kind: "useAbility" as const, abilityId: "brimstone:Ability1", targetZone: "a-site" } : { playerId: p.id, kind: "hold" as const }),
      }),
    };
    const centre = spatial.standPosition("a-site");
    const onPatch = { x: centre.x + 1, y: centre.y, z: centre.z };
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      // the attacker stands where the patch will land — the middle of the zone, one step off its
      // callout (a player set down ON a callout is given a covered spot of the zone instead)
      players: [{ ...mk("atk", "attack", "a-site"), position: onPatch }, mk("def", "defense", "b-site", "brimstone:Ability1")],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: mollyCatalog,
      policies: { attack: holdInMolly, defense: mollyThenHold },
      config: { seed: 1, roundTimeMs: 20000 },
    }).runRound(state);
    expect(r.events.some((e) => e.kind === "kill" && e.detail === "molly")).toBe(false);
    expect(state.players.find((p) => p.id === "atk")!.health).toBe(100 - 6 * 6);
    expect(r.reason).toBe("timeExpired"); // nobody died: the patch cost health and position, not the round
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
