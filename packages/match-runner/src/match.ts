/**
 * Match-level simulation (README §28, Handoff §17): extends the round loop to a full map.
 *
 *   pistol → first half → side swap after `roundsPerHalf` → second half → first to
 *   `roundsToWinRegulation` with a 2-round lead → overtime (win by `overtimeWinMargin`).
 *
 * Economy, loss-bonus ladder and ultimate points carry ACROSS rounds (see ./economy.ts);
 * credits reset at the half and each OT round. Decisions go through PV-3's
 * TeamDecisionPolicy for both sides (DECISION-004: policy input is a PolicyView — no
 * WorldState). Per-round RNG is derived from the match seed so the whole match is
 * deterministic (DECISION-010) yet rounds differ.
 */
import { ROUND_RULES } from "@pv/game-rules";
import {
  runMatchRound,
  deriveSeed,
  mulberry32,
  type TacticalTraits,
  toPv6ReplayFormat,
  type RoundEndReason,
  type SimEvent,
  type Pv6SimEventLog,
  type MatchRoundPlayer,
  type MatchRoundTeam,
  type NavTraceEvent,
  type RoundStats,
} from "@pv/round-simulator";
import { lossBonusTierFor, type TeamEconomyState } from "@pv/economy-engine";
import {
  loadSpatial,
  loadTactics,
  loadWeapons,
  makeSpatialQuery,
  makeSimPolicies,
  toSimPolicies,
  NO_ABILITIES,
  loadUltOrbs,
} from "./setup.js";
import { loadAbilityCatalog, agentAbilityLoadout, ASCENT_COMP } from "./abilities.js";
import {
  newTeamEconomy,
  decideTeamBuy,
  afterBuy,
  settleRound,
  saveWorth,
  postRoundPickups,
  floorAfterRound,
  halfReset,
  overtimeReset,
  ultCost,
  type TeamEconomy,
  type BuyDecision,
  type EconomyOptions,
  type Pickup,
  type PlayerContext,
  type TeamDecisionTraits,
} from "./economy.js";
import { applyRoundForm, rosterConsistency, rosterPlayerIds, rosterProfiles, rosterSkills, rosterTraits, type RosterPlayer, type RosterProfile } from "./teams.js";
import type { PlayerProfile } from "@pv/shared-types";
import { OpponentModel, type OpponentRead, type PlanSummary, type PolicyTuning, type RoundObservation, type SiteKey } from "@pv/team-engine";
import { MAP_IDS, isMapId } from "@pv/spatial-engine";
import { selectDefenseSetup } from "./defense-setups.js";
import { toPolicyOrder, type TeamOrder } from "./orders.js";
// [series] per-team inputs + series metadata (additive; see ./team-inputs.ts)
import { applyTraitDelta, type SeriesGameContext, type TeamMatchInputs } from "./team-inputs.js";
import { FORM_SIGMA_MAX } from "./teams.js";
import { DEFAULT_POLICY_TUNING } from "@pv/team-engine";

/** The map whose geometry a match is simulated on (see MatchConfig.geometry). */
export function geometryOf(config: Pick<MatchConfig, "map" | "geometry">): string {
  if (config.geometry !== "own") return "ascent";
  const id = config.map.trim().toLowerCase();
  if (!isMapId(id)) throw new Error(`MatchConfig.geometry "own": no spatial data for map "${config.map}" (available: ${MAP_IDS.join(", ")})`);
  return id;
}

/** Defender anchor spawns (mirror of the round-simulator's SYNTHETIC_DEFENSE_ANCHORS). */
const DEFENDER_SPAWNS = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"] as const;
/** Points cost a held ultimate is shown to the simulator with, so it is not cast this round. */
const HELD_ULT_COST = 99;
/** Precomputed per-slot agent + ability loadout for the fixed comp (both teams use it). */
const COMP_LOADOUTS = ASCENT_COMP.map((agent) => ({ agent, abilities: agentAbilityLoadout(agent) }));

export type TeamSlot = "A" | "B";
export type Side = "attack" | "defense";

export interface TeamRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Pre-match engine options (all optional; omitted fields use the calibrated defaults). See
 * docs/STAT_OUTCOME_MATRIX.md for the formula each one feeds.
 */
export interface MatchTuning extends Partial<PolicyTuning> {
  /** Crossfire (Hick–Hyman) slope b in ms per bit. Default 60. */
  readonly crossfireMsPerBit?: number;
  /** Info half-life in ms. Default 2000. */
  readonly infoHalfLifeMs?: number;
  /** Round-form σ for a player with consistency 0. Default 0.08. */
  readonly formSigmaMax?: number;
  /** Attrition: share of duel damage a survivor carries into the next fight (0..1). Default 0. */
  readonly damageCarryover?: number;
  /**
   * Multiplier on the time a shooter caught on the move needs before it fights like a set player
   * (combat-engine accuracy.stopMs: 700 ms from a run, 350 ms from a walk at movement skill 0.5).
   * Default 1. Larger = moving into a held angle costs more; Infinity = a mover never settles.
   */
  readonly movingStopScale?: number;
}

