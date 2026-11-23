import type { SpatialEngine } from "@pv/spatial-engine";
import type { AbilityState, MapObservation, ObservationState, ObservedEnemy, SoundObservation, PlayerState as PPlayerState, SpikeState as PSpikeState, Vector2 } from "@pv/perception-engine";
import { DEFAULT_PARAMS, type PerceptionEngine, type PerceptionParams } from "@pv/perception-engine";
import { spikeBlastRadiusUnits } from "@pv/game-rules";
import { revealedEnemies, activeAreaDenials, deployedEffects, type AbilityCatalog, type AbilityEngine } from "@pv/ability-engine";
import { buildBelief } from "@pv/decision-engine";
import { asAbilityId } from "@pv/shared-types";
import type {
  AbilityInventory,
  AbilityChargeState,
  BeliefState as SharedBeliefState,
  ObservationState as SharedObservationState,
  SpatialQuery as SharedSpatialQuery,
} from "@pv/shared-types";
import { mulberry32, type Rng } from "./rng.js";
import type {
  AbilityFact,
  AudibleZoneResult,
  BeliefState,
  PolicyTeammate,
  TeammateTransit,
  VisibleEffect,
  PolicyView,
  RandomSource,
  SpatialQuery,
  TeamEconomyState,
  ZoneId,
  ZoneMeta,
  ZonePath,
  ZoneType,
} from "./policy-contract.js";
import type { AbilityCue, PerceptionSnapshot, ShotCue, SimPlayer, SimState, Side } from "./types.js";

/**
 * Adapter exposing PV-4's SpatialEngine as PV-3's SpatialQuery (the dependency-inversion
 * seam). NOTE: PV-3's contract documents minimapUnits for position inputs; this adapter
 * works in the engine's native game-world units (the frame the round-simulator uses), so
 * callers must pass game-unit positions to nearestZone. Zone-id queries are frame-free.
 */
export class SpatialQueryAdapter implements SpatialQuery {
  readonly mapId: string;
  constructor(private readonly engine: SpatialEngine) {
    this.mapId = engine.mapId;
  }
  nearestZone(position: Vector2): ZoneId {
    return this.engine.nearestZone({ x: position.x, y: position.y, z: 0 }).id;
  }
  getZoneMeta(zoneId: ZoneId): ZoneMeta | undefined {
    const z = this.engine.getZone(zoneId);
    if (!z) return undefined;
    return { id: z.id, zoneType: z.zoneType as ZoneType, site: z.zoneType === "site" ? z.superRegion : null, plantable: z.plantable, callout: z.callout };
  }
  allZones(): readonly ZoneId[] {
    return this.engine.zones.map((z) => z.id);
  }
  zonesByType(type: ZoneType): readonly ZoneId[] {
    return this.engine.zonesByType(type).map((z) => z.id);
  }
  findPath(from: ZoneId, to: ZoneId, mode: "run" | "walk" = "run"): ZonePath | null {
    const r = this.engine.findPath(from, to, mode);
    return r ? { path: r.path, timeMs: r.timeMs, distanceMeters: r.distanceMeters, mode } : null;
  }
  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode: "run" | "walk" = "run"): number | null {
    return this.engine.shortestTravelTimeMs(from, to, mode);
  }
  isReachable(from: ZoneId, to: ZoneId): boolean {
    return this.engine.isReachable(from, to);
  }
  hasLineOfSight(a: ZoneId, b: ZoneId, opts?: { smokedPairs?: ReadonlyArray<readonly [ZoneId, ZoneId]> }): boolean {
    return this.engine.hasLineOfSight(a, b, { smokedPairs: opts?.smokedPairs as Array<[string, string]> | undefined });
  }
  visibleZonesFrom(zoneId: ZoneId): readonly ZoneId[] {
    return this.engine.visibleZonesFrom(zoneId);
  }
  isPlantableZone(zoneId: ZoneId): boolean {
    return this.engine.isPlantableZone(zoneId);
  }
  audibleZones(originZone: ZoneId, threshold?: number): readonly AudibleZoneResult[] {
    return this.engine.audibleZones(originZone, threshold);
  }
}

