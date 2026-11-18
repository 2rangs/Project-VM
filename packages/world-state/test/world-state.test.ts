import { describe, it, expect } from "vitest";
import {
  createWorldState,
  createPlayerState,
  getPlayer,
  patchPlayer,
  advanceTick,
  appendEvents,
  killPlayer,
  serializeWorld,
  deserializeWorld,
  observeWorld,
  healthBand,
  BLIND_ORACLE,
  type VisibilityOracle,
} from "@pv/world-state";
import {
  asAgentId,
  asEventId,
  asMapId,
  asMatchId,
  asPatchVersion,
  asPlayerId,
  asRoundId,
  asTeamId,
  vec3,
  type GameEvent,
  type PlayerState,
  type WorldState,
} from "@pv/shared-types";

const TEAM_A = asTeamId("team-a");
const TEAM_B = asTeamId("team-b");

function buildWorld(): WorldState {
  const attacker = createPlayerState({
    id: asPlayerId("a1"),
    teamId: TEAM_A,
    side: "attack",
    agentId: asAgentId("jett"),
    position: vec3(0, 0, 0),
    health: 100,
  });
  const defender = createPlayerState({
    id: asPlayerId("d1"),
    teamId: TEAM_B,
    side: "defense",
    agentId: asAgentId("sage"),
    position: vec3(100, 50, 0),
    health: 40,
  });
  return createWorldState({
    matchId: asMatchId("m-001"),
    roundId: asRoundId("m-001:r-17"),
    roundNumber: 17,
    mapId: asMapId("ascent"),
    patchVersion: asPatchVersion("synthetic-0"),
    players: [attacker, defender],
    timeRemainingMs: 100_000,
  });
}

describe("createWorldState / createPlayerState", () => {
  it("fills defaults and freezes the result (immutability)", () => {
    const world = buildWorld();
    expect(world.tick).toBe(0);
    expect(world.spike.phase).toBe("carried");
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(world.players)).toBe(true);
    const a1 = getPlayer(world, asPlayerId("a1"))!;
    expect(a1.health).toBe(100);
    expect(() => {
      // @ts-expect-error -- deliberately mutating a frozen readonly field
      a1.health = 1;
    }).toThrow();
  });
});

describe("immutable updates (DECISION-010)", () => {
  it("patchPlayer returns a new world and leaves the original untouched", () => {
    const world = buildWorld();
    const next = patchPlayer(world, asPlayerId("d1"), { health: 10 });
    expect(next).not.toBe(world);
    expect(getPlayer(next, asPlayerId("d1"))!.health).toBe(10);
    expect(getPlayer(world, asPlayerId("d1"))!.health).toBe(40); // original preserved
  });

  it("advanceTick increments tick and decrements remaining time", () => {
    const world = buildWorld();
    const next = advanceTick(world, 50);
    expect(next.tick).toBe(1);
    expect(next.timeRemainingMs).toBe(99_950);
    expect(world.tick).toBe(0);
  });

  it("appendEvents extends the log immutably", () => {
    const world = buildWorld();
    const ev: GameEvent = {
      kind: "roundStart",
      id: asEventId("rs"),
      seq: 0,
      tick: 0,
      timeMs: 0,
      roundNumber: 17,
    };
    const next = appendEvents(world, [ev]);
    expect(next.events).toHaveLength(1);
    expect(world.events).toHaveLength(0);
  });

  it("killPlayer marks a player dead", () => {
    const world = buildWorld();
    const next = killPlayer(world, asPlayerId("d1"));
    expect(getPlayer(next, asPlayerId("d1"))!.alive).toBe(false);
    expect(getPlayer(next, asPlayerId("d1"))!.health).toBe(0);
  });
});

describe("serialization round-trip (Handoff §24.4)", () => {
  it("deserialize(serialize(w)) deep-equals w", () => {
    const world = buildWorld();
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  it("rejects an unknown schema version", () => {
    expect(() => deserializeWorld(JSON.stringify({ schemaVersion: 999, world: {} }))).toThrow();
  });
});

describe("World->Observation boundary (DECISION-004, README §29)", () => {
  it("the blind default oracle reveals no enemies", () => {
    const world = buildWorld();
    const obs = observeWorld(world, asPlayerId("a1"), { oracle: BLIND_ORACLE });
    expect(obs.visibleEnemies).toHaveLength(0);
  });

  it("an oracle with line of sight reveals only enemies, as coarse ObservedEnemy", () => {
    const seeingOracle: VisibilityOracle = {
      canSee: (observer: PlayerState, target: PlayerState) =>
        observer.id === asPlayerId("a1") && target.id === asPlayerId("d1"),
    };
    const world = buildWorld();
    const obs = observeWorld(world, asPlayerId("a1"), { oracle: seeingOracle });
    expect(obs.visibleEnemies).toHaveLength(1);
    const enemy = obs.visibleEnemies[0]!;
    expect(enemy.playerId).toBe("d1");
    // Coarse health band, never the exact 40 HP ground truth.
    expect(enemy.healthBand).toBe("low");
    expect(enemy.currentlyVisible).toBe(true);
    // The observed shape has no `health`/`inventory`/`velocity` fields at all.
    expect(Object.keys(enemy)).not.toContain("health");
    expect(Object.keys(enemy)).not.toContain("inventory");
  });

  it("never reports teammates as observed enemies", () => {
    const seesEveryone: VisibilityOracle = { canSee: () => true };
    const world = buildWorld();
    const obs = observeWorld(world, asPlayerId("a1"), { oracle: seesEveryone });
    // a1 is on TEAM_A; only d1 (TEAM_B) can be an observed enemy.
    expect(obs.visibleEnemies.map((e) => e.playerId)).toEqual(["d1"]);
  });

  it("throws for an unknown observer", () => {
    const world = buildWorld();
    expect(() => observeWorld(world, asPlayerId("ghost"))).toThrow();
  });
});

describe("healthBand", () => {
  it("maps HP to coarse bands", () => {
    expect(healthBand(100)).toBe("full");
    expect(healthBand(60)).toBe("hurt");
    expect(healthBand(20)).toBe("low");
    expect(healthBand(0)).toBe("unknown");
  });
});