export interface MatchConfig {
  readonly teamA: TeamRef;
  readonly teamB: TeamRef;
  readonly map: string;
  /**
   * The geometry the match is simulated on.
   *  - "ascent" (default): Ascent's zone graph, roadmap and sight, whatever `map` says — `map`
   *    then only selects that map's mastery, scouting and records. The tactical layer (defender
   *    setups, smoke and aim targets, A/B sites) is written for Ascent.
   *  - "own": the map named in `map` — its own zone graph, navigation roadmap and, where it has
   *    one, its table of sight between real positions (else the zone sightline table). The engine
   *    RUNS on every map this way, but the tactical layer is still Ascent's: a zone id it names
   *    that the map lacks is skipped, a third site is never played, and some zones cannot be
   *    reached on some maps. For measurement (sim-batch --geometry own), not for the product yet.
   */
  readonly geometry?: "ascent" | "own";
  readonly seed: number;
  /** Safety cap on total rounds (OT can in principle run long). Default 60. */
  readonly maxRounds?: number;
  /**
   * Record per-tick perception (observation/belief) time series for PV-6's fog-of-war + belief
   * heatmap. Default false — off has no effect on determinism or performance. When on, each
   * round's `replay.meta.perception` is populated (round-simulator → toPv6ReplayFormat).
   */
  readonly recordPerception?: boolean;
  /**
   * Record every player's position on every tick (RoundResult.tracks → `move` events in each
   * round's replay). Passive: outcomes are identical with and without it. Default false.
   */
  readonly recordTracks?: boolean;
  /**
   * Collect report-only movement / crowd measurements per round (RoundRecord.stats, round-simulator
   * RoundStats) for the validator. Passive: outcomes are identical with and without it. Default false.
   */
  readonly collectStats?: boolean;
  /** Gaze model (round-simulator SimConfig.gaze; docs/ENGINE_TRUTH.md §8). Default off. */
  readonly gaze?: boolean;
  /** Sound detail: landings off drops, gunfire masking (SimConfig.soundDetail; ENGINE_TRUTH §9). Default off. */
  readonly soundDetail?: boolean;
  /**
   * Simulate the buy phase (ROUND_RULES.buyPhaseMs) before each round: both teams move behind their
   * barriers into the round plan's setup (round-simulator buy-phase.ts). Default true; false starts
   * every round with the players where the match sets them down.
   */
  readonly buyPhase?: boolean;
  /** Per-player movement style (round-simulator movement-style.ts). Default true. */
  readonly movementStyle?: boolean;
  /**
   * Floor items in the round (round-simulator floor-items.ts): dropped guns picked up mid-round, and
   * ultimate orbs at the map's `<map>.objects.json` `ultOrbs` points (none yet on any map → no orbs).
   * Default true; false → guns are picked up only after the round, as before.
   */
  readonly floorItems?: boolean;
  /**
   * Deploy agent abilities (game-data comp + ability catalog). Default false. WIP: abilities
   * deploy correctly and bring opening-duel to the real rate (~0.45), but the policy does not yet
   * coordinate ATTACKER utility to execute, so enabling it makes defense dominant (attack win
   * ~0.02). Kept off until attacker util-for-executes is modelled; on is for ability experiments.
   */
  readonly enableAbilities?: boolean;
  /**
   * Cross-round opponent memory: each team learns where the other attacks / defends from what it
   * observed in earlier rounds and uses it as the prior behind its opening calls. Default true;
   * false makes both teams play every round as if it were the first.
   */
  readonly opponentMemory?: boolean;
  /** Pre-match engine options: override any of the calibrated formula constants. */
  readonly tuning?: MatchTuning;
  /**
   * Minimum throw rates (throws per second of holding a post-plant posture). A player's floor is
   * the larger of their team's and their own entry; nobody throws less often than their floor,
   * however disciplined their ratings. Keys are game-data team ids / player ids.
   */
  readonly minThrowRates?: {
    readonly teams?: Readonly<Record<string, number>>;
    readonly players?: Readonly<Record<string, number>>;
  };
  /**
   * [series] Per-team values for the existing formulas (map mastery, scouting prior, game plan —
   * see ./team-inputs.ts and docs/SERIES_AND_VETO.md). Omitted → both teams run on `tuning` and a
   * blank opponent model, exactly as before.
   */
  readonly teamInputs?: Readonly<Partial<Record<TeamSlot, TeamMatchInputs>>>;
  /**
   * Field these players instead of the team's game-data roster (first five play), per team slot —
   * e.g. a career world's squad including generated players (@pv/career `startingFive`). Omitted →
   * the game-data roster, exactly as before. Ratings are read exactly as for game-data players.
   */
  readonly rosters?: Readonly<Partial<Record<TeamSlot, readonly RosterPlayer[]>>>;
  /** [series] Series metadata of this map (who picked it, starting sides). Not read by the engine. */
  readonly series?: SeriesGameContext;
  /** Economy decision tunables (docs/ECONOMY_MODEL.md); omitted fields use the defaults. */
  readonly economy?: Partial<EconomyOptions>;
}

