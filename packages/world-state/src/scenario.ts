/**
 * Scenario / DecisionContext loader (TASK 006 — 경기 상태 복원).
 *
 * Loads PV-2's external DecisionContext JSON (datasets/schema/world-state.schema.json)
 * into the internal, typed {@link TeamDecisionContext}: a ground-truth WorldState plus the
 * deciding team's perceived Observation/Belief and retained provenance. Includes:
 *   - structural + enum + range validation mirroring the JSON Schema (no runtime dep;
 *     the enum constants are cross-checked against the schema files in a drift-guard test),
 *   - unit/field mapping (teamIdx→TeamId, minimapUnits vector2→Vector3, facingDeg→unit
 *     vector, spike status→SpikePhase, loadout→inventory/abilities),
 *   - provenance retention (synthetic flag preserved and surfaced).
 *
 * The produced WorldState is a plain frozen value, so serialize/deserialize round-trips
 * deterministically via serializeWorld/deserializeWorld.
 *
 * MAPPING NOTE (see docs/handoffs/PV-3-core.md phase-2): scenario positions are
 * minimapUnits (2D). The loaded WorldState carries them as Vector3 with z=0 and the
 * context's `coordinateSpace` is "minimapUnits"; conversion to game-world units is the
 * spatial adapter's job at final integration.
 */
import {
  asAbilityId,
  asAgentId,
  asMapId,
  asMatchId,
  asPatchVersion,
  asPlayerId,
  asRoundId,
  asTeamId,
  asWeaponId,
  type AbilityChargeState,
  type AbilityInventory,
  type ArmorType,
  type BeliefState,
  type EnemyPositionBelief,
  type InventoryState,
  type ObservationState,
  type ObservedEnemy,
  type PlayerState,
  type ScenarioProvenance,
  type Side,
  type SoundObservation,
  type SpikePhase,
  type SpikeState,
  type TacticalHypothesis,
  type TacticalIntent,
  type TeamDecisionContext,
  type TeamEconomyState,
  type TeamId,
  type Vector2,
  type Vector3,
  type WorldState,
} from "@pv/shared-types";
import { createWorldState } from "./create.js";

/** Enum sets mirrored from the PV-2 JSON Schemas; verified by a drift-guard test. */
export const SCENARIO_ENUMS = {
  mapName: [
    "Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven",
    "Icebox", "Lotus", "Pearl", "Split", "Summit", "Sunset",
  ],
  roundPhase: ["buy", "round", "post_plant"],
  spikeStatus: ["carried", "dropped", "planted", "defused", "detonated"],
  armorKind: ["none", "light", "heavy", "regen"],
  evidenceType: ["observed", "decoded", "derived", "inferred", "simulated"],
  soundKind: ["footsteps", "gunfire", "ability", "plant", "defuse"],
} as const;

export class ScenarioValidationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`DecisionContext failed validation:\n - ${problems.join("\n - ")}`);
    this.name = "ScenarioValidationError";
    this.problems = problems;
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Validate a raw DecisionContext against the schema's required fields, enums and ranges.
 * Returns a (possibly empty) list of human-readable problems rather than throwing.
 */