/** Seeded RandomSource (PV-3 contract) backed by mulberry32. */
export class SeededRandomSource implements RandomSource {
  private readonly rng: Rng;
  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }
  nextFloat(): number {
    return this.rng();
  }
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.rng() * (maxExclusive - minInclusive));
  }
}

/**
 * Build PV-3's AbilityInventory from the player's loadout slots. Slots marked "ultimate"
 * identify the ult ability id; everything else is basic unless marked "signature". The
 * ultimate's `ready`/`points`/`required` come from the player's banked ult points vs cost.
 */
function toAbilityInventory(p: SimPlayer): AbilityInventory {
  const charge = (abilityId: string, charges: number): AbilityChargeState => ({ abilityId: asAbilityId(abilityId), charges });
  const basic: AbilityChargeState[] = [];
  let signature: AbilityChargeState | null = null;
  let ultId = "ultimate";
  for (const a of p.abilities) {
    if (a.slot === "ultimate") ultId = a.abilityId;
    else if (a.slot === "signature" && signature === null) signature = charge(a.abilityId, a.chargesRemaining);
    else basic.push(charge(a.abilityId, a.chargesRemaining));
  }
  return {
    basic,
    signature,
    ultimate: {
      abilityId: asAbilityId(ultId),
      points: p.ultimatePoints,
      required: p.ultimateCost,
      ready: p.ultimatePoints >= p.ultimateCost,
    },
  };
}

function toTeammate(p: SimPlayer, transit?: TeammateTransit): PolicyTeammate {
  return {
    ...(transit ? { transit } : {}),
    id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
    position: p.position, facing: p.facing, health: p.health, armor: p.armor, alive: p.alive,
    weapon: p.weaponId ? { weaponId: p.weaponId } : null,
    abilities: toAbilityInventory(p),
    credits: 0, // TODO(econ): the sim does not model per-player economy yet
    ultimatePoints: p.ultimatePoints, ultimateCost: p.ultimateCost,
  };
}

function publicSpike(state: SimState): PSpikeState {
  const s = state.spike;
  const phase = s.phase === "planting" ? "planting" : s.phase; // perception SpikePhase superset
  return {
    phase,
    position: s.position,
    holderId: s.carrierId,
    detonationInMs: s.detonateAtElapsedMs != null ? s.detonateAtElapsedMs - state.elapsedMs : null,
  };
}

/**
 * Build the observable PolicyView for one side. Enemies appear ONLY through `observation`
 * (last-seen snapshots) and `belief`; `teammates` is own-team players only. There is no
 * field carrying an unseen enemy's live state (DECISION-004) — asserted in test/leak.test.ts.
 *
 * `belief` is produced by PV-3's real `@pv/decision-engine` `buildBelief(prev, observation,
 * spatial, dtMs)` — zone-probability distributions with time diffusion — not a local
 * placeholder. The caller (RoundSimulator) threads the previous tick's belief as `prevBelief`
 * and the elapsed `dtMs` so unseen enemies age correctly across decisions (README §17.3).
 */
export interface BuildViewOptions {
  /** Active vision-blocking abilities (smoke/wall) so decisions are LoS-aware. */
  readonly activeAbilities?: readonly AbilityState[];
  /** Ability engine, to fold recon/trap reveals into the team picture. */
  readonly abilityEngine?: AbilityEngine;
  /** Shot cues observed so far this round (sound / tracer); the side's own are folded into its observation. */
  readonly cues?: readonly ShotCue[];
  /** Round clock (elapsed ms) the cue timestamps are measured on. */
  readonly elapsedMs?: number;
  /** Ability cues observed so far this round (heard casts / seen deployed effects), same role as `cues`. */
  readonly abilityCues?: readonly AbilityCue[];
  /** Ability catalog, to give the team the public facts of the abilities it carries. */
  readonly abilityCatalog?: AbilityCatalog;
  /** Where a player is going (own team only — the simulator's movement state). */
  readonly transitOf?: (p: SimPlayer) => TeammateTransit | undefined;
  /** Players on a route but standing still this tick (waiting at a hazard's edge): they make no footsteps. */
  readonly stationaryIds?: { has(id: string): boolean };
  /** Distance-rule sounds made since the last decision (landings), with their reach (sound detail). */
  readonly extraSounds?: NonNullable<PWorldExtras["extraSounds"]>;
  /** Loud sounds in the masking window (gunfire), for sound masking (sound detail). */
  readonly maskers?: NonNullable<PWorldExtras["maskers"]>;
}
type PWorldExtras = { extraSounds?: ReadonlyArray<{ kind: "landing"; position: { x: number; y: number; z: number }; teamId?: string; radiusUnits: number; levelDb: number }>; maskers?: ReadonlyArray<{ position: { x: number; y: number; z: number }; levelDb: number }> };