export interface RoundRecord {
  readonly roundNumber: number;
  readonly phase: "pistol" | "regulation" | "overtime";
  readonly attacker: TeamSlot;
  readonly buys: Readonly<Record<TeamSlot, BuyDecision>>;
  readonly winner: TeamSlot;
  readonly winnerSide: Side;
  readonly reason: RoundEndReason;
  readonly planted: boolean;
  readonly kills: Readonly<Record<TeamSlot, number>>;
  readonly score: Readonly<Record<TeamSlot, number>>;
  /** Each team's economy after the round (per-player credits, carried weapons, ult points). */
  readonly economy: Readonly<Record<TeamSlot, TeamEconomy>>;
  /** Weapons picked up off the floor after the round (kept into the next one). */
  readonly pickups: readonly (Pickup & { readonly team: TeamSlot; readonly index: number })[];
  readonly events: readonly SimEvent[];
  /**
   * Why each team played the round the way it did: its plan (opening call → revisions → final
   * call), the cross-round read of the opponent it went in with, and what both teams could
   * observe of the round (which is what the models learn from).
   */
  readonly decisions: {
    readonly plans: Readonly<Record<TeamSlot, PlanSummary | null>>;
    readonly opponentReadBefore: Readonly<Record<TeamSlot, OpponentRead | null>>;
    readonly observed: ReturnType<typeof observedTendencies>;
  };
  /** PV-6 replay-engine bridge input for this round (EventLog → replay). */
  readonly replay: Pv6SimEventLog;
  /**
   * What the navigation layer did this round — every planned path (goal, preference, length,
   * time), replan, blocked step and unreachable goal. Present only when `recordTracks` is on;
   * it is what the navigation debug view draws.
   */
  readonly navTrace?: readonly NavTraceEvent[];
  /** Report-only movement / crowd measurements of the round; present only when `collectStats` is on. */
  readonly stats?: RoundStats;
}

/**
 * IGL opponent memory (README §18): what each team has observed of the other across the
 * match. v0 records the opponent's buy tiers and round outcomes; a later pass can feed this
 * into strategy selection (the TeamDecisionPolicy does not yet consume it — TODO).
 */
export interface OpponentMemory {
  readonly buyTiers: string[];
  pistolWon: boolean | null;
  roundsWon: number;
  roundsLost: number;
}

export interface MatchResult {
  readonly config: MatchConfig;
  readonly winner: TeamSlot;
  readonly score: Readonly<Record<TeamSlot, number>>;
  readonly rounds: readonly RoundRecord[];
  readonly memory: Readonly<Record<TeamSlot, OpponentMemory>>;
  readonly wentToOvertime: boolean;
}

export interface RunMatchOptions {
  /** Progress callback invoked after each round resolves (PV-6 desktop drives the UI from this). */
  readonly onRound?: (record: RoundRecord, score: Readonly<Record<TeamSlot, number>>) => void;
}

const ROUNDS_PER_HALF = ROUND_RULES.roundsPerHalf.value; // 12
const ROUNDS_TO_WIN = ROUND_RULES.roundsToWinRegulation.value; // 13
const OT_MARGIN = ROUND_RULES.overtimeWinMargin.value; // 2
const REGULATION_ROUNDS = ROUNDS_PER_HALF * 2; // 24

/** Which team attacks in a given 1-based round. A attacks the first half; swap at the half; alternate in OT. */
export function attackerFor(roundNumber: number): TeamSlot {
  if (roundNumber <= ROUNDS_PER_HALF) return "A";
  if (roundNumber <= REGULATION_ROUNDS) return "B";
  // OT: round 25 → A, 26 → B, 27 → A, ...
  return (roundNumber - REGULATION_ROUNDS) % 2 === 1 ? "A" : "B";
}

function isPistol(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === ROUNDS_PER_HALF + 1;
}
function isOvertime(roundNumber: number): boolean {
  return roundNumber > REGULATION_ROUNDS;
}

/** A team has won iff it has ≥13 rounds and leads by ≥2 (covers regulation first-to-13 and OT win-by-2). */
function matchWinner(score: Record<TeamSlot, number>): TeamSlot | null {
  if (score.A >= ROUNDS_TO_WIN && score.A - score.B >= OT_MARGIN) return "A";
  if (score.B >= ROUNDS_TO_WIN && score.B - score.A >= OT_MARGIN) return "B";
  return null;
}

function other(slot: TeamSlot): TeamSlot {
  return slot === "A" ? "B" : "A";
}

function emptyMemory(): OpponentMemory {
  return { buyTiers: [], pistolWon: null, roundsWon: 0, roundsLost: 0 };
}

/** Our light TeamEconomy → the economy-engine TeamEconomyState surfaced to PolicyView.economy. */
function toEconomyState(eco: TeamEconomy, side: Side, buy: BuyDecision): TeamEconomyState {
  return { teamId: "", side, credits: eco.credits, consecutiveLosses: eco.consecutiveLosses, lossBonusTier: lossBonusTierFor(eco.consecutiveLosses), buyCall: buy.tier };
}

/**
 * Build a 5-player roster for one side (ids atk1..5 / def1..5 so the SimRun roster is stable).
 * Defenders spawn on their anchors (a/b/mid); attackers use the default attacker spawn. Per-player
 * skills come from the team's real ratings. Abilities/ults are the next layer (Stage 2).
 */