export function validateDecisionContext(raw: unknown): string[] {
  const problems: string[] = [];
  const req = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
  };

  if (!isObj(raw)) return ["root is not an object"];
  req(isStr(raw["contextId"]), "contextId must be a string");
  req(raw["decidingTeamIdx"] === 0 || raw["decidingTeamIdx"] === 1, "decidingTeamIdx must be 0 or 1");
  req(isObj(raw["provenance"]), "provenance must be an object");
  if (isObj(raw["provenance"])) {
    const p = raw["provenance"];
    req(isStr(p["sourceId"]), "provenance.sourceId must be a string");
    req(isStr(p["retrievedAt"]), "provenance.retrievedAt must be a string");
    req(
      isStr(p["evidenceType"]) && SCENARIO_ENUMS.evidenceType.includes(p["evidenceType"] as never),
      "provenance.evidenceType must be a valid evidence type",
    );
    req(isBool(p["synthetic"]), "provenance.synthetic must be a boolean");
  }

  const w = raw["worldState"];
  if (!isObj(w)) {
    problems.push("worldState must be an object");
    return problems;
  }
  req(isStr(w["matchId"]), "worldState.matchId must be a string");
  req(isStr(w["roundId"]), "worldState.roundId must be a string");
  req(
    isStr(w["mapName"]) && SCENARIO_ENUMS.mapName.includes(w["mapName"] as never),
    "worldState.mapName must be a valid map name",
  );
  req(isNum(w["timeRemainingMs"]) && (w["timeRemainingMs"] as number) >= 0, "worldState.timeRemainingMs must be >= 0");
  req(
    isStr(w["roundPhase"]) && SCENARIO_ENUMS.roundPhase.includes(w["roundPhase"] as never),
    "worldState.roundPhase must be buy|round|post_plant",
  );
  const players = w["players"];
  req(Array.isArray(players) && players.length >= 1 && players.length <= 10, "worldState.players must have 1..10 entries");
  if (Array.isArray(players)) {
    players.forEach((p, i) => {
      if (!isObj(p)) {
        problems.push(`players[${i}] must be an object`);
        return;
      }
      req(isStr(p["playerId"]), `players[${i}].playerId must be a string`);
      req(p["teamIdx"] === 0 || p["teamIdx"] === 1, `players[${i}].teamIdx must be 0 or 1`);
      req(isBool(p["alive"]), `players[${i}].alive must be a boolean`);
      if (p["position"] !== null && p["position"] !== undefined) {
        const pos = p["position"];
        req(isObj(pos) && isNum((pos as Json)["x"]) && isNum((pos as Json)["y"]), `players[${i}].position must be {x,y}`);
      }
      if (p["health"] != null) req(isNum(p["health"]) && (p["health"] as number) >= 0 && (p["health"] as number) <= 100, `players[${i}].health must be 0..100`);
    });
  }
  const spike = w["spike"];
  req(isObj(spike), "worldState.spike must be an object");
  if (isObj(spike)) {
    req(
      isStr(spike["status"]) && SCENARIO_ENUMS.spikeStatus.includes(spike["status"] as never),
      "worldState.spike.status must be a valid status",
    );
  }
  return problems;
}

// ---- field mapping helpers ----

const teamIdFor = (idx: number): TeamId => asTeamId(`team-${idx}`);

const vec2ToVec3 = (v: { x: number; y: number } | null | undefined): Vector3 =>
  v ? { x: v.x, y: v.y, z: 0 } : { x: 0, y: 0, z: 0 };

