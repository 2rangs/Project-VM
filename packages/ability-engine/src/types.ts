// PROJECT V — ability-engine local types.
//
// Effect vocabulary aligns with PV-1's catalog `gameplay.typeTags`
// (datasets/catalog/schema/ability.schema.json on claude/pv-research):
// smoke | flash | recon | molly | wall | concuss | slow | trap | decoy ...
// PV-1's runtime `ability-effect.schema.json` is not published yet; these are LOCAL
// definitions. Divergences are recorded in docs/handoffs/PV-4-spatial.md §C so PV-1 can
// reconcile. Candidate to move into @pv/shared-types later.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type AbilitySlot = "Ability1" | "Ability2" | "Grenade" | "Ultimate" | "Passive";

/**
 * Runtime effect kinds. Vocabulary matches PV-1's ability-effect.schema.json
 * `effectTypes` enum (claude/pv-research): smoke | flash | concuss | recon | molly |
 * wall | slow | heal | trap | decoy | movement | suppress.
 */
export type EffectType =
  | "smoke" // blocks line of sight in a zone/volume for a duration
  | "wall" // temporary LoS block with destructible HP
  | "flash" // blinds targets in sight → combat reaction delay
  | "concuss" // slows reaction/aim in an area (like a soft flash)
  | "recon" // reveals enemies in range — SNAPSHOT at trigger, not live
  | "molly" // area denial: damage + path cost in a zone
  | "slow" // movement slow zone
  | "heal" // restores health (ally-affecting)
  | "trap" // tripwire/trap: reveals (snapshot) when triggered
  | "decoy" // fake sound/vision info to support fakes (Handoff §14.2)
  | "movement" // dash/teleport/displacement
  | "suppress"; // disables enemy abilities (KAY/O)

/**
 * A usable ability definition in RUNTIME units (world units = metres × 100). Produced
 * from PV-1's catalog records via `abilitySpecFromCatalog` (catalog-adapter.ts), the
 * single place metres → world-units conversion happens.
 */
export interface AbilitySpec {
  readonly abilityId: string; // "<agent-slug>:<slot>", joins PV-1 abilities.json
  readonly agentId?: string | null;
  readonly name: string;
  readonly slot: AbilitySlot;
  /** Primary effect for runtime dispatch (first of effectTypes by priority). */
  readonly effectType: EffectType;
  /** Full effect set (PV-1 effectTypes[]); an ability may combine effects (e.g. slow+smoke). */
  readonly effectTypes: readonly EffectType[];
  readonly cost: number | null; // credits
  readonly charges: number | null; // max charges
  readonly cooldownMs: number | null;
  readonly killRecharge: boolean | null;
  readonly ultPoints: number | null; // Ultimate only
  readonly durationMs: number | null;
  readonly radiusUnits: number | null; // effect radius (WORLD UNITS)
  readonly rangeUnits: number | null; // max cast/throw distance (WORLD UNITS)
  readonly wallHp: number | null; // destructible HP (PV-1 destructibleHp)
  readonly flashDurationMs: number | null; // blind duration applied to combat
  readonly suppressDurationMs: number | null; // ability-silence duration (suppress: KAY/O, Killjoy ult)
  readonly revealDurationMs: number | null; // recon reveal duration
  /** Occludes sightlines (PV-1 blocksVision); drives perception smokedPairs. */
  readonly blocksVision: boolean | null;
  /** Emits cast audio (PV-1 makesSound); feeds perception abilityCast sound. */
  readonly makesSound: boolean | null;
  readonly provenance: string;
}

// ---- PV-1 catalog record shapes (claude/pv-research ability-effect.schema.json) ----
// These mirror PV-1's on-disk shape (distances in METRES). Convert with
// `abilitySpecFromCatalog` (catalog-adapter.ts) — the single metres→world-units site.

