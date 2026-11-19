import type { AbilityState } from "@pv/perception-engine";
import type { AbilityEngine } from "./engine.js";
import type { RevealSnapshot } from "./types.js";

/**
 * Adapters bridging ability effects into the other engines. They never expose live
 * ground truth: reveals are frozen snapshots, and vision blockers are just origins.
 */

/** Predicate to pass to perception's SpatialPerceptionOracle so vision-blockers occlude LoS. */
export const visionBlockerIsSmoke = (a: AbilityState): boolean =>
  a.abilityId === "smoke" || a.abilityId === "wall";

/**
 * Vision-blocking effects (any effect with blocksVision, i.e. smokes + standing walls) as
 * perception `AbilityState`s. Wire with:
 *   new SpatialPerceptionOracle(spatial, { isSmoke: visionBlockerIsSmoke })
 * and pass these on `world.activeAbilities`. abilityId is set to the occluder kind so the
 * predicate matches regardless of the ability's other effect types (e.g. slow+smoke).
 */
export function toPerceptionAbilityStates(engine: AbilityEngine): AbilityState[] {
  const out: AbilityState[] = [];
  for (const e of engine.activeEffects()) {
    if (!e.blocksVision) continue;
    out.push({
      instanceId: e.instanceId,
      ownerId: e.ownerId,
      abilityId: e.effectType === "wall" ? "wall" : "smoke", // matches visionBlockerIsSmoke
      origin: e.origin,
      expiresAtMs: e.expiresAtMs,
    });
  }
  return out;
}

/** Zones with active molly/area-denial — used for per-tick damage to anyone standing in them. */
export function deniedZoneIds(engine: AbilityEngine): string[] {
  return engine.effectsOfType("molly").map((e) => e.zoneId);
}

/**
 * Active molly/area-denial zones with their remaining lifetime (ms). Passable HAZARDS: the
 * round-simulator turns these into pathfinding costs (detour-worthiness that shrinks as the
 * effect expires) and exposes the observable ones to policies — they are not full blocks.
 */
export function activeAreaDenials(engine: AbilityEngine, nowMs: number): { zoneId: string; remainingMs: number }[] {
  return engine.effectsOfType("molly").map((e) => ({
    zoneId: e.zoneId,
    remainingMs: e.expiresAtMs != null ? Math.max(0, e.expiresAtMs - nowMs) : Number.POSITIVE_INFINITY,
  }));
}

/**
 * A ground patch (molly / area-denial, or a slow field): a disc of `radiusUnits` centred on the
 * effect's origin, inside `zoneId`. The round-simulator derives exposure from the disc's geometry
 * (how long a body needs to leave or cross it) — the patch is NOT the whole zone.
 */
export interface GroundPatch {
  readonly instanceId: string;
  readonly abilityId: string;
  readonly effectType: "molly" | "slow";
  readonly zoneId: string;
  /**
   * The neighbouring zone whose doorway with `zoneId` the patch lies on, or null when it lies in
   * the middle of the zone. A doorway patch is crossed by whoever passes between the two zones; a
   * mid-zone patch by whoever stands on it or travels through the zone.
   */
  readonly doorToZoneId: string | null;
  readonly teamId: string;
  /** 0 when the catalog has no radius (the caller applies its own documented default). */
  readonly radiusUnits: number;
  readonly startedAtMs: number;
  readonly remainingMs: number;
}

/** Active ground patches of one kind, in deployment order (deterministic). */
export function activeGroundPatches(engine: AbilityEngine, kind: "molly" | "slow", nowMs: number): GroundPatch[] {
  return engine.effectsOfType(kind).map((e) => ({
    instanceId: e.instanceId,
    abilityId: e.abilityId,
    effectType: kind,
    zoneId: e.zoneId,
    doorToZoneId: e.doorToZoneId,
    teamId: e.teamId,
    radiusUnits: e.radiusUnits,
    startedAtMs: e.startedAtMs,
    remainingMs: e.expiresAtMs != null ? Math.max(0, e.expiresAtMs - nowMs) : Number.POSITIVE_INFINITY,
  }));
}

/** Effect kinds that stand in the world where anyone with a sightline can SEE them. */
const WORLD_VISIBLE: ReadonlySet<string> = new Set(["smoke", "wall", "molly", "slow"]);

/** An active effect as a fact about the map (what is deployed where, by whom, for how long). */
export interface DeployedEffect {
  readonly instanceId: string;
  readonly abilityId: string;
  readonly effectType: string;
  readonly zoneId: string;
  /** Centre of the effect (for a placed ability, the centre of the zone it was placed on). */
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly teamId: string;
  readonly ownerId: string;
  readonly startedAtMs: number;
  readonly remainingMs: number;
  /** True for effects that occupy space visibly (smoke, wall, fire, slow field). */
  readonly worldVisible: boolean;
}

/** Every active effect, in deployment order. Callers filter by `worldVisible` / team for observation. */
export function deployedEffects(engine: AbilityEngine, nowMs: number): DeployedEffect[] {
  return engine.activeEffects().map((e) => ({
    instanceId: e.instanceId,
    abilityId: e.abilityId,
    effectType: e.effectType,
    zoneId: e.zoneId,
    origin: e.origin,
    teamId: e.teamId,
    ownerId: e.ownerId,
    startedAtMs: e.startedAtMs,
    remainingMs: e.expiresAtMs != null ? Math.max(0, e.expiresAtMs - nowMs) : Number.POSITIVE_INFINITY,
    worldVisible: WORLD_VISIBLE.has(e.effectType),
  }));
}

/** Zones whose incident (smokeable) sightlines are currently cut by a vision blocker. */
export function visionBlockedZones(engine: AbilityEngine): string[] {
  return engine.activeEffects().filter((e) => e.blocksVision).map((e) => e.zoneId);
}

/** All currently-active reveal snapshots (recon + triggered traps), frozen at reveal time. */
export function revealedEnemies(engine: AbilityEngine): RevealSnapshot[] {
  const out: RevealSnapshot[] = [];
  for (const e of engine.activeEffects()) {
    if (e.effectType === "recon" || e.effectType === "trap") out.push(...e.reveals);
  }
  return out;
}

/** flashBlindMs to drop into a combat `EngagePosture` for a player. */
export function combatFlashBlindMs(engine: AbilityEngine, playerId: string, nowMs: number): number {
  return engine.blindRemainingMs(playerId, nowMs);
}