function makeRoster(side: Side, buy: BuyDecision, eco: TeamEconomy, skills: readonly ReturnType<typeof rosterSkills>[number][], withAbilities: boolean, defenderSpawns: readonly string[] = DEFENDER_SPAWNS, traits: readonly TacticalTraits[] = []): MatchRoundPlayer[] {
  const prefix = side === "attack" ? "atk" : "def";
  return Array.from({ length: 5 }, (_, i): MatchRoundPlayer => {
    const comp = COMP_LOADOUTS[i]!;
    const pb = buy.players[i]!;
    return {
      id: `${prefix}${i + 1}`,
      agentId: comp.agent,
      skills: skills[i],
      ...(traits[i] ? { traits: traits[i] } : {}),
      ...(side === "defense" ? { spawnZoneId: defenderSpawns[i] ?? DEFENDER_SPAWNS[i] } : {}),
      loadout: {
        weaponId: pb.weapon,
        armor: pb.armor,
        ...(withAbilities ? { abilities: comp.abilities } : {}),
        ultimatePoints: eco.players[i]?.ultPoints ?? 0,
        ultimateCost: pb.ultHeld ? HELD_ULT_COST : ultCost(comp.agent),
      },
    };
  });
}

/** Site letter of a zone id ("a-site" → A, "b-main" → B), or null for mid / spawns. */
function siteOf(zoneId: string | undefined): SiteKey | null {
  if (!zoneId) return null;
  return zoneId.startsWith("a-") ? "A" : zoneId.startsWith("b-") ? "B" : null;
}

/**
 * What BOTH teams could observe of a finished round — nothing here is hidden state: the plant is
 * public, and a kill happens in front of the two players involved (the kill event's zone is where
 * the victim stood).
 *  - plantSite / firstContactSite: where the attack showed up (the defenders' evidence).
 *  - defendersMet: how many defenders the attackers killed on each site (the attackers' evidence
 *    of where the defense was set up).
 */
export function observedTendencies(events: readonly SimEvent[]): Required<Pick<RoundObservation, "plantSite" | "firstContactSite" | "defendersMet">> {
  let plantSite: SiteKey | null = null;
  let firstContactSite: SiteKey | null = null;
  const defendersMet: Partial<Record<SiteKey, number>> = {};
  for (const e of events) {
    if (e.kind === "planted") plantSite = siteOf(e.zoneId);
    if (e.kind !== "kill") continue;
    const site = siteOf(e.zoneId);
    if (!site) continue;
    firstContactSite ??= site;
    if (String(e.target).startsWith("def")) defendersMet[site] = (defendersMet[site] ?? 0) + 1;
  }
  return { plantSite, firstContactSite, defendersMet };
}

/**
 * Run a full match. Pure given its config: no I/O, no clock — only the seeded RNG.
 */
export function runMatch(config: MatchConfig, options: RunMatchOptions = {}): MatchResult {
  const engine = new MatchEngine(config, options);
  while (!engine.isFinished()) engine.playRound();
  return engine.result();
}

/**
 * The shared match engine: owns the mutable match state and plays one round at a time. `runMatch`
 * loops it to completion; the interactive session (createMatchSession) drives it round-by-round and
 * injects per-round coach orders. With no orders, playRound reproduces the original loop exactly
 * (byte-identical output), so the default runMatch / sim-batch are unchanged.
 */
export class MatchEngine {
  private readonly spatial: ReturnType<typeof loadSpatial>;
  private readonly weapons = loadWeapons();
  private readonly sq: ReturnType<typeof makeSpatialQuery>;
  /** The map's tactical data, derived from its geometry (sites, entries, aims, defender starts). */
  private readonly tactics: ReturnType<typeof loadTactics>;
  private readonly orbs: ReturnType<typeof loadUltOrbs>;
  private readonly maxRounds: number;
  private readonly skillsBySlot: Record<TeamSlot, ReturnType<typeof rosterSkills>>;
  private readonly traitsBySlot: Record<TeamSlot, TacticalTraits[]>;
  private readonly profilesBySlot: Record<TeamSlot, RosterProfile[]>;
  private readonly consistencyBySlot: Record<TeamSlot, number[]>;
  /** What each team has learned about the other so far this match. */
  private readonly opponentModels: Record<TeamSlot, OpponentModel>;
  private readonly simTuning: { crossfirePenaltyMs?: number; infoWindowMs?: number; damageCarryover?: number; combatCalibration?: { stopTimeScale?: number } };
  private readonly formSigmaMax: number | undefined;
  /** Per roster index: the player's minimum throw rate (max of team and player entries). */
  private readonly throwFloorsBySlot: Record<TeamSlot, number[]>;
  private readonly abilitiesOn: boolean;
  private readonly abilities: ReturnType<typeof loadAbilityCatalog>;
  private readonly policies: ReturnType<typeof makeSimPolicies>;
  private readonly matchId: string;

  private readonly economy: Record<TeamSlot, TeamEconomy> = { A: newTeamEconomy(), B: newTeamEconomy() };
  private readonly score: Record<TeamSlot, number> = { A: 0, B: 0 };
  private readonly memory: Record<TeamSlot, OpponentMemory> = { A: emptyMemory(), B: emptyMemory() };
  private readonly rounds: RoundRecord[] = [];
  private wentToOvertime = false;
  private roundNumber = 1; // the next round to play
  private lastWinner: TeamSlot | null = null;
  /** Per roster index: agent and star rating (who gets the rifle first). */
  private readonly econPlayersBySlot: Record<TeamSlot, PlayerContext[]>;
  /** Team means of the traits the buy decision reads. */
  private readonly econTraitsBySlot: Record<TeamSlot, TeamDecisionTraits>;