export interface CatalogEffectParams {
  readonly windupMs?: number | null;
  readonly deployTimeMs?: number | null;
  readonly rangeMeters?: number | null;
  readonly radiusMeters?: number | null;
  readonly durationMs?: number | null;
  readonly cooldownMs?: number | null;
  readonly killRecharge?: boolean | null;
  readonly revealDurationMs?: number | null;
  readonly damage?: number | null;
  readonly destructible?: boolean | null;
  readonly destructibleHp?: number | null;
  readonly blocksVision?: boolean | null;
  readonly affectsAllies?: boolean | null;
  readonly makesSound?: boolean | null;
  readonly defaultKeybind?: string | null;
}

export interface CatalogEffectRecord {
  readonly abilityId: string;
  readonly agentName?: string;
  readonly slot: AbilitySlot;
  readonly name: string;
  readonly effectTypes: readonly EffectType[];
  readonly params: CatalogEffectParams;
  readonly verified?: boolean;
  readonly provenance?: string;
}

/** Facts (charges/cost/ultPoints) from PV-1 ability_facts.json, joined by abilityId. */
export interface CatalogFacts {
  readonly cost?: number | null;
  readonly charges?: number | null;
  readonly ultPoints?: number | null;
  readonly flashDurationMs?: number | null;
  readonly provenance?: string;
}

/** A request to deploy an ability instance into the world. */
export interface AbilityUsage {
  readonly instanceId: string;
  readonly abilityId: string;
  readonly ownerId: string;
  readonly teamId: string;
  readonly origin: Vec3;
  readonly startedAtMs: number;
  /** Targets caught by flash/concuss/reveal, if the caller resolved them (see adapters). */
  readonly affectedPlayerIds?: readonly string[];
}

/** A snapshot of an enemy revealed by recon/trap — frozen at reveal time (no live updates). */
export interface RevealSnapshot {
  readonly enemyId: string;
  readonly teamId: string;
  readonly position: Vec3; // position AT reveal time, never updated afterwards
  readonly revealedAtMs: number;
  readonly byAbilityId: string;
}

/** A live effect object in the world. */
export interface ActiveEffect {
  readonly instanceId: string;
  readonly abilityId: string;
  readonly effectType: EffectType;
  readonly ownerId: string;
  readonly teamId: string;
  readonly origin: Vec3;
  readonly zoneId: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number | null; // null = until destroyed/manual
  readonly radiusUnits: number;
  hp: number | null; // wall HP; null if not destructible
  destroyed: boolean;
  /** Blind duration applied to affected players (flash/concuss). */
  readonly flashDurationMs: number;
  /** Whether this effect occludes sightlines (PV-1 blocksVision). */
  readonly blocksVision: boolean;
  /** Enemies revealed by this effect (recon/trap), captured at trigger. */
  readonly reveals: readonly RevealSnapshot[];
}

export type AbilityEventKind =
  | "effectStart"
  | "effectExpire"
  | "effectDestroyed"
  | "flashApplied"
  | "suppressApplied"
  | "reveal"
  | "trapTriggered";

export interface AbilityEvent {
  readonly kind: AbilityEventKind;
  readonly timeMs: number;
  readonly instanceId: string;
  readonly abilityId: string;
  readonly effectType: EffectType;
  readonly targetId?: string;
}

// ---- Availability (for PV-3 Action Generator constraint validation) ----

/** A player's current ability resources for one ability. */
export interface AbilityLoadoutEntry {
  readonly abilityId: string;
  readonly chargesRemaining: number;
  /** ms since round start when this ability was last used, or null if not used. */
  readonly lastUsedAtMs: number | null;
}

export interface UltimateStatus {
  readonly points: number;
  readonly required: number;
}

export interface AvailabilityResult {
  readonly usable: boolean;
  readonly reason:
    | "ok"
    | "no-charges"
    | "on-cooldown"
    | "ult-not-ready"
    | "unknown-ability";
  /** ms until usable again (cooldown), when reason is "on-cooldown". */
  readonly cooldownRemainingMs?: number;
}
