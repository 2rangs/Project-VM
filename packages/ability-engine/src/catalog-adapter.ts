import type { AbilitySpec, CatalogEffectRecord, CatalogFacts, EffectType } from "./types.js";

/**
 * The SINGLE place metres → world-units conversion happens (PV-1 catalog uses metres;
 * PV-4 spatial/perception use world units, 100 units = 1 m — see CATALOG.md §3.9).
 */
export const UNITS_PER_METER = 100;

export const metersToUnits = (m: number | null | undefined): number | null =>
  m == null ? null : m * UNITS_PER_METER;

/**
 * Priority order for picking a primary runtime effect when an ability combines several
 * (PV-1 effectTypes is an array, e.g. ["slow","smoke"], ["recon","flash"]). Vision/flash
 * effects dominate dispatch because they gate perception/combat.
 */
const EFFECT_PRIORITY: readonly EffectType[] = [
  "smoke",
  "wall",
  "flash",
  "concuss",
  "recon",
  "molly",
  "trap",
  "slow",
  "decoy",
  "suppress",
  "movement",
  "heal",
];

export function primaryEffect(effectTypes: readonly EffectType[]): EffectType {
  for (const e of EFFECT_PRIORITY) if (effectTypes.includes(e)) return e;
  return effectTypes[0] ?? "decoy";
}

/**
 * Normalise a PV-1 catalog effect record (+ optional facts) into a runtime AbilitySpec.
 * Distances convert metres→units here and nowhere else. `blocksVision` defaults to true
 * for smoke/wall when the catalog leaves it null (those effects occlude by definition).
 */
export function abilitySpecFromCatalog(rec: CatalogEffectRecord, facts: CatalogFacts = {}): AbilitySpec {
  const p = rec.params;
  const effectTypes = rec.effectTypes;
  const effectType = primaryEffect(effectTypes);
  const isOccluder = effectType === "smoke" || effectType === "wall";
  const isFlash = effectTypes.includes("flash") || effectTypes.includes("concuss");
  const isSuppress = effectTypes.includes("suppress");

  return {
    abilityId: rec.abilityId,
    agentId: rec.agentName ?? null,
    name: rec.name,
    slot: rec.slot,
    effectType,
    effectTypes,
    cost: facts.cost ?? null,
    charges: facts.charges ?? null,
    cooldownMs: p.cooldownMs ?? null,
    killRecharge: p.killRecharge ?? null,
    ultPoints: facts.ultPoints ?? null,
    durationMs: p.durationMs ?? null,
    radiusUnits: metersToUnits(p.radiusMeters),
    rangeUnits: metersToUnits(p.rangeMeters),
    wallHp: p.destructibleHp ?? null,
    // flash blind duration: explicit facts override, else the effect's own duration.
    flashDurationMs: facts.flashDurationMs ?? (isFlash ? p.durationMs ?? null : null),
    suppressDurationMs: isSuppress ? p.durationMs ?? null : null,
    windupMs: p.windupMs ?? null,
    revealDurationMs: p.revealDurationMs ?? null,
    blocksVision: p.blocksVision ?? (isOccluder ? true : null),
    makesSound: p.makesSound ?? null,
    provenance: rec.provenance ?? facts.provenance ?? "pv1-catalog",
  };
}