/**
 * Perception parameters for a round: the defaults, with the footstep audio range taken from the
 * game rule it is defined by — a running player is heard within the spike's blast radius
 * (@pv/game-rules SPIKE_RULES.blastRadiusM). One number, one place.
 */
export function roundPerceptionParams(): PerceptionParams {
  return { ...DEFAULT_PARAMS, hearing: { ...DEFAULT_PARAMS.hearing, footstepRadiusUnits: spikeBlastRadiusUnits() } };
}

/**
 * The team's footstep picture: one cue per DISTINCT runner. Each listener hears every runner in
 * range, so the raw per-player observations repeat the same runner once per listener. Steps are
 * distinguishable as separate sources but carry no identity, so the team cannot match them by
 * name — it reconciles by place: for each zone, the number of runners is the most any single
 * listener hears there (three teammates each hearing the same two runners is two runners, not
 * six), and the k-th runner's confidence is the best any listener has for a k-th source.
 */
function teamFootsteps(perPlayer: Readonly<Record<string, ObservationState>>, spatial: SpatialQuery): SoundObservation[] {
  const byZone = new Map<string, { position: SoundObservation["approxPosition"]; heardAtMs: number; best: number[] }>();
  for (const id of Object.keys(perPlayer).sort()) {
    const mine = new Map<string, SoundObservation[]>();
    for (const e of perPlayer[id]!.audibleEvents) {
      if (e.kind !== "footstep") continue;
      const zone = spatial.nearestZone(e.approxPosition);
      const list = mine.get(zone);
      if (list) list.push(e); else mine.set(zone, [e]);
    }
    for (const [zone, list] of mine) {
      const conf = list.map((e) => e.confidence).sort((a, b) => b - a);
      const entry = byZone.get(zone) ?? { position: list[0]!.approxPosition, heardAtMs: list[0]!.heardAtMs, best: [] };
      conf.forEach((c, k) => { entry.best[k] = Math.max(entry.best[k] ?? 0, c); });
      byZone.set(zone, entry);
    }
  }
  const out: SoundObservation[] = [];
  for (const zone of [...byZone.keys()].sort()) {
    const e = byZone.get(zone)!;
    for (const confidence of e.best) out.push({ kind: "footstep", approxPosition: { ...e.position }, heardAtMs: e.heardAtMs, confidence });
  }
  return out;
}

/** Shot cues older than this no longer appear in the observation (the belief layer ages the rest). */
const CUE_OBSERVATION_WINDOW_MS = 10_000;

/**
 * The side's shot cues as observations: where a shot was heard / its tracer seen, zone-level, with
 * the cue's confidence. The observation clock is the REMAINING round time, so a cue's age is
 * re-expressed on it (heardAtMs = now − age).
 */
function shotCueObservations(side: Side, state: SimState, opts: BuildViewOptions): SoundObservation[] {
  if (!opts.cues || opts.elapsedMs === undefined) return [];
  // One observation per shooter+zone: the firmest cue still inside the window.
  const best = new Map<string, SoundObservation>();
  for (const c of opts.cues) {
    const age = opts.elapsedMs - c.elapsedMs;
    if (c.observerSide !== side || age < 0 || age > CUE_OBSERVATION_WINDOW_MS) continue;
    const key = `${c.shooterId}:${c.zoneId}`;
    const prev = best.get(key);
    const heardAtMs = state.timeRemainingMs - age;
    if (!prev || heardAtMs > prev.heardAtMs || (heardAtMs === prev.heardAtMs && c.confidence > prev.confidence)) {
      best.set(key, { kind: "gunfire", approxPosition: { ...c.zonePosition }, heardAtMs, confidence: c.confidence });
    }
  }
  return [...best.values()];
}

