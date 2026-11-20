import { describe, it, expect } from "vitest";
import { PerceptionEngine, type AbilityState } from "@pv/perception-engine";
import { AbilityEngine, abilitySpecFromCatalog, visionBlockerIsSmoke } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { buildPolicyView, SpatialQueryAdapter, type SimPlayer, type SimState } from "../src/index.js";
import { loadSpatial, scenePos } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = new SpatialQueryAdapter(spatial);

function mk(id: string, side: "attack" | "defense", zoneId: string, facing = { x: 1, y: 0 }): SimPlayer {
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...scenePos(spatial, zoneId) }, zoneId, facing, health: 100, armor: 0, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

function scene(): { state: SimState; perception: PerceptionEngine } {
  const obs = spatial.getZone("a-main")!.position;
  const enemy = spatial.getZone("a-site")!.position;
  const atk = mk("atk", "attack", "a-main", { x: enemy.x - obs.x, y: enemy.y - obs.y });
  const def = mk("def", "defense", "a-site");
  const state: SimState = {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
    players: [atk, def],
    spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
  return { state, perception: new PerceptionEngine(spatial, { isSmoke: visionBlockerIsSmoke }) };
}

describe("abilities affect the round", () => {
  it("a smoke on the site blocks the attacker's line of sight in decisions", () => {
    const { state, perception } = scene();
    const clear = buildPolicyView("attack", state, perception, sq);
    expect(clear.observation.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "def")).toBe(true);

    const smoke: AbilityState = { instanceId: "s1", ownerId: "x", abilityId: "smoke", origin: spatial.getZone("a-site")!.position, expiresAtMs: null };
    const smoked = buildPolicyView("attack", state, perception, sq, null, 0, { activeAbilities: [smoke] });
    expect(smoked.observation.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "def")).toBe(false);
  });

  it("a recon reveal injects a (non-live) enemy snapshot into the team picture", () => {
    const { state, perception } = scene();
    const ability = new AbilityEngine(spatial);
    const recon = abilitySpecFromCatalog(
      { abilityId: "sova:Ability2", slot: "Ability2", name: "Recon Bolt", effectTypes: ["recon"], params: { radiusMeters: 25, durationMs: 3000, makesSound: true } },
      { cost: 400, charges: 1 },
    );
    const revealPos = spatial.getZone("b-site")!.position;
    ability.use(recon, { instanceId: "r1", abilityId: "sova:Ability2", ownerId: "atk", teamId: "attackers", origin: revealPos, startedAtMs: 0 },
      { snapshotEnemies: [{ enemyId: "ghost", teamId: "defenders", position: revealPos }] });

    const view = buildPolicyView("attack", state, perception, sq, null, 0, { abilityEngine: ability });
    const ghost = view.observation.visibleEnemies.find((e) => e.playerId === "ghost");
    expect(ghost).toBeDefined();
    expect(ghost!.currentlyVisible).toBe(false); // revealed, not live-tracked
    expect(ghost!.lastSeenPosition.x).toBeCloseTo(revealPos.x, 3);
  });
});
