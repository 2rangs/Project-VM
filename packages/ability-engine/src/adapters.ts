import type { AbilityState } from "@project-v/perception-engine";
import type { AbilityEngine } from "./engine.js";
import type { RevealSnapshot } from "./types.js";

/**
 * Adapters bridging ability effects into the other engines. They never expose live
 * ground truth: reveals are frozen snapshots, and vision blockers are just origins.
 */

/** Predicate to pass to perception's SpatialPerceptionOracle so smokes AND walls block LoS. */
export const visionBlockerIsSmoke = (a: AbilityState): boolean =>
  a.abilityId === "smoke" || a.abilityId === "wall";

/**
 * Vision-blocking effects (smoke + standing wall) as perception `AbilityState`s. Wire with:
 *   new SpatialPerceptionOracle(spatial, { isSmoke: visionBlockerIsSmoke })
 * and pass these on `world.activeAbilities`.
 */
export function toPerceptionAbilityStates(engine: AbilityEngine): AbilityState[] {
  const out: AbilityState[] = [];
  for (const e of engine.activeEffects()) {
    if (e.effectType !== "smoke" && e.effectType !== "wall") continue;
    out.push({
      instanceId: e.instanceId,
      ownerId: e.ownerId,
      abilityId: e.effectType, // "smoke" | "wall" — matches visionBlockerIsSmoke
      origin: e.origin,
      expiresAtMs: e.expiresAtMs,
    });
  }
  return out;
}

/** Zones denied by active molly/area effects — pass as spatial `PathOptions.blockedZones`. */
export function deniedZoneIds(engine: AbilityEngine): string[] {
  return engine.effectsOfType("molly").map((e) => e.zoneId);
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
