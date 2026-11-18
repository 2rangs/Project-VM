import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, type SpatialEngine } from "@pv/spatial-engine";
import type {
  AbilityState,
  GameEvent,
  PlayerState,
  Vector2,
  Vector3,
  WorldState,
} from "../src/shared-mirror.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const dataDir = resolve(repoRoot, "datasets/spatial/ascent");

export function loadSpatial(): SpatialEngine {
  const nav = JSON.parse(readFileSync(resolve(dataDir, "ascent.navgraph.json"), "utf8"));
  const cs = JSON.parse(readFileSync(resolve(dataDir, "coordinate-system.json"), "utf8"));
  return createEngine(nav, cs.transform);
}

/** Zone center position (real valorant-api coords). */
export function zonePos(spatial: SpatialEngine, zoneId: string): Vector3 {
  const z = spatial.getZone(zoneId);
  if (!z) throw new Error(`no zone ${zoneId}`);
  return { ...z.position };
}

/** A facing direction (XY) pointing from `from` toward `to`. */
export function facingToward(from: Vector3, to: Vector3): Vector2 {
  return { x: to.x - from.x, y: to.y - from.y };
}

let pid = 0;
export function mkPlayer(p: Partial<PlayerState> & { position: Vector3 }): PlayerState {
  return {
    id: p.id ?? `p${pid++}`,
    teamId: p.teamId ?? "attackers",
    side: p.side ?? "attack",
    agentId: p.agentId ?? "jett",
    position: p.position,
    velocity: p.velocity ?? { x: 0, y: 0, z: 0 },
    facing: p.facing ?? { x: 1, y: 0 },
    health: p.health ?? 100,
    armor: p.armor ?? 0,
    alive: p.alive ?? true,
    weapon: p.weapon ?? null,
    behaviorState: p.behaviorState ?? "still",
  };
}

export function mkWorld(players: PlayerState[], p: Partial<WorldState> = {}): WorldState {
  return {
    matchId: p.matchId ?? "m1",
    roundId: p.roundId ?? "r1",
    roundNumber: p.roundNumber ?? 1,
    tick: p.tick ?? 10,
    timeRemainingMs: p.timeRemainingMs ?? 60000,
    mapId: p.mapId ?? "ascent",
    patchVersion: p.patchVersion ?? "UNVERIFIED",
    players,
    spike: p.spike ?? { phase: "carried", position: null, holderId: null, detonationInMs: null },
    activeAbilities: p.activeAbilities ?? [],
    events: p.events ?? [],
  };
}

export function smoke(origin: Vector3, abilityId = "jett_smoke"): AbilityState {
  return { instanceId: "s1", ownerId: "x", abilityId, origin, expiresAtMs: null };
}

export function gunfireEvent(tick: number, killer: string, victim: string): GameEvent {
  return { id: "e1", seq: 1, tick, timeMs: 0, kind: "kill", killer, victim, assists: [], cause: "weapon", weaponId: "vandal" };
}