  constructor(private readonly config: MatchConfig, private readonly options: RunMatchOptions = {}) {
    this.spatial = loadSpatial(geometryOf(config));
    this.sq = makeSpatialQuery(this.spatial);
    this.tactics = loadTactics(geometryOf(config), this.spatial);
    this.orbs = loadUltOrbs(geometryOf(config));
    this.maxRounds = config.maxRounds ?? 60;
    const ro = config.rosters ?? {};
    this.skillsBySlot = { A: rosterSkills(config.teamA.id, 5, ro.A), B: rosterSkills(config.teamB.id, 5, ro.B) };
    this.traitsBySlot = { A: rosterTraits(config.teamA.id, 5, ro.A), B: rosterTraits(config.teamB.id, 5, ro.B) };
    this.profilesBySlot = { A: rosterProfiles(config.teamA.id, 5, ro.A), B: rosterProfiles(config.teamB.id, 5, ro.B) };
    this.consistencyBySlot = { A: rosterConsistency(config.teamA.id, 5, ro.A), B: rosterConsistency(config.teamB.id, 5, ro.B) };
    this.abilitiesOn = config.enableAbilities ?? false;
    this.abilities = this.abilitiesOn ? loadAbilityCatalog() : NO_ABILITIES;
    const abilityEffect = this.abilitiesOn ? (id: string): string | undefined => this.abilities[id]?.effectType : undefined;
    this.policies = makeSimPolicies(this.sq, abilityEffect, this.spatial, this.tactics);
    this.matchId = `${config.teamA.id}-vs-${config.teamB.id}`;
    const { crossfireMsPerBit, infoHalfLifeMs, formSigmaMax, damageCarryover, movingStopScale, ...policyTuning } = config.tuning ?? {};
    this.policies.attack.setTuning(policyTuning);
    this.policies.defense.setTuning(policyTuning);
    this.simTuning = {
      ...(crossfireMsPerBit !== undefined ? { crossfirePenaltyMs: crossfireMsPerBit } : {}),
      ...(infoHalfLifeMs !== undefined ? { infoWindowMs: infoHalfLifeMs } : {}),
      ...(damageCarryover !== undefined ? { damageCarryover } : {}),
      ...(movingStopScale !== undefined ? { combatCalibration: { stopTimeScale: movingStopScale } } : {}),
    };
    this.formSigmaMax = formSigmaMax;
    const recognition = (slot: TeamSlot) => {
      const pr = this.profilesBySlot[slot];
      return pr.reduce((s, p) => s + p.decisionMaking, 0) / Math.max(1, pr.length);
    };
    this.opponentModels = { A: new OpponentModel(recognition("A")), B: new OpponentModel(recognition("B")) };
    this.throwFloorsBySlot = { A: this.throwFloors(config.teamA.id, ro.A), B: this.throwFloors(config.teamB.id, ro.B) };
    const econPlayers = (slot: TeamSlot): PlayerContext[] => this.skillsBySlot[slot].map((sk, i) => ({
      agent: COMP_LOADOUTS[i]!.agent,
      priority: (sk.aim + sk.reaction + sk.firstBulletAccuracy + sk.crosshairPlacement) / 4,
    }));
    const econTraits = (slot: TeamSlot): TeamDecisionTraits => {
      const pr = this.profilesBySlot[slot];
      const mean = (f: (p: RosterProfile) => number) => pr.reduce((s, p) => s + f(p), 0) / Math.max(1, pr.length);
      return { discipline: mean((p) => p.discipline), gameSense: mean((p) => p.decisionMaking) };
    };
    this.econPlayersBySlot = { A: econPlayers("A"), B: econPlayers("B") };
    this.econTraitsBySlot = { A: econTraits("A"), B: econTraits("B") };
    // [series] Per-team inputs: re-derive the affected values for the slots that have any.
    this.basePolicyTuning = policyTuning;
    for (const slot of ["A", "B"] as const) {
      const inp = config.teamInputs?.[slot];
      if (!inp) continue;
      if (inp.traitDelta) this.traitsBySlot[slot] = applyTraitDelta(this.traitsBySlot[slot], inp.traitDelta);
      if (inp.patternRecognitionDelta || inp.opponentPrior || inp.standingPrior) {
        const model = new OpponentModel(Math.min(1, Math.max(0, recognition(slot) + (inp.patternRecognitionDelta ?? 0))));
        if (inp.opponentPrior) model.seed(inp.opponentPrior);
        if (inp.standingPrior) model.seed(inp.standingPrior, { standing: true });
        this.opponentModels[slot] = model;
      }
    }
  }

  /** [series] Policy tunables shared by both teams (config.tuning minus the simulator-side fields). */
  private readonly basePolicyTuning: Partial<PolicyTuning>;