/**
 * The side's ability cues as observations — the same path a shot cue takes. A heard cast points
 * at the caster's zone; a seen smoke / wall / fire points at the EFFECT's zone (where utility is
 * being committed). Both are zone-level and carry the cue's confidence; ages are re-expressed on
 * the observation clock exactly as for shot cues. One observation per zone and channel (the
 * freshest; firmest on a tie), so one smoke is one piece of evidence however long it stands.
 */
function abilityCueObservations(side: Side, state: SimState, opts: BuildViewOptions): SoundObservation[] {
  if (!opts.abilityCues || opts.abilityCues.length === 0 || opts.elapsedMs === undefined) return [];
  const best = new Map<string, SoundObservation>();
  for (const c of opts.abilityCues) {
    const age = opts.elapsedMs - c.elapsedMs;
    if (c.observerSide !== side || age < 0 || age > CUE_OBSERVATION_WINDOW_MS) continue;
    const key = `${c.zoneId}:${c.channel}`;
    const prev = best.get(key);
    const heardAtMs = state.timeRemainingMs - age;
    if (!prev || heardAtMs > prev.heardAtMs || (heardAtMs === prev.heardAtMs && c.confidence > prev.confidence)) {
      best.set(key, { kind: "abilityCast", approxPosition: { ...c.zonePosition }, heardAtMs, confidence: c.confidence });
    }
  }
  return [...best.values()];
}

/**
 * Active effects the side knows of: all of its own, and enemy effects that stand visibly in the
 * world (smoke / wall / fire / slow field) in a zone a living teammate occupies or has a sightline
 * onto. Observation-limited (DECISION-004): an enemy effect nobody can see is not reported.
 */
function visibleEffectsFor(side: Side, state: SimState, spatial: SpatialQuery, opts: BuildViewOptions): Array<VisibleEffect & { origin: { x: number; y: number; z: number } }> {
  if (!opts.abilityEngine || opts.elapsedMs === undefined) return [];
  const effects = deployedEffects(opts.abilityEngine, opts.elapsedMs);
  if (effects.length === 0) return [];
  const teamId = side === "attack" ? "attackers" : "defenders";
  const mine = state.players.filter((p) => p.side === side && p.alive);
  const seen = (zoneId: string): boolean => mine.some((p) => p.zoneId === zoneId || spatial.hasLineOfSight(p.zoneId, zoneId));
  const out: Array<VisibleEffect & { origin: { x: number; y: number; z: number } }> = [];
  for (const e of effects) {
    const own = e.teamId === teamId;
    if (!own && !(e.worldVisible && seen(e.zoneId))) continue;
    out.push({ zoneId: e.zoneId, effectType: e.effectType, abilityId: e.abilityId, own, remainingMs: e.remainingMs, origin: { ...e.origin } });
  }
  return out;
}

/** Catalog facts of every ability the side's players carry. */
function abilityFactsFor(side: Side, state: SimState, catalog?: AbilityCatalog): Record<string, AbilityFact> {
  const out: Record<string, AbilityFact> = {};
  if (!catalog) return out;
  for (const p of state.players) {
    if (p.side !== side) continue;
    for (const a of p.abilities) {
      const s = catalog[a.abilityId];
      if (!s || out[a.abilityId]) continue;
      out[a.abilityId] = {
        effectType: s.effectType, effectTypes: s.effectTypes, durationMs: s.durationMs, flashDurationMs: s.flashDurationMs,
        radiusUnits: s.radiusUnits, rangeUnits: s.rangeUnits, windupMs: s.windupMs,
      };
    }
  }
  return out;
}

