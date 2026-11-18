import { describe, it, expect } from "vitest";
import { PerceptionEngine, type PlayerState, type WorldState } from "@project-v/perception-engine";
import { AbilityEngine, toPerceptionAbilityStates, visionBlockerIsSmoke } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

const spatial = loadSpatial();

function player(id: string, teamId: string, pos: { x: number; y: number; z: number }, facing: { x: number; y: number }): PlayerState {
  return {
    id, teamId, side: teamId === "attackers" ? "attack" : "defense", agentId: "a",
    position: pos, velocity: { x: 0, y: 0, z: 0 }, facing,
    health: 100, armor: 0, alive: true, weapon: null, behaviorState: "still",
  };
}

function world(players: PlayerState[], activeAbilities: WorldState["activeAbilities"]): WorldState {
  return {
    matchId: "m", roundId: "r", roundNumber: 1, tick: 1, timeRemainingMs: 60000,
    mapId: "ascent", patchVersion: "x", players,
    spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
    activeAbilities, events: [],
  };
}

describe("smoke ↔ perception integration", () => {
  it("blocks line of sight while active and restores it after expiry", () => {
    const obsPos = zonePos(spatial, "a-main");
    const enemyPos = zonePos(spatial, "a-site");
    const observer = player("obs", "attackers", obsPos, { x: enemyPos.x - obsPos.x, y: enemyPos.y - obsPos.y });
    const enemy = player("enemy", "defenders", enemyPos, { x: 1, y: 0 });

    const perception = new PerceptionEngine(spatial, { isSmoke: visionBlockerIsSmoke });
    const abilities = new AbilityEngine(spatial);

    // baseline: no smoke → enemy visible
    const before = perception.observe(world([observer, enemy], []), "obs")!;
    expect(before.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "enemy")).toBe(true);

    // deploy smoke on A site at t=0, duration 15000
    abilities.use(ability("omen:Ability2"), {
      instanceId: "s1", abilityId: "omen:Ability2", ownerId: "obs", teamId: "attackers",
      origin: enemyPos, startedAtMs: 0,
    });
    const smoked = perception.observe(world([observer, enemy], toPerceptionAbilityStates(abilities)), "obs")!;
    expect(smoked.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "enemy")).toBe(false);

    // after expiry → smoke gone → visible again
    abilities.advance(16000);
    const after = perception.observe(world([observer, enemy], toPerceptionAbilityStates(abilities)), "obs")!;
    expect(after.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "enemy")).toBe(true);
  });
});
