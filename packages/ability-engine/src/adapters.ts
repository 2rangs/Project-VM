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