/** Convert a compass-ish facing in degrees to a unit vector in the minimap frame. */
function facingFromDeg(deg: number | null | undefined): Vector2 {
  const rad = ((deg ?? 0) * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

function armorTypeOf(kind: unknown): ArmorType {
  return isStr(kind) && SCENARIO_ENUMS.armorKind.includes(kind as never) ? (kind as ArmorType) : "none";
}

function buildAbilities(agentId: string, loadout: Json): AbilityInventory {
  const charges = isObj(loadout["abilityCharges"]) ? (loadout["abilityCharges"] as Record<string, unknown>) : {};
  const basic: AbilityChargeState[] = [];
  for (const [slot, n] of Object.entries(charges)) {
    if (slot === "x") continue; // x handled as ultimate below
    if (isNum(n)) basic.push({ abilityId: asAbilityId(`${agentId}:${slot}`), charges: n });
  }
  const points = isNum(loadout["ultimatePoints"]) ? (loadout["ultimatePoints"] as number) : 0;
  const required = isNum(loadout["ultimateCost"]) ? (loadout["ultimateCost"] as number) : 7;
  return {
    basic,
    signature: null, // slot→signature mapping is agent-specific; left null in v0 (see handoff)
    ultimate: { abilityId: asAbilityId(`${agentId}:x`), points, required, ready: points >= required },
  };
}

function buildPlayer(raw: Json, attackingTeamIdx: number): PlayerState {
  const teamIdx = raw["teamIdx"] as number;
  const agentIdStr = isStr(raw["agentId"]) ? (raw["agentId"] as string) : "unknown";
  const loadout = isObj(raw["loadout"]) ? (raw["loadout"] as Json) : {};
  const side: Side = teamIdx === attackingTeamIdx ? "attack" : "defense";
  const armorPoints = isNum(raw["armor"]) ? (raw["armor"] as number) : 0;
  const weaponId = isStr(loadout["weaponId"]) ? (loadout["weaponId"] as string) : null;
  const inventory: InventoryState = {
    primary: weaponId ? { weaponId: asWeaponId(weaponId), magazine: 0, reserve: 0 } : null,
    secondary: null,
    armor: { type: armorTypeOf(loadout["armor"]), points: armorPoints },
    hasSpike: false, // set later from spike.carrierPlayerId
  };
  return {
    id: asPlayerId(raw["playerId"] as string),
    teamId: teamIdFor(teamIdx),
    side,
    agentId: asAgentId(agentIdStr),
    position: vec2ToVec3(raw["position"] as { x: number; y: number } | null),
    velocity: { x: 0, y: 0, z: 0 },
    facing: facingFromDeg(raw["facingDeg"] as number | null),
    health: isNum(raw["health"]) ? (raw["health"] as number) : 100,
    armor: armorPoints,
    alive: raw["alive"] === true,
    weapon: weaponId ? { weaponId: asWeaponId(weaponId), magazine: 0, reserve: 0 } : null,
    inventory,
    abilities: buildAbilities(agentIdStr, loadout),
    credits: isNum(loadout["credits"]) ? (loadout["credits"] as number) : 0,
    ultimatePoints: isNum(loadout["ultimatePoints"]) ? (loadout["ultimatePoints"] as number) : 0,
    behaviorState: raw["alive"] === true ? "idle" : "dead",
    currentOrderId: null,
  };
}

function buildSpike(raw: Json): SpikeState {
  const statusMap: Record<string, SpikePhase> = {
    carried: "carried",
    dropped: "dropped",
    planted: "planted",
    defused: "defused",
    detonated: "detonated",
  };
  const status = raw["status"] as string;
  const holder = isStr(raw["carrierPlayerId"]) ? asPlayerId(raw["carrierPlayerId"] as string) : null;
  return {
    phase: statusMap[status] ?? "carried",
    position: raw["pos"] ? vec2ToVec3(raw["pos"] as { x: number; y: number }) : null,
    holderId: holder,
    detonationInMs: isNum(raw["timeUntilDetonationMs"]) ? (raw["timeUntilDetonationMs"] as number) : null,
  };
}

function buildEconomy(raw: unknown, attackingTeamIdx: number): TeamEconomyState[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((e) => {
    const teamIdx = e["teamIdx"] as number;
    const tier = isNum(e["lossBonusTier"]) ? (e["lossBonusTier"] as number) : 0;
    return {
      teamId: teamIdFor(teamIdx),
      side: (teamIdx === attackingTeamIdx ? "attack" : "defense") as Side,
      credits: isNum(e["bank"]) ? (e["bank"] as number) : 0,
      lossBonusTier: tier,
      consecutiveLosses: tier, // derived approximation; see handoff mapping note
    };
  });
}

const INTENT_KEYWORDS: ReadonlyArray<readonly [RegExp, TacticalIntent]> = [
  [/\ba\b|a site|a main|a execute/i, "aExecute"],
  [/\bb\b|b site|b main|b execute/i, "bExecute"],
  [/mid/i, "midControl"],
  [/rotat/i, "rotate"],
  [/fake/i, "fake"],
  [/retake/i, "retake"],
  [/save|eco/i, "save"],
];

function intentOf(hypothesis: string): TacticalIntent {
  for (const [re, intent] of INTENT_KEYWORDS) if (re.test(hypothesis)) return intent;
  return "unknown";
}

/**
 * Build the deciding team's ObservationState and a seed BeliefState from the scenario's
 * `belief` block. Enemy info here is observed/inferred only (DECISION-004); it is NEVER
 * taken from worldState ground truth.
 */
function buildPerception(
  belief: Json | undefined,
  decidingTeamId: TeamId,
  observerId: ReturnType<typeof asPlayerId>,
  nowMs: number,
): { observation: ObservationState; belief: BeliefState } {
  const visibleRaw = Array.isArray(belief?.["visibleEnemies"]) ? (belief!["visibleEnemies"] as Json[]) : [];
  const soundsRaw = Array.isArray(belief?.["heardSounds"]) ? (belief!["heardSounds"] as Json[]) : [];
  const hypoRaw = Array.isArray(belief?.["tacticalHypotheses"]) ? (belief!["tacticalHypotheses"] as Json[]) : [];

  const visibleEnemies: ObservedEnemy[] = visibleRaw.filter(isObj).map((e) => {
    const msAgo = isNum(e["lastSeenMsAgo"]) ? (e["lastSeenMsAgo"] as number) : null;
    return {
      playerId: asPlayerId(e["playerId"] as string),
      agentId: null,
      lastSeenPosition: vec2ToVec3(e["lastKnownPos"] as { x: number; y: number } | null),
      lastSeenAtMs: msAgo == null ? nowMs : nowMs - msAgo,
      healthBand: "unknown",
      observedWeaponId: null,
      currentlyVisible: (msAgo ?? Infinity) <= 0,
    };
  });

  const soundKindMap: Record<string, SoundObservation["kind"]> = {
    footsteps: "footstep",
    gunfire: "gunfire",
    ability: "abilityCast",
    plant: "spikePlant",
    defuse: "spikeDefuse",
  };
  const audibleEvents: SoundObservation[] = soundsRaw.filter(isObj).map((s) => {
    const msAgo = isNum(s["atMsAgo"]) ? (s["atMsAgo"] as number) : 0;
    return {
      kind: soundKindMap[s["kind"] as string] ?? "other",
      approxPosition: vec2ToVec3(s["pos"] as { x: number; y: number } | null),
      heardAtMs: nowMs - msAgo,
      confidence: 0.6,
    };
  });

  const enemyPositionBeliefs: EnemyPositionBelief[] = visibleEnemies
    .filter((e) => e.lastSeenPosition)
    .map((e) => ({
      enemyId: e.playerId,
      agentId: null,
      hypotheses: [{ position: e.lastSeenPosition, weight: 1 }],
      staleness: Math.max(0, nowMs - e.lastSeenAtMs),
    }));

  const tacticalHypotheses: TacticalHypothesis[] = hypoRaw.filter(isObj).map((h) => ({
    intent: intentOf(isStr(h["hypothesis"]) ? (h["hypothesis"] as string) : ""),
    probability: isNum(h["confidence"]) ? (h["confidence"] as number) : 0.5,
    rationale: isStr(h["hypothesis"]) ? (h["hypothesis"] as string) : "",
  }));

  const observation: ObservationState = {
    observerId,
    teamId: decidingTeamId,
    timestampMs: nowMs,
    visibleEnemies,
    audibleEvents,
    teammateReports: [],
    knownMapChanges: [],
  };
  const beliefState: BeliefState = {
    playerId: observerId,
    timestampMs: nowMs,
    enemyPositionBeliefs,
    tacticalHypotheses,
    threatZones: [],
    confidence: visibleEnemies.length > 0 ? 0.6 : 0.3,
  };
  return { observation, belief: beliefState };
}

function provenanceOf(p: Json): ScenarioProvenance {
  return {
    sourceId: isStr(p["sourceId"]) ? (p["sourceId"] as string) : "unknown",
    sourceUrl: isStr(p["sourceUrl"]) ? (p["sourceUrl"] as string) : null,
    sourceVersion: isStr(p["sourceVersion"]) ? (p["sourceVersion"] as string) : null,
    gamePatch: isStr(p["gamePatch"]) ? (p["gamePatch"] as string) : null,
    retrievedAt: isStr(p["retrievedAt"]) ? (p["retrievedAt"] as string) : "",
    evidenceType: (p["evidenceType"] as ScenarioProvenance["evidenceType"]) ?? "simulated",
    confidence: isNum(p["confidence"]) ? (p["confidence"] as number) : null,
    verified: p["verified"] === true,
    verificationLevel: isNum(p["verificationLevel"]) ? (p["verificationLevel"] as number) : 0,
    synthetic: p["synthetic"] === true,
    sha256: isStr(p["sha256"]) ? (p["sha256"] as string) : null,
    notes: Array.isArray(p["notes"]) ? (p["notes"] as unknown[]).filter(isStr) : [],
  };
}

export interface LoadOptions {
  /** When true (default), throw ScenarioValidationError on any validation problem. */
  readonly validate?: boolean;
}

/**
 * Load an external DecisionContext (parsed JSON) into a typed {@link TeamDecisionContext}.
 * Throws {@link ScenarioValidationError} when validation fails (unless disabled).
 */
export function loadDecisionContext(raw: unknown, options: LoadOptions = {}): TeamDecisionContext {
  if (options.validate !== false) {
    const problems = validateDecisionContext(raw);
    if (problems.length > 0) throw new ScenarioValidationError(problems);
  }
  const ctx = raw as Json;
  const w = ctx["worldState"] as Json;
  const decidingTeamIdx = ctx["decidingTeamIdx"] as number;
  const attackingTeamIdx = isNum(w["attackingTeamIdx"]) ? (w["attackingTeamIdx"] as number) : 0;
  const nowMs = w["timeRemainingMs"] as number;

  const rawPlayers = (w["players"] as Json[]).map((p) => buildPlayer(p, attackingTeamIdx));
  const spike = buildSpike(w["spike"] as Json);
  // Reflect spike carrier on the carrier's inventory.
  const players: PlayerState[] = rawPlayers.map((p) =>
    spike.holderId !== null && p.id === spike.holderId
      ? { ...p, inventory: { ...p.inventory, hasSpike: true } }
      : p,
  );

  const world: WorldState = createWorldState({
    matchId: asMatchId(w["matchId"] as string),
    roundId: asRoundId(w["roundId"] as string),
    roundNumber: isNum(w["roundNum"]) ? (w["roundNum"] as number) : 1,
    mapId: asMapId((w["mapName"] as string).toLowerCase()),
    patchVersion: asPatchVersion(isStr(w["patch"]) ? (w["patch"] as string) : "synthetic-unknown"),
    players,
    timeRemainingMs: nowMs,
    tick: isNum(w["tick"]) ? (w["tick"] as number) : 0,
    spike,
    economy: buildEconomy(w["teamEconomy"], attackingTeamIdx),
  });

  const decidingTeamId = teamIdFor(decidingTeamIdx);
  const decidingSide: Side = decidingTeamIdx === attackingTeamIdx ? "attack" : "defense";
  const observerId =
    players.find((p) => p.teamId === decidingTeamId && p.alive)?.id ??
    players.find((p) => p.teamId === decidingTeamId)?.id ??
    asPlayerId(`${decidingTeamId}:observer`);

  const { observation, belief } = buildPerception(
    isObj(ctx["belief"]) ? (ctx["belief"] as Json) : undefined,
    decidingTeamId,
    observerId,
    nowMs,
  );

  return {
    contextId: ctx["contextId"] as string,
    scenarioRef: isStr(ctx["scenarioRef"]) ? (ctx["scenarioRef"] as string) : null,
    world,
    decidingTeamId,
    decidingSide,
    observation,
    belief,
    coordinateSpace: "minimapUnits",
    provenance: provenanceOf(ctx["provenance"] as Json),
  };
}