export function buildPolicyView(
  side: Side,
  state: SimState,
  perception: PerceptionEngine,
  spatial: SpatialQuery,
  prevBelief: BeliefState | null = null,
  dtMs = 0,
  opts: BuildViewOptions = {},
): PolicyView {
  const result = perception.perceive({
    ...toPerceptionWorldForView(state, opts.activeAbilities, opts.stationaryIds),
    ...(opts.extraSounds ? { extraSounds: opts.extraSounds } : {}),
    ...(opts.maskers ? { maskers: opts.maskers } : {}),
  });
  const teamId = side === "attack" ? "attackers" : "defenders";
  const team = result.teams.get(teamId);
  const teammates = state.players.filter((p) => p.side === side).map((p) => toTeammate(p, opts.transitOf?.(p)));
  const knownEffects = visibleEffectsFor(side, state, spatial, opts);
  const visibleEffects: VisibleEffect[] = knownEffects.map(({ origin: _origin, ...e }) => e);
  // What the team knows utility has changed on the map: one entry per known effect, at the
  // effect's own centre (the centre of the zone it was placed on — not where its caster stands).
  const knownMapChanges: MapObservation[] = knownEffects.map((e) => ({
    abilityId: e.abilityId,
    approxPosition: e.origin,
    observedAtMs: state.timeRemainingMs,
    note: `${e.effectType}:${e.own ? "own" : "enemy"}:${e.zoneId}`,
  }));

  // recon/trap reveals (frozen snapshots) become remembered enemies in the team picture.
  const reveals: ObservedEnemy[] = opts.abilityEngine
    ? revealedEnemies(opts.abilityEngine)
        .filter((r) => r.teamId !== teamId)
        // A reveal's age is measured on the elapsed clock; the observation clock is the remaining
        // round time, so re-express it there (as shot cues do) instead of mixing the two clocks.
        .map((r) => ({
          playerId: r.enemyId, agentId: null, lastSeenPosition: r.position,
          lastSeenAtMs: opts.elapsedMs !== undefined ? state.timeRemainingMs - Math.max(0, opts.elapsedMs - r.revealedAtMs) : r.revealedAtMs,
          healthBand: "unknown", observedWeaponId: null, currentlyVisible: false,
        }))
    : [];

  // team-level observation: perceived picture + recon reveals (dedup, prefer live sight)
  const picture = new Map<string, ObservedEnemy>();
  for (const e of reveals) picture.set(e.playerId, e);
  for (const e of team?.teamEnemyPicture ?? []) picture.set(e.playerId, e); // live/remembered overrides reveal
  const observation: ObservationState = {
    observerId: teamId,
    teamId,
    timestampMs: state.timeRemainingMs,
    visibleEnemies: [...picture.values()],
    audibleEvents: [
      ...(team ? teamFootsteps(team.perPlayer, spatial) : []),
      ...(team ? Object.values(team.perPlayer).flatMap((o) => o.audibleEvents.filter((e) => e.kind !== "footstep")) : []),
      ...shotCueObservations(side, state, opts),
      ...abilityCueObservations(side, state, opts),
    ],
    teammateReports: team?.sharedReports ?? [],
    knownMapChanges,
  };
  const perPlayerObservation: Record<string, ObservationState> = team ? { ...team.perPlayer } : {};

  return {
    contextId: state.roundId,
    scenarioRef: null,
    teamId,
    side,
    roundNumber: state.roundNumber ?? 1,
    timeRemainingMs: state.timeRemainingMs,
    mapId: state.mapId,
    patchVersion: "synthetic",
    spike: publicSpike(state),
    teammates,
    observation,
    perPlayerObservation,
    // buildBelief is the real @pv/decision-engine implementation. Its params are
    // shared-types' BRANDED-id shapes; the round-simulator still carries the string-aliased
    // mirrors (perception-engine shared-mirror / policy-contract). A branded PlayerId IS a
    // string at runtime and we only pass ids through, so bridging the two with a cast at this
    // single boundary is sound. The RESULT (branded) assigns back to our mirror BeliefState
    // because a brand is a subtype of string. (Removed once the mirrors are deleted in favour
    // of importing @pv/shared-types everywhere.)
    belief: buildBelief(
      prevBelief as unknown as SharedBeliefState | null,
      observation as unknown as SharedObservationState,
      spatial as unknown as SharedSpatialQuery,
      dtMs,
    ),
    // The side's real economy when the match runner supplies it (a stub of 0 credits made every
    // round look like an eco to the IGL); own team only — the opponent's bank is never exposed.
    economy: state.economy?.[side] ? { teamId, side, ...state.economy[side]! } : economyStub(teamId, side),
    knownEnemyAliveCount: state.players.filter((p) => p.side !== side && p.alive).length,
    matchScore: null,
    visibleHazards: visibleHazardsFor(side, state, spatial, opts.abilityEngine),
    visibleEffects,
    abilityFacts: abilityFactsFor(side, state, opts.abilityCatalog),
  };
}