  /** [series] The side policy's tunables for the team playing that side this round. */
  private policyTuningFor(slot: TeamSlot): Partial<PolicyTuning> {
    const scale = this.config.teamInputs?.[slot]?.throwRateScale;
    if (scale === undefined || scale === 1) return this.basePolicyTuning;
    const base = this.basePolicyTuning.throwRatePerSec ?? DEFAULT_POLICY_TUNING.throwRatePerSec;
    return { ...this.basePolicyTuning, throwRatePerSec: base * Math.max(0, scale) };
  }

  /** [series] Form σ ceiling for a team: the match value, scaled by the team's formSigmaScale. */
  private formSigmaFor(slot: TeamSlot): number | undefined {
    const scale = this.config.teamInputs?.[slot]?.formSigmaScale;
    if (scale === undefined || scale === 1) return this.formSigmaMax;
    return (this.formSigmaMax ?? FORM_SIGMA_MAX) * Math.max(0, scale);
  }

  /**
   * This round's mechanical skills: the roster's ratings with each player's consistency-sized form
   * swing, plus the clutch-driven nerve shift when the round is a pressure round.
   */
  private formSkills(slot: TeamSlot, roundSeed: number, pressure: boolean): ReturnType<typeof rosterSkills> {
    return this.skillsBySlot[slot].map((sk, i) => {
      const rng = mulberry32(deriveSeed(roundSeed, `form:${slot}:${i}`));
      return applyRoundForm(
        sk,
        this.consistencyBySlot[slot][i] ?? 0.6,
        rng(),
        rng(),
        pressure ? { clutch: this.traitsBySlot[slot][i]?.clutch ?? 0.6 } : undefined,
        this.formSigmaFor(slot), // [series] was this.formSigmaMax — identical when no teamInputs
      );
    });
  }

  /** Pressure round: overtime, or either team one round from winning the map. */
  private isPressureRound(roundNumber: number): boolean {
    return roundNumber > REGULATION_ROUNDS || this.score.A >= ROUNDS_TO_WIN - 1 || this.score.B >= ROUNDS_TO_WIN - 1;
  }

  private throwFloors(teamId: string, override?: readonly RosterPlayer[]): number[] {
    const m = this.config.minThrowRates;
    const team = m?.teams?.[teamId] ?? 0;
    return rosterPlayerIds(teamId, 5, override).map((pid) => Math.max(team, (pid && m?.players?.[pid]) || 0));
  }

  private floorMap(slot: TeamSlot, prefix: "atk" | "def"): ReadonlyMap<string, number> {
    return new Map(this.throwFloorsBySlot[slot].map((rate, i) => [`${prefix}${i + 1}`, rate]));
  }

  private profileMap(slot: TeamSlot, prefix: "atk" | "def"): ReadonlyMap<string, PlayerProfile> {
    return new Map(this.profilesBySlot[slot].map((pr, i) => {
      const id = `${prefix}${i + 1}`;
      return [id, { playerId: id as PlayerProfile["playerId"], ...pr }];
    }));
  }

  private teamRef(slot: TeamSlot): TeamRef { return slot === "A" ? this.config.teamA : this.config.teamB; }

  /** Round the engine will play next (1-based). */
  get currentRound(): number { return this.roundNumber; }
  /** The attacking team for the next round. */
  get nextAttacker(): TeamSlot { return attackerFor(this.roundNumber); }
  snapshotEconomy(): Record<TeamSlot, TeamEconomy> { return { A: this.economy.A, B: this.economy.B }; }
  snapshotScore(): Record<TeamSlot, number> { return { ...this.score }; }
  /** What `slot` currently believes about its opponent's tendencies. */
  opponentRead(slot: TeamSlot): OpponentRead { return this.opponentModels[slot].read(); }

  isFinished(): boolean {
    return matchWinner(this.score) !== null || this.roundNumber > this.maxRounds;
  }