/**
 * Observable passable hazards (molly / area-denial): active hazards whose zone an alive teammate
 * occupies or can see. Observation-limited (DECISION-004) — unseen hazards are not reported.
 */
function visibleHazardsFor(side: Side, state: SimState, spatial: SpatialQuery, abilityEngine?: AbilityEngine) {
  if (!abilityEngine) return [];
  const mine = state.players.filter((p) => p.side === side && p.alive);
  const seen = (zoneId: string): boolean => mine.some((p) => p.zoneId === zoneId || spatial.visibleZonesFrom(p.zoneId).includes(zoneId));
  return activeAreaDenials(abilityEngine, state.elapsedMs)
    .filter((h) => seen(h.zoneId))
    .map((h) => ({ zoneId: h.zoneId, remainingMs: h.remainingMs }));
}

function economyStub(teamId: string, side: Side): TeamEconomyState {
  return { teamId, side, credits: 0, lossBonusTier: 0, consecutiveLosses: 0 };
}

/**
 * Summarise one side's PolicyView into a PV-6 PerceptionSnapshot (fog-of-war + belief heatmap).
 * Observation/belief only — never ground truth (DECISION-004). `tMs` is round-relative; the
 * match merger offsets it onto the match timeline (as it does for event timeMs).
 */
export function toPerceptionSnapshot(view: PolicyView, spatial: SpatialQuery, tMs: number): PerceptionSnapshot {
  const obs = view.observation;
  const observedEnemies = obs.visibleEnemies.map((e) => ({
    enemyId: e.playerId ?? null,
    zone: spatial.nearestZone(e.lastSeenPosition),
    pos: e.lastSeenPosition,
    lastSeenMsAgo: e.currentlyVisible ? 0 : Math.max(0, obs.timestampMs - e.lastSeenAtMs),
    currentlyVisible: e.currentlyVisible,
  }));
  // Fold the belief's per-enemy position hypotheses into a zone→probability map.
  const byZone = new Map<string, number>();
  for (const b of view.belief.enemyPositionBeliefs) {
    for (const h of b.hypotheses) {
      const z = spatial.nearestZone(h.position);
      byZone.set(z, (byZone.get(z) ?? 0) + h.weight);
    }
  }
  const beliefZones = [...byZone.entries()].map(([zone, w]) => ({ zone, p: Math.min(1, w) }));
  const sounds = obs.audibleEvents.map((a) => ({
    zone: spatial.nearestZone(a.approxPosition),
    kind: a.kind,
    tMsAgo: Math.max(0, obs.timestampMs - a.heardAtMs),
  }));
  return { tMs, roundNum: view.roundNumber ?? null, observedEnemies, beliefZones, sounds };
}

// Local perception-world builder (mirror of simulator's; kept here so view is self-contained).
function toPerceptionWorldForView(state: SimState, activeAbilities: readonly AbilityState[] = [], stationaryIds?: { has(id: string): boolean }) {
  const players: PPlayerState[] = state.players.map((p) => ({
    id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
    position: p.position, velocity: { x: 0, y: 0, z: 0 }, facing: p.facing,
    health: p.health, armor: p.armor, alive: p.alive, weapon: null,
    behaviorState: p.pathIndex < p.path.length && !stationaryIds?.has(p.id) ? (p.moveMode === "run" ? "running" : "walking") : "still",
    zoneId: p.zoneId,
  }));
  return {
    matchId: state.matchId, roundId: state.roundId, roundNumber: 1, tick: state.tick,
    timeRemainingMs: state.timeRemainingMs, mapId: state.mapId, patchVersion: "synthetic",
    players, spike: { phase: "carried" as const, position: null, holderId: null, detonationInMs: null },
    activeAbilities, events: [],
  };
}

export { SeededRandomSource as RandomSourceImpl };