  /** Play one round. `orders` (optional) are coach orders for THIS round, per team slot. */
  playRound(orders: Partial<Record<TeamSlot, TeamOrder>> = {}): RoundRecord {
    const roundNumber = this.roundNumber;
    const { config, economy, score, memory } = this;

    // --- Credits reset at the half boundary and each OT round ---
    if (roundNumber === ROUNDS_PER_HALF + 1) {
      economy.A = halfReset(economy.A);
      economy.B = halfReset(economy.B);
    }
    if (isOvertime(roundNumber)) {
      this.wentToOvertime = true;
      economy.A = overtimeReset(economy.A);
      economy.B = overtimeReset(economy.B);
    }

    const attacker = attackerFor(roundNumber);
    const defender = other(attacker);
    const pistol = isPistol(roundNumber);

    // --- Buy phase: per-player buys inside a team plan (an economy call order restricts the plan) ---
    const preBuy: Record<TeamSlot, TeamEconomy> = { A: economy.A, B: economy.B };
    const buyFor = (slot: TeamSlot): BuyDecision => {
      const opp = other(slot);
      const call = orders[slot]?.economy;
      return decideTeamBuy({
        roundNumber,
        score: [score[slot], score[opp]],
        own: economy[slot],
        opp: economy[opp],
        ownPlayers: this.econPlayersBySlot[slot],
        oppPlayers: this.econPlayersBySlot[opp],
        ownTraits: this.econTraitsBySlot[slot],
        oppTraits: this.econTraitsBySlot[opp],
        pistol,
        wonLastRound: this.lastWinner === slot && !pistol && roundNumber !== ROUNDS_PER_HALF + 1,
        ...(call ? { call } : {}),
        abilities: this.abilitiesOn,
        ...(config.economy ? { options: config.economy } : {}),
      });
    };
    const buys: Record<TeamSlot, BuyDecision> = { A: buyFor("A"), B: buyFor("B") };
    economy.A = afterBuy(economy.A, buys.A);
    economy.B = afterBuy(economy.B, buys.B);

    // --- Coach orders → policy (attacker's order to the attack policy, defender's to defense) ---
    this.policies.attack.setOrder(toPolicyOrder(orders[attacker]));
    this.policies.defense.setOrder(toPolicyOrder(orders[defender]));

    // --- Run the round through PV-4's runMatchRound (the match-loop seam) ---
    const seed = deriveSeed(config.seed, `${this.matchId}:round:${roundNumber}`);
    const pressure = this.isPressureRound(roundNumber);
    // Real-roster decision profiles, re-keyed to this round's side-named sim ids (atk1.. / def1..).
    this.policies.attack.setProfiles(this.profileMap(attacker, "atk"));
    this.policies.defense.setProfiles(this.profileMap(defender, "def"));
    const readBefore: Record<TeamSlot, OpponentRead | null> = { A: null, B: null };
    const useMemory = config.opponentMemory ?? true;
    readBefore[attacker] = useMemory ? this.opponentModels[attacker].read() : null;
    readBefore[defender] = useMemory ? this.opponentModels[defender].read() : null;
    this.policies.attack.setOpponentRead(readBefore[attacker]);
    this.policies.defense.setOpponentRead(readBefore[defender]);
    // [series] The side policies are shared, so per-team tunables are re-bound to whoever plays the side.
    if (config.teamInputs) {
      this.policies.attack.setTuning(this.policyTuningFor(attacker));
      this.policies.defense.setTuning(this.policyTuningFor(defender));
    }
    // Per-player save worth from the match economy (a rich player plays a lost round out).
    const saveByCredits = config.economy?.saveByCredits ?? true;
    const worthMap = (slot: TeamSlot, prefix: string): ReadonlyMap<string, boolean> | null =>
      saveByCredits ? new Map(saveWorth(economy[slot], buys[slot]).map((w, i) => [`${prefix}${i + 1}`, w])) : null;
    this.policies.attack.setSaveWorth(worthMap(attacker, "atk"));
    this.policies.defense.setSaveWorth(worthMap(defender, "def"));
    this.policies.attack.setThrowFloors(this.floorMap(attacker, "atk"));
    this.policies.defense.setThrowFloors(this.floorMap(defender, "def"));
    const attackers: MatchRoundTeam = {
      teamId: this.teamRef(attacker).id,
      // Pre-buy bank (what the team could field this round), not the leftover after buying.
      economy: toEconomyState(preBuy[attacker], "attack", buys[attacker]),
      players: makeRoster("attack", buys[attacker], preBuy[attacker], this.formSkills(attacker, seed, pressure), this.abilitiesOn, undefined, this.traitsBySlot[attacker]),
    };
    // Where the five defenders start: the map's derived starts (on Ascent: its two sites twice and
    // mid courtyard, as before). The scripted setups of the abilities mode exist for Ascent only.
    const defSpawns = this.abilitiesOn && this.tactics.mapId === "ascent" ? selectDefenseSetup(config.seed, roundNumber).spawns : this.tactics.defenderStarts;
    const defenders: MatchRoundTeam = {
      teamId: this.teamRef(defender).id,
      economy: toEconomyState(preBuy[defender], "defense", buys[defender]),
      players: makeRoster("defense", buys[defender], preBuy[defender], this.formSkills(defender, seed, pressure), this.abilitiesOn, defSpawns, this.traitsBySlot[defender]),
    };
    const out = runMatchRound({
      spatial: this.spatial,
      weapons: this.weapons,
      abilities: this.abilities,
      policies: toSimPolicies(this.policies),
      attackers,
      defenders,
      seed,
      roundNumber,
      ...(this.abilitiesOn ? { spikeCarrierId: "atk4" } : {}),
      mapId: config.map,
      matchId: this.matchId,
      roundId: `r${roundNumber}`,
      config: { recordPerception: config.recordPerception ?? false, recordTracks: config.recordTracks ?? false, ...(config.collectStats ? { collectStats: true } : {}), ...(config.gaze ? { gaze: true } : {}), ...(config.soundDetail ? { soundDetail: true } : {}), ...(config.floorItems !== false ? { floorItems: { orbs: this.orbs } } : {}), buyPhaseMs: config.buyPhase === false ? 0 : ROUND_RULES.buyPhaseMs.value, movementStyle: config.movementStyle !== false, ...this.simTuning },
    });
    // Clear orders so they do not leak into the next round (the session re-sets them each round).
    this.policies.attack.setOrder(null);
    this.policies.defense.setOrder(null);
    const result = out.round;

    const plans = { [attacker]: this.policies.attack.planSummary(), [defender]: this.policies.defense.planSummary() } as Record<TeamSlot, PlanSummary | null>;
    // --- Each team folds what it OBSERVED this round into its model of the other ---
    const seen = observedTendencies(out.events);
    // Where the attack first SHOWED is what the defense itself heard and saw (its plan keeps it);
    // against the plant site it tells a fake from a straight hit.
    const shown = plans[defender]?.shownSite;
    this.opponentModels[defender].observeRound({
      opponentSide: "attack", plantSite: seen.plantSite, firstContactSite: seen.firstContactSite,
      shownSite: shown === "A" || shown === "B" ? shown : null,
    });
    this.opponentModels[attacker].observeRound({ opponentSide: "defense", defendersMet: seen.defendersMet });

    // --- Resolve outcome onto teams ---
    const winner: TeamSlot = out.winner === "attack" ? attacker : defender;
    const planted = out.events.some((e) => e.kind === "planted");
    const killsOf = (side: Side) => out.players.filter((p) => p.side === side).reduce((s, p) => s + p.kills, 0);
    const kills: Record<TeamSlot, number> = {
      [attacker]: killsOf("attack"),
      [defender]: killsOf("defense"),
    } as Record<TeamSlot, number>;

    // --- Post-round: pickups, then per-player credits / kept equipment / ultimate points ---
    const outcomeById = new Map(out.players.map((p) => [p.id, p]));
    const simId = (slot: TeamSlot, i: number) => `${slot === attacker ? "atk" : "def"}${i + 1}`;
    const startWeapon = new Map<string, string>();
    for (const slot of [attacker, defender]) buys[slot].players.forEach((b, i) => startWeapon.set(simId(slot, i), b.weapon));
    const survivors = new Map(out.players.filter((p) => p.alive).map((p) => [p.id, p.weaponRetained ?? "Classic"]));
    const endZone = new Map(out.players.map((p) => [p.id, p.endZoneId]));
    const picked = postRoundPickups({
      kills: out.events.filter((e) => e.kind === "kill" && e.target).map((e) => ({ ...(e.actor ? { killer: String(e.actor) } : {}), victim: String(e.target), ...(e.zoneId ? { zoneId: e.zoneId } : {}) })),
      startWeapon: floorAfterRound(startWeapon, out.events), survivors, endZone,
    });
    const pickedBy = new Map(picked.map((p) => [p.playerId, p.weapon]));
    const orbs = (id: string) => out.events.filter((e) => (e.kind as string) === "orbPickup" && e.actor === id).length;
    for (const slot of [attacker, defender]) {
      economy[slot] = settleRound(economy[slot], {
        won: winner === slot,
        planted,
        attacking: slot === attacker,
        ultCosts: COMP_LOADOUTS.map((c) => ultCost(c.agent)),
        players: buys[slot].players.map((_, i) => {
          const id = simId(slot, i);
          const o = outcomeById.get(id);
          return {
            alive: o?.alive ?? false,
            kills: o?.kills ?? 0,
            weaponAfter: pickedBy.get(id) ?? o?.weaponRetained ?? null,
            armorRetained: o?.armorRetained ?? 0,
            ultimatePointsEnd: o?.ultimatePointsEnd ?? 0,
            orbs: orbs(id),
            ultimatePointsEarned: o?.ultimatePointsEarned ?? 0,
          };
        }),
      });
    }
    const pickups = picked.map((p) => {
      const slot: TeamSlot = p.playerId.startsWith("atk") ? attacker : defender;
      return { ...p, team: slot, index: Number(p.playerId.slice(3)) - 1 };
    });
    this.lastWinner = winner;

    score[winner] += 1;

    for (const slot of ["A", "B"] as const) {
      const opp = other(slot);
      memory[slot].buyTiers.push(buys[opp].tier);
      if (pistol && memory[slot].pistolWon === null) memory[slot].pistolWon = winner === slot;
      if (winner === slot) memory[slot].roundsWon += 1;
      else memory[slot].roundsLost += 1;
    }

    const record: RoundRecord = {
      roundNumber,
      phase: pistol ? "pistol" : isOvertime(roundNumber) ? "overtime" : "regulation",
      attacker,
      buys,
      winner,
      winnerSide: result.winner,
      reason: result.reason,
      planted,
      kills,
      score: { ...score },
      economy: { A: economy.A, B: economy.B },
      pickups,
      events: result.events,
      decisions: { plans, opponentReadBefore: readBefore, observed: seen },
      replay: toPv6ReplayFormat(result, {
        mapId: config.map,
        mapDisplayName: config.map,
        seed,
        matchId: `${config.teamA.id}-vs-${config.teamB.id}`,
      }),
      ...(result.navTrace ? { navTrace: result.navTrace } : {}),
      ...(result.stats ? { stats: result.stats } : {}),
    };
    this.rounds.push(record);
    this.options.onRound?.(record, { ...score });
    this.roundNumber += 1;
    return record;
  }

  result(): MatchResult {
    const won = matchWinner(this.score);
    const winner: TeamSlot = won ?? (this.score.A >= this.score.B ? "A" : "B");
    return {
      config: this.config,
      winner,
      score: { ...this.score },
      rounds: this.rounds,
      memory: this.memory,
      wentToOvertime: this.wentToOvertime,
    };
  }
}
