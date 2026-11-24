/**
 * TeamDecisionPolicy — the DecisionPolicy the round-simulator drives (Handoff §17).
 *
 * Pipeline per decision: build the zone belief from the view's observation → generate
 * feasible candidates (Action Generator, from a team-only synthetic context) → IGL picks a
 * strategy and re-decides on new info → assign roles → each player picks a command biased
 * by role/strategy/profile → teamwork aligns timing. All randomness flows through the
 * supplied seeded RandomSource, so the same seed yields the same decision sequence.
 *
 * The SpatialQuery and (optional) EconomyEvaluator are CONSTRUCTION dependencies — the
 * per-decision input is only the PolicyView (no WorldState; DECISION-004).
 */
import { annotateRoutes } from "./route-intent.js";
import type {
  ActionCommand,
  DecisionPolicy,
  EconomyEvaluator,
  MapTactics,
  MidControlState,
  MidDecision,
  MoveMode,
  PlayerProfile,
  PolicyDecision,
  PolicyView,
  RandomSource,
  ResolvedMidSidePlan,
  RoleAssignment,
  SpatialQuery,
  TeamStrategy,
  Vector3,
  ZoneId,
} from "@pv/shared-types";
import { buildTeamBelief, enemyPressureOnZone } from "@pv/decision-engine";
import { generateActions, type GenerationResult } from "@pv/action-generator";
import { synthContextFromView } from "./view.js";
import { assignRoles, enemySiteBias, isEco, isPartialBuy, profileFor, reconsider, selectStrategy } from "./igl.js";
import { DEFAULT_MID_CONTROL_TUNING, decideMidCall, midCallWeight, midControlState, ownControl, stepMidControl, type MidCall } from "./mid-control.js";
import { tendencyLean, type OpponentRead } from "./opponent-model.js";
import { choosePlayerCommand, type PlayerChoice } from "./player-policy.js";
import { applyTeamwork, type TeamworkEntry } from "./teamwork.js";
import { chooseMoveMode, withinEarshot, type MoveIntent } from "./movement.js";
import { BASE_FAKE_RATE, NO_EVIDENCE, rotationCount, updateHitBelief, type HitBelief, type SiteEvidence } from "./hit-belief.js";
import { planUtility } from "./utility.js";

export interface TeamPolicyOptions {
  readonly profiles?: ReadonlyMap<string, PlayerProfile>;
  readonly economy?: EconomyEvaluator;
  /**
   * Ability effect lookup (abilityId → primary effectType, e.g. "flash"/"smoke"/"movement").
   * A construction dependency like SpatialQuery: the PolicyView carries ability ids but not their
   * effects, so the policy needs this to coordinate execute utility. Omitted → no util coordination.
   */
  readonly abilityEffect?: (abilityId: string) => string | undefined;
  /**
   * Shop price of a weapon id (credits). The PolicyView carries what each player holds but not what
   * it cost; the save decision needs the value of the gear at stake. Omitted → gear value is unknown
   * and the save is decided on the man count alone.
   */
  readonly weaponPrice?: (weaponId: string) => number | undefined;
  /**
   * Centre of a zone in the same frame as player positions. Lets a player judge whether a run
   * would be inside an enemy's hearing (the audio circle on the minimap). Omitted → the policy
   * falls back on travel time as a stand-in for distance.
   */
  readonly zonePosition?: (zoneId: string) => Vector3 | undefined;
  /**
   * How far running footsteps carry (world units) — by the game's rule, the spike's blast radius
   * (@pv/game-rules). Omitted → DEFAULT_FOOTSTEP_RADIUS_UNITS.
   */
  readonly footstepRadiusUnits?: number;
  /**
   * The map's tactical data (sites, the way in to each, what a defender watches, smoke targets),
   * derived from the map by @pv/spatial-engine. Omitted → the built-in Ascent tables below.
   */
  readonly tactics?: MapTactics;
  /**
   * Mid control (mid-control.ts, docs/MID_CONTROL.md): the team tracks who holds the map's mid and
   * plays on it — a mid party and split hits on attack, rotations through or round mid on
   * defence. Default FALSE (not yet through the real-roster gate): mid is only a label, as before.
   * Needs `tactics` with a mid area.
   */
  readonly midControl?: boolean;
}

/** Footstep audio range when none is injected (mirrors game-rules SPIKE_RULES.blastRadiusM = 50 m, a manual approximation). */
export const DEFAULT_FOOTSTEP_RADIUS_UNITS = 5000;
/** Run speed (world units / s) used to turn the footstep radius into a travel time when zone positions are unknown. */
const RUN_UNITS_PER_SEC = 675;
/**
 * Route cost of a zone of attacker ground for a defender moving before the plant, in units of the
 * SAFEST route weight (7 s each): a way round is taken unless it is more than ~20 s longer per zone avoided.
 */
const ENEMY_GROUND_COST = 3;
/** A fake's show is made by this many players ("few"): enough to be heard as a group, not the team. */
const FEINT_SHOW_SIZE = 2;
/** DEFENSE: footsteps count as evidence for this long after they were last heard. */
const NOISE_WINDOW_MS = 4000;
/** DEFENSE: a sighting counts as evidence for this long. */
const SEEN_WINDOW_MS = 8000;

/** Strategies that commit to a site execute (where entry utility is worth firing). */
const ATTACK_EXECUTE: ReadonlySet<TeamStrategy> = new Set<TeamStrategy>([
  "aExecute",
  "bExecute",
  "cExecute",
  "fakeAtoB",
  "fakeBtoA",
]);
/** A non-carrier within this run-travel time of the site is "entering" → fire entry util now. */
const ENTRY_WINDOW_MS = 3500;
/** A controller within this window of the site smokes the defender angles ahead of the entry. */
const SMOKE_WINDOW_MS = 7000;
/**
 * Defender sightline zones to smoke per objective site (block vision INTO the site, not the team's
 * own entry path). From the PV-1 tactics KB execute utilityRequirements (a-rafters/a-wine, b-heaven
 * side, mid angles). These two tables are Ascent's and are used only when the policy is built
 * without the map's tactics (TeamPolicyOptions.tactics); with them, both come from the map.
 */
const SMOKE_TARGETS: Readonly<Record<string, readonly string[]>> = {
  // The forward CHOKE the attack pushes through: smoking it denies the forward defender's hold
  // angle (the team pushes the smoke; the holder can't pre-aim), then the deeper angle.
  "a-site": ["a-main", "a-rafters", "a-wine"],
  "b-site": ["b-main", "b-boathouse"],
  "mid-courtyard": ["mid-top"],
};
/** Entry choke each defender anchor watches (pre-aim direction); others fall back to the engine default. */
const DEFENSE_AIM: Readonly<Record<string, string>> = {
  "a-site": "a-main",
  "b-site": "b-main",
  "mid-courtyard": "mid-top",
};

/** Full defuse duration (game-rules SPIKE_RULES.defuseDurationMs; round-simulator default). */
const DEFUSE_DURATION_MS = 7000;
/** Where defenders fall back to when they give up a post-plant retake. */
const SAVE_FALLBACK_ZONE = "defender-spawn";
/** The attack's own ground: where it rotates through between sites and falls back to. */
const ATTACK_FALLBACK_ZONE = "attacker-spawn";
/**
 * Pre-match tunables of the decision formulas. Every field has a calibrated default
 * (DEFAULT_POLICY_TUNING); a match may override any subset (MatchConfig.tuning).
 */
export interface PolicyTuning {
  /** Throw hazard λ₀: neutral-profile throws per second of holding a post-plant posture. */
  readonly throwRatePerSec: number;
  /** Throw hazard β: profile sensitivity (each +0.1 of z multiplies the rate by e^(β/10)). */
  readonly throwProfileBeta: number;
  /** Lanchester κ: fighting-strength multiplier of the side holding the ground (the planted spike; before the plant, the sites). */
  readonly postPlantHolderEdge: number;
  /** The defense plays the retake only when its Lanchester win chance is at least this; below it, it saves. */
  readonly retakeMinWinChance: number;
  /**
   * The attack plays the round out before the plant only when its Lanchester win chance is at
   * least this; below it, it saves. Default 0.09 (κ = 1: 1v3 0.10 plays, 2v5 0.14 plays, 1v4 0.06
   * saves) — lower than the defense's retake threshold, calibrated so that rounds run out the
   * clock as often as in real play (docs/STAT_OUTCOME_MATRIX.md §3.6).
   */
  readonly attackSaveMinWinChance: number;
  /** Odds a hero-play lone defender (aggression ≥ 0.75) still accepts. */
  readonly heroMinWinChance: number;
  /**
   * The cheapest weapon (credits) an attack gives a lost round up to keep. Default 1900 — the
   * smallest loss bonus: a gun the next round's loss bonus buys back is not worth saving.
   */
  readonly saveMinWeaponValue: number;
}

/** Defaults behind the 160-match Ascent validation (seeds 1..160); see docs/STAT_OUTCOME_MATRIX.md §6. */
export const DEFAULT_POLICY_TUNING: PolicyTuning = {
  throwRatePerSec: 0.006,
  throwProfileBeta: 3,
  postPlantHolderEdge: 1,
  retakeMinWinChance: 0.15,
  attackSaveMinWinChance: 0.09,
  heroMinWinChance: 0.08,
  saveMinWeaponValue: 1900,
};

/** Aggression at/above which a lone defender plays for the hero clutch. */
const HERO_AGGRESSION = 0.75;
/** Slack kept on top of travel + defuse when the retake waits for the group to stage. */
const RETAKE_TIME_MARGIN_MS = 3000;
/** Plant duration (game-rules SPIKE_RULES.plantDurationMs; round-simulator default). */
const PLANT_DURATION_MS = 4000;
/** Spare clock kept on top of travel + plant before the execute is forced. */
const EXECUTE_TIME_MARGIN_MS = 8000;
/** How much likelier a slow plan commits to the side it already holds, all else equal. */
const SLOW_SIDE_PREFERENCE = 2;
/** Latest round clock (ms remaining) at which a slow plan must have picked its site (earlier when the map needs it: slowCommitClockMs). */
const SLOW_COMMIT_CLOCK_MS = 40_000;

/** Site letter of a zone: from its metadata, else from the callout id ("a-site" → A). */
function siteLetter(spatial: SpatialQuery, z: ZoneId): string | null {
  const id = String(z);
  return spatial.getZoneMeta(z)?.site ?? (id.startsWith("a-") ? "A" : id.startsWith("b-") ? "B" : id.startsWith("c-") ? "C" : null);
}

/** A fake shows presence on the other site for this long before the team turns to the real objective. */
const FEINT_SHOW_MS = 18_000;
/** After a mid-round call change, the new call is held at least this long before another swing. */
const PLAN_COMMIT_MS = 5000;
/** An enemy seen in mid counts as standing there for this long after it was last seen. */
const MID_SEEN_MS = 3000;
/** ATTACK: mid believed held for this long → the slow play commits (hit before the defence adjusts). */
const MID_COMMIT_AFTER_MS = 5000;
/** DEFENCE: with this many or fewer alive before the plant, the mid player falls back to a site. */
const MID_SHORT_HANDED = 3;

/** A read-only summary of a round's plan: the opening call, where it ended, and each revision. */
export interface PlanSummary {
  readonly opening: TeamStrategy;
  readonly strategy: TeamStrategy;
  readonly objective: string | null;
  readonly feint: string | null;
  readonly revisions: ReadonlyArray<{ readonly atMs: number; readonly from: string; readonly to: string; readonly reason: string }>;
  /** ATTACK fakes: how many players made the show (0 when the plan was not a fake). */
  readonly showers?: number;
  /** DEFENSE: the site where the attack's presence first showed (≥ 2 bodies heard or seen), if any. */
  readonly shownSite?: string | null;
  /** DEFENSE: every change of the pre-plant rotation — how many players were sent to which site. */
  readonly rotations?: ReadonlyArray<{ readonly atMs: number; readonly site: string | null; readonly count: number }>;
  /** What the team did about mid and how it believed mid stood (null: no mid on the map, or mid control off). */
  readonly mid?: MidDecision | null;
}

/** A team's mid play for one round: the call, the players sent, and its own running estimate of control. */
interface MidRound {
  readonly call: MidCall;
  party: string[];
  /** The team's estimate of mid control, −1 defence .. +1 attack (mid-control.ts), from its own view only. */
  c: number;
  heldAtMs: number | null;
  lostAtMs: number | null;
  /** The party has given the fight up (lost it, or the team is short-handed). */
  abandoned: boolean;
  prevAlive: Set<string>;
  prevEnemyAlive: number | null;
  /** Round clock at which an enemy was last sensed in mid (Infinity = never). */
  enemyAtClockMs: number;
  /** Own utility in mid counts until the round clock falls to this. */
  utilityUntilClockMs: number;
  lastClockMs: number;
  split: boolean;
  fake: boolean;
  rotatedAround: boolean;
}

/** The team's standing plan for one round (mutable: revised in place as information arrives). */
interface StandingPlan {
  readonly contextId: string;
  readonly side: string;
  readonly opening: TeamStrategy;
  strategy: TeamStrategy;
  /** ATTACK: the site the plan is trying to plant on (zone id), or null when no site is reachable. */
  objective: ZoneId | null;
  /** ATTACK fakes: the site to show presence on first, and the round clock (ms remaining) until which to show it. */
  feint: { site: ZoneId; untilClockMs: number } | null;
  /** ATTACK: the execute has been called (everyone staged, or the clock forced it). Sticky. */
  executeGo: boolean;
  /** ATTACK: a slow (default) plan has not picked its site yet — the team holds lanes and burns clock. */
  uncommitted: boolean;
  /** ATTACK slow play: the site whose approach the team holds while undecided. */
  slowSide: ZoneId | null;
  /** ATTACK: the round was called lost before the plant — the survivors save; the call it replaced. */
  savedFrom: TeamStrategy | null;
  /** DEFENSE: players who have left their angle to chase a beaten attack's exit kills (sticky). */
  readonly chasers: Set<string>;
  /** ATTACK fakes: the few players who make the noise (chosen when the show starts). */
  showers: string[] | null;
  /** ATTACK fakes: which way each shower is currently running on its patrol. */
  readonly patrolLeg: Map<string, "out" | "back">;
  /** DEFENSE: runners heard per site (round clock, count) — the recent-noise window. */
  heard: Array<{ atMs: number; site: string; count: number }>;
  /** DEFENSE: where each defender stood when the round began (its post). */
  readonly home: Map<string, ZoneId>;
  /** DEFENSE: the current pre-plant rotation and when it last changed. */
  rotation: { site: string | null; ids: string[]; changedAtMs: number };
  /** DEFENSE: every change of the rotation, for the round record. */
  readonly rotations: Array<{ atMs: number; site: string | null; count: number }>;
  /** DEFENSE: players who have been rotated this round (they go home when stood down). */
  readonly rotated: Set<string>;
  /** DEFENSE: the latest belief about what the attack is doing, and the evidence it rests on. */
  belief: HitBelief | null;
  evidence: Record<string, SiteEvidence>;
  /** DEFENSE: first site where two or more bodies showed. */
  shownSite: string | null;
  /** Mid play of the round (null: no mid on the map, or mid control off). */
  mid: MidRound | null;
  decidedAtMs: number;
  lastSeenClockMs: number;
  readonly revisions: Array<{ atMs: number; from: string; to: string; reason: string }>;
}

/** Policy decision cadence (round-simulator decisionIntervalTicks × tickMs). */
const DECISION_STEP_SEC = 0.5;

/**
 * Lanchester's square law win chance for `own` fighters against `enemy` (aimed fire: strength ∝ N²),
 * with `enemyEdge` (κ) multiplying the enemy's strength: own² / (own² + κ · enemy²).
 */
export function lanchesterWinChance(own: number, enemy: number, enemyEdge = 1): number {
  const o = own * own;
  const e = enemyEdge * enemy * enemy;
  return o + e === 0 ? 0 : o / (o + e);
}

/**
 * Chance that a player with this profile throws during one decision step of `dtSec` seconds:
 *     λ = max(minRate, λ₀ · exp(β · z)),   p = 1 − e^(−λ · dtSec)
 * `minRatePerSec` is the player's floor (team / player minimum throw rate) — nobody is below it,
 * however disciplined.
 */
export function throwChance(
  profile: Pick<PlayerProfile, "aggression" | "discipline" | "decisionMaking">,
  dtSec: number,
  tuning: Pick<PolicyTuning, "throwRatePerSec" | "throwProfileBeta"> = DEFAULT_POLICY_TUNING,
  minRatePerSec = 0,
): number {
  const z = (profile.aggression - 0.5) - (profile.discipline - 0.5) - (profile.decisionMaking - 0.5);
  const rate = Math.max(minRatePerSec, tuning.throwRatePerSec * Math.exp(tuning.throwProfileBeta * z));
  return 1 - Math.exp(-rate * dtSec);
}

export interface TeamRoundTrace {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly teamId: string;
  readonly side: string;
  readonly openingStrategy: string;
  readonly finalStrategy: string;
  readonly reconsidered: boolean;
  readonly reconsiderReason: string;
  /** The standing plan at this decision: the round's opening call, the current call, its history. */
  readonly plan: {
    readonly opening: string;
    readonly strategy: string;
    /** ATTACK: the site the plan is trying to plant on, and the site a fake shows first. */
    readonly objective: string | null;
    readonly feint: string | null;
    /** Round clock (ms remaining) when the current call was made. */
    readonly decidedAtMs: number;
    readonly revisions: ReadonlyArray<{ readonly atMs: number; readonly from: string; readonly to: string; readonly reason: string }>;
  };
  /** What the call rested on: this round's observations and the cross-round read of the opponent. */
  readonly evidence: {
    readonly seenEnemies: number;
    readonly heardCues: ReadonlyArray<{ readonly kind: string; readonly confidence: number }>;
    readonly siteBias: { readonly A: number; readonly B: number };
    readonly opponentRead: OpponentRead | null;
    /** DEFENSE pre-plant: the belief about what the attack is doing (hit-belief.ts), when computed. */
    readonly hitBelief?: HitBelief | null;
    /** The team's own estimate of mid control at this decision (mid-control.ts), when tracked. */
    readonly midControl?: MidControlState | null;
  };
  readonly roles: readonly RoleAssignment[];
  readonly players: ReadonlyArray<{
    readonly playerId: string;
    readonly role: string;
    readonly chosenActionId: string;
    readonly considered: ReadonlyArray<{ readonly id: string; readonly weight: number }>;
    readonly reason: string;
  }>;
  readonly generation: {
    readonly feasibleCount: number;
    readonly excludedCount: number;
    readonly selected: string | null;
  };
  readonly decision: PolicyDecision;
}

/**
 * A coach/IGL order the policy follows for the round(s) it is set. A forced `strategy` overrides
 * the IGL's own selection; `tempo` nudges aggression; `roles` pins the entry/lurker. Set via
 * `setOrder` (persists until changed/cleared). Used by the interactive match session (timeouts).
 */
export interface PolicyOrder {
  readonly strategy?: TeamStrategy;
  readonly tempo?: "slow" | "normal" | "fast";
  readonly roles?: { readonly entry?: string; readonly lurker?: string };
}

export class TeamDecisionPolicy implements DecisionPolicy {
  private order: PolicyOrder | null = null;
  private profiles: ReadonlyMap<string, PlayerProfile> | undefined;
  /** Per player (sim id): would saving their gear change their next buy? (match economy; see setSaveWorth). */
  private saveWorth: ReadonlyMap<string, boolean> | undefined;
  private tuning: PolicyTuning = DEFAULT_POLICY_TUNING;
  /** What this team has learned about the opponent in earlier rounds (null = no memory). */
  private opponentRead: OpponentRead | undefined;
  /** The standing plan for the round in progress. */
  private plan: StandingPlan | null = null;
  /** The team's pre-match mid plan for this side (see setMidPlan). */
  private midPlan: ResolvedMidSidePlan | null = null;
  private throwFloors: ReadonlyMap<string, number> | undefined;
  /** Post-plant: the defense has called the retake "go" this round (sticky until the next plant). */
  private retakeCommitted = false;
  /** Post-plant: the defense has called the save this round (sticky; see commitDefuser). */
  private saveCommitted = false;
  /** Post-plant: players who have thrown (broken their hold to dry-peek) this round. */
  private readonly throwers = new Set<string>();
  /** Post-plant: the staging zone of each defender's retake approach (assigned once per plant). */
  private readonly retakeStages = new Map<string, ZoneId>();
  /** Zones with a direct edge onto a zone (its entries), cached per zone. */
  private readonly entryCache = new Map<string, readonly ZoneId[]>();
  /** Attack routes by "from>to" (the map graph is static), see planRoute. */
  private readonly routeCache = new Map<string, { route: readonly ZoneId[]; waypoint: ZoneId }>();
  /** Zones the defense watches from its sites (see siteWatched). */
  private watchedCache: ReadonlySet<string> | null = null;
  constructor(
    private readonly spatial: SpatialQuery,
    private readonly options: TeamPolicyOptions = {},
  ) {
    this.profiles = options.profiles;
  }

  /** Set (or clear) the active coach order. Persists across decisions until changed. */
  setOrder(order: PolicyOrder | null): void {
    this.order = order;
  }

  /**
   * Replace the player profiles (tendencies) for upcoming decisions. Sim player ids are side-named
   * (atk1.. / def1..), so the match runner re-binds the real roster's profiles each round.
   */
  setProfiles(profiles: ReadonlyMap<string, PlayerProfile> | null): void {
    this.profiles = profiles ?? undefined;
  }

  /**
   * The match economy's answer, per player (sim id), to "is this player's gear worth a save?": true
   * when their own credits next round could NOT buy it back, false when they could. Set each round by
   * the match runner from per-player credits; a player missing from the map (or no map) falls back on
   * the weapon-price rule (tuning.saveMinWeaponValue).
   */
  setSaveWorth(worth: ReadonlyMap<string, boolean> | null): void {
    this.saveWorth = worth ?? undefined;
  }

  /**
   * The team's cross-round read of the opponent (opponent-model.ts), used as the prior behind the
   * round's opening call. null/omitted → the team plays every round as if it were the first.
   */
  setOpponentRead(read: OpponentRead | null): void {
    this.opponentRead = read ?? undefined;
  }

  /**
   * Bind the plan's call to something executable: the site the attack will actually plant on, and
   * for a fake the site it shows first. Without this the call was only a label — the carrier went
   * to the nearest site whatever the plan said. A call that names a site (A/B execute, fake) fixes
   * the objective; a call that does not (default, mid control) picks one from where the team reads
   * the defense to be thinner — this round's evidence first, the cross-round read behind it.
   */
  private bindObjective(view: PolicyView, plan: StandingPlan, rng: RandomSource): void {
    if (view.side !== "attack") return;
    const sites = new Map<string, ZoneId>();
    for (const z of this.spatial.zonesByType("site")) {
      const letter = siteLetter(this.spatial, z);
      if (letter && this.spatial.isPlantableZone(z) && !sites.has(letter)) sites.set(letter, z);
    }
    const a = sites.get("A") ?? null;
    const b = sites.get("B") ?? null;
    const c = sites.get("C") ?? null;
    const fallback = a ?? b ?? [...sites.values()][0] ?? null;
    const before = plan.objective;
    plan.feint = null;
    switch (plan.strategy) {
      case "aExecute": plan.objective = a ?? fallback; break;
      case "bExecute": plan.objective = b ?? fallback; break;
      case "cExecute": plan.objective = c ?? fallback; break;
      case "fakeAtoB":
        plan.objective = b ?? fallback;
        if (a && b) plan.feint = { site: a, untilClockMs: view.timeRemainingMs - FEINT_SHOW_MS };
        break;
      case "fakeBtoA":
        plan.objective = a ?? fallback;
        if (a && b) plan.feint = { site: b, untilClockMs: view.timeRemainingMs - FEINT_SHOW_MS };
        break;
      default:
        // No site named (default / mid control): play slow. The site is chosen later, on evidence
        // (commitSlowPlan) — keep whatever was already chosen this round.
        if (!plan.objective) plan.uncommitted = a !== null && b !== null;
        if (plan.uncommitted && !plan.slowSide) {
          // the side the slow play leans on: any site with equal chance (two sites: one draw, as before)
          plan.slowSide = c ? [a, b, c][Math.min(2, Math.floor(rng.nextFloat() * 3))]! : rng.nextFloat() < 0.5 ? a : b;
        }
        if (!plan.objective && !plan.uncommitted) plan.objective = fallback;
    }
    if (plan.objective) plan.uncommitted = false;
    if (plan.objective !== before) plan.executeGo = false; // a new target is staged for again
  }

  /** The standing plan of the round in progress / just played (for match records and the debugger). */
  planSummary(): PlanSummary | null {
    const p = this.plan;
    return p ? {
      opening: p.opening, strategy: p.strategy, objective: p.objective, feint: p.feint?.site ?? null, revisions: p.revisions.map((r) => ({ ...r })),
      showers: p.showers?.length ?? 0, shownSite: p.shownSite, rotations: p.rotations.map((r) => ({ ...r })),
      ...(p.mid ? { mid: this.midDecision(p) } : {}),
    } : null;
  }

  /**
   * The round's standing plan. A new round (new context id, or the round clock jumping back up)
   * starts a new plan with one opening call; within a round the same plan object is returned.
   */
  private currentPlan(view: PolicyView, rng: RandomSource): StandingPlan {
    const p = this.plan;
    const sameRound = p && p.contextId === view.contextId && p.side === view.side && view.timeRemainingMs <= p.lastSeenClockMs;
    if (p && sameRound) {
      p.lastSeenClockMs = view.timeRemainingMs;
      return p;
    }
    const opening = selectStrategy(view, this.spatial, rng, this.opponentRead, this.siteLetters(), this.midEnabled() ? midCallWeight(this.options.tactics?.midArea) : undefined);
    this.plan = {
      contextId: view.contextId, side: view.side, opening, strategy: opening,
      objective: null, feint: null, executeGo: false, uncommitted: false, slowSide: null, savedFrom: null, chasers: new Set<string>(),
      showers: null, patrolLeg: new Map(), heard: [], home: new Map(), rotation: { site: null, ids: [], changedAtMs: view.timeRemainingMs },
      rotations: [], rotated: new Set<string>(), belief: null, evidence: {}, shownSite: null, mid: null,
      decidedAtMs: view.timeRemainingMs, lastSeenClockMs: view.timeRemainingMs, revisions: [],
    };
    this.bindObjective(view, this.plan, rng);
    return this.plan;
  }

  /**
   * Keep, or change, the standing plan on this decision's information. A call is committed for
   * PLAN_COMMIT_MS before it can be swung again (a planted spike always overrides), so one stray
   * cue does not flip the team back and forth, while decisive new information still moves it.
   */
  private revisePlan(view: PolicyView, plan: StandingPlan, rng: RandomSource): { reason: string } {
    if (plan.savedFrom) return { reason: "round called lost — saving" };
    const recon = reconsider(view, this.spatial, plan.strategy, rng, this.siteLetters());
    if (!recon.changed) return { reason: recon.reason };
    // An execute that has been called is committed: the enemies now seen on the site are the fight
    // the team came for, not a reason to leave it (and never to walk off a half-taken site).
    if (view.side === "attack" && plan.executeGo) {
      return { reason: `execute on ${plan.objective} is committed — not swinging (${recon.reason})` };
    }
    const heldMs = plan.decidedAtMs - view.timeRemainingMs;
    const urgent = recon.strategy === "retake";
    if (!urgent && plan.revisions.length > 0 && heldMs < PLAN_COMMIT_MS) {
      return { reason: `holding ${plan.strategy} (committed ${heldMs}ms ago) despite: ${recon.reason}` };
    }
    plan.revisions.push({ atMs: view.timeRemainingMs, from: plan.strategy, to: recon.strategy, reason: recon.reason });
    plan.strategy = recon.strategy;
    plan.decidedAtMs = view.timeRemainingMs;
    this.bindObjective(view, plan, rng);
    return { reason: recon.reason };
  }

  // ---- mid control ---------------------------------------------------------------------------

  /**
   * The team's pre-match mid plan for the side this policy plays (MatchConfig.teamInputs.midPlans,
   * resolved for the map). `who.players` must already be sim ids (atk1.. / def1..). null → auto.
   */
  setMidPlan(plan: ResolvedMidSidePlan | null): void {
    this.midPlan = plan;
  }

  /** The team's current estimate of mid control (its own view only) — an input for team belief. */
  midState(): MidControlState | null {
    return this.plan?.mid ? midControlState(this.plan.mid.c) : null;
  }

  private midEnabled(): boolean {
    return this.options.midControl === true && !!this.options.tactics?.midArea;
  }

  private midZones(): ReadonlySet<string> {
    if (!this.midZoneCache) this.midZoneCache = new Set(this.options.tactics?.midArea?.zones ?? []);
    return this.midZoneCache;
  }
  private midZoneCache: ReadonlySet<string> | null = null;

  private midDecision(plan: StandingPlan): MidDecision | null {
    const m = plan.mid;
    if (!m) return null;
    return {
      stance: m.call.stance, by: m.call.by, reason: m.call.reason, party: m.party.slice(), estimate: midControlState(m.c),
      heldAtMs: m.heldAtMs, lostAtMs: m.lostAtMs, split: m.split, fake: m.fake, rotatedAround: m.rotatedAround,
    };
  }

  /** This side's control of mid as the team believes it: +1 = we hold it. 0 when mid is not tracked. */
  private midOwn(plan: StandingPlan): number {
    return plan.mid ? ownControl(plan.mid.c, plan.side === "attack" ? "attack" : "defense") : 0;
  }

  /**
   * Start the round's mid play (once) and update the team's estimate of mid control (every
   * decision). The estimate is fed ONLY what the team knows: its own living players standing in
   * mid, enemies it currently sees there (or saw within MID_SEEN_MS), runners it hears there, its
   * own utility thrown into mid, enemy utility heard there, a teammate who died in mid, and an
   * enemy who died while the team was fighting in mid. Sharpness = ½ + mean decisionMaking.
   */
  private updateMid(view: PolicyView, plan: StandingPlan, rng: RandomSource): void {
    const mid = this.options.tactics?.midArea;
    if (!this.midEnabled() || !mid) return;
    const side = view.side === "attack" ? "attack" : "defense";
    const zones = this.midZones();
    const zoneOf = (v: Vector3) => String(this.spatial.nearestZone({ x: v.x, y: v.y }));
    const alive = view.teammates.filter((p) => p.alive);
    const now = view.timeRemainingMs;
    if (!plan.mid) {
      const resolved: ResolvedMidSidePlan = this.midPlan ?? { stance: "auto", count: "auto", who: "auto", byManager: [] };
      const call = decideMidCall(resolved, mid, { side, eco: isEco(view), partialBuy: isPartialBuy(view), calledMid: plan.opening === "midControl", alive: alive.length });
      let party: string[] = [];
      if (side === "defense") {
        // the defence's mid players are whoever starts in mid (the match runner places them)
        party = alive.filter((p) => zones.has(zoneOf(p.position))).map((p) => String(p.id));
      } else if (call.stance === "contest") {
        const holder = view.spike.holderId ? String(view.spike.holderId) : null;
        const pool = alive.filter((p) => String(p.id) !== holder);
        const roles = assignRoles(view, plan.opening, this.profiles, rng);
        const roleOf = new Map(roles.map((r) => [String(r.playerId), r.role as string]));
        const byAggression = pool.map((p) => ({ id: String(p.id), a: profileFor(p.id, this.profiles).aggression })).sort((p, q) => q.a - p.a || (p.id < q.id ? -1 : 1)).map((p) => p.id);
        let order: string[];
        const who = resolved.who;
        if (who !== "auto" && "players" in who) order = [...who.players.filter((id) => byAggression.includes(id)), ...byAggression];
        else if (who !== "auto" && "roles" in who) order = [...who.roles.flatMap((r) => byAggression.filter((id) => roleOf.get(id) === r)), ...byAggression];
        // the IGL's pick: the entry takes the fight, the lurker plays mid behind it (a lurk through mid)
        else order = [...byAggression.slice(0, 1), ...byAggression.filter((id) => roleOf.get(id) === "lurker"), ...byAggression];
        party = [...new Set(order)].slice(0, call.count);
      }
      plan.mid = {
        call, party, c: 0, heldAtMs: null, lostAtMs: null, abandoned: false,
        prevAlive: new Set(alive.map((p) => String(p.id))), prevEnemyAlive: view.knownEnemyAliveCount,
        enemyAtClockMs: Infinity, utilityUntilClockMs: Infinity, lastClockMs: now, split: false, fake: false, rotatedAround: false,
      };
    }
    const m = plan.mid;
    const dtMs = Math.max(0, m.lastClockMs - now);
    m.lastClockMs = now;
    const own = alive.filter((p) => zones.has(zoneOf(p.position))).length;
    const seen = new Set<string>();
    for (const e of view.observation.visibleEnemies) {
      if (!e.currentlyVisible && Math.abs(view.observation.timestampMs - e.lastSeenAtMs) > MID_SEEN_MS) continue;
      if (zones.has(zoneOf(e.lastSeenPosition))) seen.add(String(e.playerId));
    }
    let heard = 0;
    let enemyUtility = 0;
    for (const e of view.observation.audibleEvents) {
      if (!zones.has(zoneOf(e.approxPosition))) continue;
      if (e.kind === "footstep" || e.kind === "landing") heard++;
      else if (e.kind === "abilityCast") enemyUtility = 1;
    }
    const enemy = Math.max(seen.size, heard);
    if (enemy > 0) m.enemyAtClockMs = now;
    const ownUtility = m.utilityUntilClockMs !== Infinity && now >= m.utilityUntilClockMs ? 1 : 0;
    // fights: a teammate who died in mid; an enemy who died while we stood in mid against one sensed there
    let lost = 0;
    for (const p of view.teammates) if (!p.alive && m.prevAlive.has(String(p.id)) && zones.has(zoneOf(p.position))) lost++;
    const enemyDrop = m.prevEnemyAlive != null && view.knownEnemyAliveCount != null ? Math.max(0, m.prevEnemyAlive - view.knownEnemyAliveCount) : 0;
    const fighting = (own > 0 || lost > 0) && m.enemyAtClockMs !== Infinity && m.enemyAtClockMs - now <= MID_SEEN_MS;
    const won = fighting ? enemyDrop : 0;
    m.prevAlive = new Set(alive.map((p) => String(p.id)));
    m.prevEnemyAlive = view.knownEnemyAliveCount;
    const sharpness = 0.5 + (alive.length > 0 ? alive.reduce((sum, p) => sum + profileFor(p.id, this.profiles).decisionMaking, 0) / alive.length : 0.5);
    const atk = side === "attack";
    m.c = stepMidControl(m.c, {
      attack: atk ? own : enemy, defense: atk ? enemy : own,
      attackUtility: atk ? ownUtility : enemyUtility, defenseUtility: atk ? enemyUtility : ownUtility,
      killsByAttack: atk ? won : lost, killsByDefense: atk ? lost : won,
    }, dtMs, sharpness);
    const mine = ownControl(m.c, side);
    const theta = DEFAULT_MID_CONTROL_TUNING.holdThreshold;
    if (mine >= theta && m.heldAtMs === null) m.heldAtMs = now;
    if (mine <= -theta && m.lostAtMs === null) m.lostAtMs = now;

    // ATTACK: the party gives the fight up when it is lost, or when the team is a player down
    // with no site named yet (a short-handed team does not split itself).
    const prePlant = view.spike.phase === "carried" || view.spike.phase === "dropped";
    if (atk && prePlant && !m.abandoned && m.party.length > 0) {
      const partyAlive = m.party.filter((id) => alive.some((p) => String(p.id) === id));
      const down = view.knownEnemyAliveCount != null && alive.length < view.knownEnemyAliveCount;
      const why = partyAlive.length === 0 ? "the mid party is dead" : mine <= -theta ? "mid is lost" : down && plan.uncommitted ? `a player down ${alive.length}v${view.knownEnemyAliveCount}` : null;
      if (why) {
        m.abandoned = true;
        plan.revisions.push({ atMs: now, from: "mid: contest", to: "mid: give up", reason: `${why} — the team regroups and plays without mid` });
      }
    }
  }

  /** Whether a player is in the attack's mid party and the party is still playing mid. */
  private inMidParty(plan: StandingPlan, id: string): boolean {
    const m = plan.mid;
    return !!m && m.call.stance === "contest" && !m.abandoned && m.party.includes(id);
  }

  /** ATTACK: where the mid party stands to take mid (where the two sides meet) and what it watches there. */
  private midTake(): { zone: ZoneId; aim: ZoneId } | null {
    const mid = this.options.tactics?.midArea;
    if (!mid) return null;
    const zone = mid.contest as ZoneId;
    const toward = this.spatial.findPath(zone, mid.defenseEntry as ZoneId, "run")?.path[1] ?? (this.options.tactics?.aim[mid.contest] as ZoneId | undefined) ?? (mid.defenseEntry as ZoneId);
    return { zone, aim: toward === zone ? (mid.defenseEntry as ZoneId) : toward };
  }

  /**
   * ATTACK: the mid party's own way onto a site — to the mid zone the site's link leaves from,
   * then down the link (MidArea.siteLinks: past the site's main entry). null when mid opens no
   * second lane onto that site; the party then comes in with the team.
   */
  private midRoute(from: ZoneId, site: ZoneId): ZoneId[] | null {
    const mid = this.options.tactics?.midArea;
    const letter = siteLetter(this.spatial, site);
    const link = mid && letter ? mid.siteLinks[letter] : null;
    if (!link) return null;
    const at = link.path.indexOf(String(from));
    if (at >= 0) return link.path.slice(at) as ZoneId[];
    const head = this.spatial.findPath(from, link.from as ZoneId, "run")?.path;
    return head ? [...head, ...(link.path.slice(1) as ZoneId[])] : null;
  }

  /** Where a mid-party player waits before the hit: the last zone of its mid route the site cannot see. */
  private midStage(from: ZoneId, site: ZoneId): ZoneId | null {
    const route = this.midRoute(from, site);
    if (!route) return null;
    for (let i = route.length - 2; i >= 0; i--) if (!this.spatial.hasLineOfSight(route[i]!, site)) return route[i]!;
    return from;
  }

  /**
   * Ground a defender changing position goes round: the attack's own ground (MapTactics
   * .attackerGround), plus mid when the team believes the attack holds it, minus mid when the
   * team believes it holds mid itself. Losing mid is what makes a rotation long.
   */
  private enemyGround(plan: StandingPlan): Set<string> {
    const ground = new Set(this.options.tactics?.attackerGround ?? []);
    const m = plan.mid;
    if (!m) return ground;
    const mine = ownControl(m.c, "defense");
    const theta = DEFAULT_MID_CONTROL_TUNING.holdThreshold;
    if (mine <= -theta) for (const z of this.midZones()) ground.add(z);
    else if (mine >= theta) for (const z of this.midZones()) ground.delete(z);
    return ground;
  }

  /**
   * DEFENCE before the plant, the mid players:
   *   short-handed  with MID_SHORT_HANDED or fewer alive, a mid player with nobody in sight falls
   *                 back to the site with the fewest defenders (its new post) — mid is given up
   *   contest       (a manager's stance) while the team believes it holds mid, the most aggressive
   *                 mid player steps up to where the two sides meet and watches the attack's way in
   */
  private commitDefenseMid(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[]): ActionCommand[] {
    const m = plan.mid;
    const mid = this.options.tactics?.midArea;
    const phase = view.spike.phase;
    if (view.side !== "defense" || !m || !mid || (phase !== "carried" && phase !== "dropped") || m.party.length === 0) return commands.slice();
    const alive = view.teammates.filter((p) => p.alive);
    const zoneOf = (p: PolicyView["teammates"][number]) => this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
    const contact = view.observation.visibleEnemies.some((e) => e.currentlyVisible);
    const zones = this.midZones();
    const sites = this.plantableSites();
    if (!m.abandoned && alive.length <= MID_SHORT_HANDED && !contact) {
      m.abandoned = true;
      plan.revisions.push({ atMs: view.timeRemainingMs, from: "mid: hold", to: "mid: give up", reason: `${alive.length} alive — the mid player falls back to a site` });
      for (const id of m.party) {
        const p = alive.find((t) => String(t.id) === id);
        if (!p || plan.rotated.has(id)) continue;
        const count = (z: ZoneId) => alive.filter((t) => String(t.id) !== id && zoneOf(t) === z).length;
        const post = [...sites].sort((a, b) => count(a) - count(b) || this.legMs(zoneOf(p), a) - this.legMs(zoneOf(p), b))[0];
        if (post) plan.home.set(id, post);
      }
    }
    const theta = DEFAULT_MID_CONTROL_TUNING.holdThreshold;
    const pusher = m.call.stance === "contest" && !m.abandoned && ownControl(m.c, "defense") >= theta
      ? m.party.map((id) => ({ id, a: profileFor(id as PolicyView["teammates"][number]["id"], this.profiles).aggression })).sort((p, q) => q.a - p.a || (p.id < q.id ? -1 : 1))[0]?.id ?? null
      : null;
    return commands.map((c) => {
      const id = String(c.playerId);
      if (!m.party.includes(id) || c.kind === "useAbility" || plan.rotation.ids.includes(id)) return c;
      const p = alive.find((t) => String(t.id) === id);
      if (!p) return c;
      const pz = zoneOf(p);
      if (m.abandoned) {
        const home = plan.home.get(id);
        if (!home || home === pz || zones.has(String(home))) return c;
        const aim = this.aimOf(home);
        return { playerId: p.id, kind: "move", targetZone: home, ...(aim ? { aimZone: aim } : {}), moveMode: this.paceFor(view, p, "quiet", Infinity), executeAtMs: 0, sourceActionId: "mid:fall-back" };
      }
      if (id === pusher && !contact) {
        const target = mid.contest as ZoneId;
        const aim = (this.spatial.findPath(target, mid.attackEntry as ZoneId, "run")?.path[1] ?? (mid.attackEntry as ZoneId)) as ZoneId;
        return pz === target
          ? { playerId: p.id, kind: "hold", aimZone: aim, executeAtMs: 0, sourceActionId: "mid:push-hold" }
          : { playerId: p.id, kind: "move", targetZone: target, aimZone: aim, moveMode: this.paceFor(view, p, "quiet", Infinity), executeAtMs: 0, sourceActionId: "mid:push" };
      }
      return c;
    });
  }

  /** Override any subset of the formula tunables (pre-match option); null restores the defaults. */
  setTuning(tuning: Partial<PolicyTuning> | null): void {
    this.tuning = { ...DEFAULT_POLICY_TUNING, ...(tuning ?? {}) };
  }

  /** Minimum throw rate (per second of holding) per sim player id — the team / player floor. */
  setThrowFloors(floors: ReadonlyMap<string, number> | null): void {
    this.throwFloors = floors ?? undefined;
  }

  /** Pin the ordered entry/lurker roles onto the assignment (if those players are present). */
  private applyRoleOrder(roles: readonly RoleAssignment[]): RoleAssignment[] {
    const r = this.order?.roles;
    if (!r?.entry && !r?.lurker) return roles.slice();
    return roles.map((a) => {
      if (r.entry && String(a.playerId) === r.entry) return { ...a, role: "entry" as const };
      if (r.lurker && String(a.playerId) === r.lurker) return { ...a, role: "lurker" as const };
      return a;
    });
  }

  /**
   * ATTACK execute utility coordination: the policy knows ability ids but not effects, so with an
   * injected effect lookup it fires ENTRY utility (flash/concuss, else a movement dash) only when a
   * non-carrier attacker is within the entry window of the objective site — blinding/closing on the
   * defenders at the moment of entry instead of burning charges at spawn. `targetZone` is set to the
   * site so a future PV-4 target-zone ability model (smokes/flashes at a zone) works without a policy
   * change; the current engine applies flash from the caster's line of sight and ignores targetZone.
   * Smokes are intentionally NOT auto-fired here — they deploy at the caster's position today, so an
   * "off-angle" smoke is not yet expressible (PV-4 target-zone support pending). Only non-carrier
   * attackers are touched; the carrier is handled by commitSpikeCarrier.
   */
  private commitAttackUtil(view: PolicyView, strategy: TeamStrategy, commands: readonly ActionCommand[]): ActionCommand[] {
    const out = commands.slice();
    const lookup = this.options.abilityEffect;
    if (!lookup || view.side !== "attack" || !ATTACK_EXECUTE.has(strategy)) return out;
    const phase = view.spike.phase;
    if (phase !== "carried" && phase !== "dropped") return out;

    const holderId = view.spike.holderId;
    const carrier = holderId ? view.teammates.find((p) => String(p.id) === String(holderId)) : null;
    const carrierZone = carrier ? this.spatial.nearestZone({ x: carrier.position.x, y: carrier.position.y }) : null;
    const site = (carrierZone && this.nearestPlantableSite(carrierZone)) ||
      this.spatial.zonesByType("site").find((z) => this.spatial.isPlantableZone(z)) || null;
    if (!site) return out;

    const replace = (arr: ActionCommand[], p: (typeof view.teammates)[number], cmd: ActionCommand) => {
      const idx = arr.findIndex((c) => String(c.playerId) === String(p.id));
      if (idx >= 0) arr[idx] = cmd;
      else arr.push(cmd);
    };
    const effectOf = (id: string): string | undefined => lookup(String(id));
    // Cast discipline: don't cast with an enemy already in the player's zone (fight, don't cast).
    const enemyInZone = (zone: ZoneId): boolean =>
      view.observation.visibleEnemies.some((e) => this.spatial.nearestZone({ x: e.lastSeenPosition.x, y: e.lastSeenPosition.y }) === zone);
    const smokeTargets = this.smokeTargets(site);

    for (const p of view.teammates) {
      if (!p.alive || (holderId && String(p.id) === String(holderId))) continue;
      const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
      if (pz === site) continue; // already entered
      const t = this.spatial.shortestTravelTimeMs(pz, site, "run");
      if (t === null) continue;
      if (enemyInZone(pz)) continue; // in a fight — shoot, don't cast

      const slots = [...p.abilities.basic, ...(p.abilities.signature ? [p.abilities.signature] : [])];
      const avail = (fx: (e: string | undefined) => boolean) => slots.find((a) => a.charges > 0 && fx(effectOf(a.abilityId)));

      // Controller smoke ahead of the entry: block a defender sightline zone (not the entry path).
      const smoke = avail((e) => e === "smoke" || e === "wall");
      if (smoke && t <= SMOKE_WINDOW_MS) {
        const target = smokeTargets.find((z) => z !== pz) as ZoneId | undefined;
        if (target) {
          replace(out, p, { playerId: p.id, kind: "useAbility", abilityId: smoke.abilityId, targetZone: target, executeAtMs: 0, sourceActionId: "attack-util:smoke" });
          continue;
        }
      }
      // Entry flash/dash at the site.
      if (t <= ENTRY_WINDOW_MS) {
        const chosen = avail((e) => e === "flash" || e === "concuss") ?? avail((e) => e === "movement");
        if (chosen) {
          replace(out, p, { playerId: p.id, kind: "useAbility", abilityId: chosen.abilityId, targetZone: site, executeAtMs: 0, sourceActionId: "attack-util:entry" });
        }
      }
    }
    return out;
  }

  /**
   * Ensure the spike carrier COMMITS to the objective (fixes the dominant timeExpired failure:
   * the stochastic per-player draw would re-pick peek/hold every 500ms and interrupt an
   * in-progress plant, so the plant never completed). When attacking and pre-plant, the carrier
   * deterministically (a) moves to the nearest plantable site, then (b) plants and keeps
   * planting while on the site. Skipped on a `save` strategy (eco rounds don't suicide-plant).
   * This only overrides the carrier's own command; everyone else's choice is untouched, and no
   * combat parameter is changed — it just stops the carrier abandoning the plant.
   */
  /**
   * ATTACK post-plant contest: after the plant, surviving attackers near the spike hold it
   * (aimZone = plant zone) to watch the defuser instead of wandering off; far attackers keep their
   * drawn command (rotate in / lurk). A holder may throw (see `throws`) and over-peek out of the
   * site toward the retake. The combat engine then resolves the retake fight.
   */
  private commitPostPlantContest(view: PolicyView, commands: readonly ActionCommand[], rng: RandomSource): ActionCommand[] {
    const out = commands.slice();
    if (view.side !== "attack") return out;
    const phase = view.spike.phase;
    if (phase !== "planted" && phase !== "defusing") return out;
    const pos = view.spike.position;
    if (!pos) return out;
    const plantZone = this.spatial.nearestZone({ x: pos.x, y: pos.y });
    // Where a thrower over-peeks to: one zone out of the site, toward the retake.
    const pushOut = this.spatial.findPath(plantZone, SAVE_FALLBACK_ZONE as ZoneId, "run")?.path[1];
    return out.map((c) => {
      if (c.kind === "useAbility" || c.kind === "defuse") return c; // keep util / (n/a on attack)
      const tm = view.teammates.find((p) => String(p.id) === String(c.playerId) && p.alive);
      if (!tm) return c;
      const pz = this.spatial.nearestZone({ x: tm.position.x, y: tm.position.y });
      const near = pz === plantZone || (this.spatial.shortestTravelTimeMs(pz, plantZone, "run") ?? Infinity) <= 3000;
      if (!near) return c; // far — let them rotate in / lurk
      // Throw: gives up the held post-plant angle to go hunting for the retake, with no info.
      if (pushOut && this.throws(tm.id, rng)) {
        return pz === pushOut
          ? { playerId: c.playerId, kind: "hold", executeAtMs: 0, sourceActionId: "throw:overpeek-hold" }
          : { playerId: c.playerId, kind: "move", targetZone: pushOut, moveMode: "run", executeAtMs: 0, sourceActionId: "throw:overpeek" };
      }
      return { playerId: c.playerId, kind: "hold", aimZone: plantZone, executeAtMs: 0, sourceActionId: "attack-postplant-hold" };
    });
  }

  /**
   * Throws (쓰로잉): a player in a winning post-plant posture — an attacker holding the plant, a
   * defender staged for the group retake — sometimes breaks it and dry-peeks alone. Modelled as a
   * proportional-hazards process: while holding, the throw rate is
   *     λ = λ₀ · exp(β · z),   z = (aggression − ½) − (discipline − ½) − (decisionMaking − ½)
   * and the chance in one decision step Δt is p = 1 − e^(−λ·Δt). Sticky for the round. λ₀ is the
   * neutral-profile rate (tuning.throwRatePerSec); β = tuning.throwProfileBeta, so each +0.1 of z
   * multiplies the rate by e^(β/10).
   */
  private throws(playerId: PolicyView["teammates"][number]["id"], rng: RandomSource): boolean {
    const key = String(playerId);
    if (this.throwers.has(key)) return true;
    const p = throwChance(profileFor(playerId, this.profiles), DECISION_STEP_SEC, this.tuning, this.throwFloors?.get(key) ?? 0);
    if (rng.nextFloat() >= p) return false;
    this.throwers.add(key);
    return true;
  }

  /**
   * ATTACK pre-plant: play the round out, or save. The mirror of the defense's retake-or-save
   * (retakeViable): before the spike is down the attack still has to take a held site, so by
   * Lanchester's square law its chance is
   *     P(hit) = A² / (A² + κ · D²)       A attackers, D defenders alive, κ = holder edge
   * and below tuning.attackSaveMinWinChance the round is called lost: the survivors fall back to
   * their own spawn by the route of least exposure and keep their weapons, and the clock runs out.
   * With κ = 1 and the 0.09 threshold: 1v2 0.20 play · 2v4 0.20 play · 2v5 0.14 play · 1v3 0.10
   * play · 1v4 0.06 save · 1v5 0.04 save. The attack's threshold is its own tunable, separate from
   * the defense's retake threshold: before the plant the attack still holds the spike and the
   * choice of site, and real rounds rarely run out the clock. A lone hero-play profile
   * (aggression ≥ HERO_AGGRESSION) accepts tuning.heroMinWinChance if that is lower still.
   * Saving only makes sense with something to save: the round is given up only if a survivor holds
   * a weapon worth at least tuning.saveMinWeaponValue (default: the smallest loss bonus — what the
   * team gets for losing anyway). A pistol or a cheap SMG is not worth a round; they play it out.
   * With the match economy's per-player view (setSaveWorth) a gun also counts only if its holder
   * could not buy it back next round from their own credits — a rich player plays the round out.
   * The call is recorded as a plan revision, holds for the round, and is lifted only if the man
   * count comes back to even. Deterministic (no RNG draw). Returns the save orders, or null.
   */
  private commitAttackSave(view: PolicyView, plan: StandingPlan): ActionCommand[] | null {
    const phase = view.spike.phase;
    if (view.side !== "attack" || (phase !== "carried" && phase !== "dropped")) return null;
    const alive = view.teammates.filter((p) => p.alive);
    const enemies = view.knownEnemyAliveCount;
    if (alive.length === 0 || enemies == null || enemies <= 0) return null;
    if (plan.savedFrom && alive.length >= enemies) { // even again — the round is back on
      plan.revisions.push({ atMs: view.timeRemainingMs, from: "save", to: plan.savedFrom, reason: `man count even again (${alive.length}v${enemies}) — play it out` });
      plan.strategy = plan.savedFrom;
      plan.savedFrom = null;
    }
    if (!plan.savedFrom) {
      const t = this.tuning;
      const hero = alive.length === 1 && profileFor(alive[0]!.id, this.profiles).aggression >= HERO_AGGRESSION;
      const chance = lanchesterWinChance(alive.length, enemies, t.postPlantHolderEdge);
      const floor = hero ? Math.min(t.heroMinWinChance, t.attackSaveMinWinChance) : t.attackSaveMinWinChance;
      if (chance >= floor) return null;
      const price = this.options.weaponPrice;
      const priceWorth = (p: (typeof alive)[number]) => !price || (price(String(p.weapon?.weaponId ?? "")) ?? 0) >= t.saveMinWeaponValue;
      // The gun must be worth keeping at all (price rule), and — when the match economy says so —
      // its holder must be unable to buy it back next round with their own credits.
      const worthSaving = alive.some((p) => priceWorth(p) && (this.saveWorth?.get(String(p.id)) ?? true));
      if (!worthSaving) return null; // nothing worth keeping — play the round out
      plan.revisions.push({
        atMs: view.timeRemainingMs, from: plan.strategy, to: "save",
        reason: `round lost ${alive.length}v${enemies} before the plant (Lanchester ${chance.toFixed(2)} < ${floor}) — save`,
      });
      plan.savedFrom = plan.strategy;
      plan.strategy = "save";
      plan.decidedAtMs = view.timeRemainingMs;
    }
    const home = ATTACK_FALLBACK_ZONE as ZoneId;
    const hasHome = this.spatial.getZoneMeta(home) !== undefined;
    return alive.map((p): ActionCommand => {
      const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
      return !hasHome || pz === home || !this.spatial.isReachable(pz, home)
        ? { playerId: p.id, kind: "hold", executeAtMs: 0, sourceActionId: "attack-save:hold" }
        : { playerId: p.id, kind: "move", targetZone: home, moveMode: "run", executeAtMs: 0, sourceActionId: "attack-save:move" };
    });
  }

  /**
   * ATTACK slow play: with no site named, the team takes forward lanes on both sides, HOLDS them
   * (stationary and pre-aimed — a defender who over-extends walks into a set-up gun) and burns
   * clock while information comes in. It commits to a site when
   *  - it is a player up (a pick was found — hit while they are short), or
   *  - the clock reaches the commit clock (slowCommitClockMs: the latest the whole team still makes a cross-map execute).
   * The site is the one this round's evidence shows thinner, with the cross-round read of their
   * defense behind it; the choice is recorded as a plan revision with its reason.
   */
  private commitSlowPlan(view: PolicyView, plan: StandingPlan, rng: RandomSource): void {
    if (view.side !== "attack" || !plan.uncommitted) return;
    const alive = view.teammates.filter((p) => p.alive).length;
    const enemies = view.knownEnemyAliveCount;
    const up = enemies != null && enemies < alive;
    const late = view.timeRemainingMs <= this.slowCommitClockMs(view);
    // Mid taken: the defence has to guess now — hit before it adjusts (mid-control.ts).
    const mid = plan.mid;
    const midHeld = !!mid && mid.call.stance === "contest" && !mid.abandoned && mid.heldAtMs !== null
      && this.midOwn(plan) >= DEFAULT_MID_CONTROL_TUNING.holdThreshold && mid.heldAtMs - view.timeRemainingMs >= MID_COMMIT_AFTER_MS;
    if (!up && !late && !midHeld) return;
    const site = (letter: "A" | "B" | "C"): ZoneId | null =>
      this.spatial.zonesByType("site").find((z) => this.spatial.isPlantableZone(z) && siteLetter(this.spatial, z) === letter) ?? null;
    const a = site("A");
    const b = site("B");
    const c = site("C");
    if (!a || !b) { plan.objective = a ?? b; plan.uncommitted = false; return; }
    const bias = enemySiteBias(view, this.spatial);
    const defA = this.opponentRead ? tendencyLean(this.opponentRead.defenseSite, "A") : 0;
    if (c) {
      // Three sites: each weighted by how much thinner it looks than the most defended of the
      // other two, the A/B read behind it, and the side already held.
      const of = { A: bias.A, B: bias.B, C: bias.C ?? 0 };
      const thin = (k: "A" | "B" | "C"): number => 1 + Math.max(0, Math.max(...(["A", "B", "C"] as const).filter((o) => o !== k).map((o) => of[o])) - of[k]);
      const held = (z: ZoneId): number => (plan.slowSide === z ? SLOW_SIDE_PREFERENCE : 1);
      const w = [thin("A") * (1 + Math.max(0, -defA)) * held(a), thin("B") * (1 + Math.max(0, defA)) * held(b), thin("C") * held(c)];
      let r = rng.nextFloat() * (w[0]! + w[1]! + w[2]!);
      plan.objective = (r -= w[0]!) < 0 ? a : (r -= w[1]!) < 0 ? b : c;
    } else {
    // The side already held is the cheap choice (no cross-map rotate); evidence can outweigh it.
    const wA = (1 + Math.max(0, bias.B - bias.A)) * (1 + Math.max(0, -defA)) * (plan.slowSide === a ? SLOW_SIDE_PREFERENCE : 1);
    const wB = (1 + Math.max(0, bias.A - bias.B)) * (1 + Math.max(0, defA)) * (plan.slowSide === b ? SLOW_SIDE_PREFERENCE : 1);
    plan.objective = rng.nextFloat() * (wA + wB) < wA ? a : b;
    }
    plan.uncommitted = false;
    plan.executeGo = false;
    plan.revisions.push({
      atMs: view.timeRemainingMs, from: `${plan.strategy} (slow)`, to: `commit ${siteLetter(this.spatial, plan.objective)}`,
      reason: up ? `player advantage ${alive}v${enemies} — hit while they are short` : midHeld && !late ? "mid is held — hit before the defence adjusts" : "clock — commit with the information gathered",
    });
    // With mid held and no read of where the defence is thin, the mid party can sell the other
    // site first: it stands between the two and its noise is believable on either. An IGL does
    // this in proportion to how well the team reads the game (mean decisionMaking above ¼, at
    // most every second time), and only with the clock to make the show and still cross.
    if (midHeld && !c && plan.objective && Math.abs(bias.A - bias.B) < 0.5 && mid) {
      const living = view.teammates.filter((p) => p.alive);
      const dm = living.reduce((sum, p) => sum + profileFor(p.id, this.profiles).decisionMaking, 0) / Math.max(1, living.length);
      const holder = view.spike.holderId ? String(view.spike.holderId) : null;
      const showers = mid.party.filter((id) => id !== holder && living.some((p) => String(p.id) === id));
      const clockOk = view.timeRemainingMs - FEINT_SHOW_MS > this.slowCommitClockMs(view);
      if (showers.length > 0 && living.length - showers.length >= 2 && clockOk && rng.nextFloat() < Math.min(0.5, Math.max(0, dm - 0.25))) {
        const other = plan.objective === a ? b : a;
        const from = plan.strategy;
        plan.strategy = plan.objective === b ? "fakeAtoB" : "fakeBtoA";
        plan.feint = { site: other, untilClockMs: view.timeRemainingMs - FEINT_SHOW_MS };
        plan.showers = showers;
        plan.decidedAtMs = view.timeRemainingMs;
        mid.fake = true;
        plan.revisions.push({ atMs: view.timeRemainingMs, from, to: plan.strategy, reason: `mid is held and neither site reads thin — the mid party shows ${siteLetter(this.spatial, other)}, the team hits ${siteLetter(this.spatial, plan.objective)}` });
      }
    }
  }

  /**
   * The latest round clock (ms remaining) at which a slow plan must name its site: late enough to
   * have used the round, early enough that the WHOLE team still makes the hit. The execute is
   * forced when the clock reaches (farthest player's run to the site + plant + margin); for that
   * player to be staged with the others before then it needs its run to the staging zone on top.
   * The site is not chosen yet, so the worst case over the sites counts. Never later than
   * SLOW_COMMIT_CLOCK_MS. (A fixed 40 s left the lurker on the far side every time: the clock
   * forced the hit two seconds after the commit and four players went in without the fifth.)
   */
  private slowCommitClockMs(view: PolicyView): number {
    let need = 0;
    for (const p of view.teammates) {
      if (!p.alive) continue;
      const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
      for (const site of this.plantableSites()) {
        const route = this.planRoute(pz, site).route;
        const toSite = this.routeCost(route, () => false).travelMs;
        const toStage = this.routeCost(this.planRoute(pz, this.stagingZone(pz, site)).route, () => false).travelMs;
        if (Number.isFinite(toSite + toStage)) need = Math.max(need, toSite + toStage);
      }
    }
    return Math.max(SLOW_COMMIT_CLOCK_MS, need + PLANT_DURATION_MS + EXECUTE_TIME_MARGIN_MS);
  }

  /**
   * Lane the slow-playing team holds together: two zones short of the provisional site (a forward
   * lane, not the site's doorway). The side is drawn once per plan; the commit may still switch.
   */
  private slowLane(plan: StandingPlan, from: ZoneId): ZoneId {
    const side = plan.slowSide;
    if (!side) return from;
    const path = this.spatial.findPath(from, side, "run")?.path;
    if (!path || path.length < 3) return from;
    return path[Math.max(0, path.length - 3)]!;
  }

  /**
   * ATTACK pre-plant: the plan is executed as a team, in phases, instead of five players each
   * walking in on their own draw.
   *   show   (fakes only) — non-carriers close on the feint site up to the last zone it cannot
   *            see: presence, no commit. (Standing in the site's doorway is not a show, it is a
   *            fight the team did not plan — and it was losing it.)
   *   stage  — everyone closes to a staging zone on their own route to the objective, out of the
   *            site's sight (so different routes give a split entry).
   *   go     — called once every alive attacker is staged, or when the clock forces it (slowest
   *            travel + plant + margin); sticky for the round. Everyone enters the objective.
   * Every move goes by the route of least exposure (planRoute) and carries the zone to watch on
   * arrival. A player keeps their own choice to cast an ability. The lurker is special only while
   * a slow play is undecided (it holds the far side); once a site is named it joins the team. The
   * carrier never shows on a fake; on "go" it enters with the team and plants (commitSpikeCarrier).
   */
  private commitPlanMovement(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[], roleOf: ReadonlyMap<string, string>): ActionCommand[] {
    if (view.side !== "attack") return commands.slice();
    const phase = view.spike.phase;
    if (phase !== "carried" && phase !== "dropped") return commands.slice();
    const holderId = view.spike.holderId ? String(view.spike.holderId) : null;
    type Mate = PolicyView["teammates"][number];
    const zoneOf = (p: Mate) => this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
    // Go to `target` by the route of least exposure (planRoute) and watch `aim` on arrival: a
    // player who stops with no aim faces wherever the engine defaults to, not what the plan watches.
    // The pace is a decision (movement.ts): the phase gives the intent, the player's position says
    // whether a run would be heard, and the clock says whether walking is still affordable.
    const order = (p: Mate, pz: ZoneId, target: ZoneId, aim: ZoneId, tag: string, intent: MoveIntent, then: ZoneId | null = plan.objective): ActionCommand => {
      if (target === pz) return { playerId: p.id, kind: "hold", aimZone: aim, executeAtMs: 0, sourceActionId: `plan:${tag}-hold` };
      const moveMode = this.paceFor(view, p, intent, intent === "quiet" ? this.quietSlackMs(view, pz, target, then) : 0);
      return { playerId: p.id, kind: "move", targetZone: this.planRoute(pz, target).waypoint, aimZone: aim, moveMode, executeAtMs: 0, sourceActionId: `plan:${tag}-move` };
    };
    // A mid-party order: straight to the zone (the party's way is through mid, not round it).
    const midOrder = (p: Mate, pz: ZoneId, target: ZoneId, aim: ZoneId, tag: string, intent: MoveIntent): ActionCommand => {
      if (target === pz) return { playerId: p.id, kind: "hold", aimZone: aim, executeAtMs: 0, sourceActionId: `mid:${tag}-hold` };
      const moveMode = this.paceFor(view, p, intent, intent === "quiet" ? this.quietSlackMs(view, pz, target, plan.objective) : 0);
      return { playerId: p.id, kind: "move", targetZone: target, aimZone: aim, moveMode, executeAtMs: 0, sourceActionId: `mid:${tag}-move` };
    };
    // The mid party's staging zone for the hit (its own lane onto the site), or null: with the team.
    const midStageOf = (id: string, pz: ZoneId, site: ZoneId): ZoneId | null =>
      this.inMidParty(plan, id) && id !== holderId ? (pz === site ? site : this.midStage(pz, site)) : null;
    const isLurker = (id: string) => roleOf.get(id) === "lurker" && id !== holderId;
    // The lurk (slow play only): hold the approach to the site the team is NOT playing toward, out
    // of that site's sight — map presence on the far side — until the team commits to a site; then
    // the lurker collapses onto the objective and the execute waits for it like for anyone else.
    const lurk = (p: Mate, pz: ZoneId, teamSide: ZoneId | null): ActionCommand | null => {
      const far = this.plantableSites().find((z) => z !== teamSide) ?? null;
      if (!teamSide || !far) return null;
      return order(p, pz, this.stagingZone(pz, far), far, "lurk", "quiet", null);
    };

    if (plan.uncommitted) {
      // Slow play: take a lane and hold it, quietly. A player's own choice to cast an ability is kept.
      return commands.map((c) => {
        const id = String(c.playerId);
        const p = view.teammates.find((t) => String(t.id) === id && t.alive);
        if (!p || c.kind === "useAbility") return c;
        const pz = zoneOf(p);
        // The mid party takes mid: it goes to where the two sides meet and holds it, watching the
        // defenders' way in. The rest hold their lane as on any slow play.
        if (this.inMidParty(plan, id)) {
          const take = this.midTake();
          if (take) return midOrder(p, pz, take.zone, take.aim, "take", "quiet");
        }
        if (isLurker(id)) return lurk(p, pz, plan.slowSide) ?? c;
        const lane = this.slowLane(plan, pz);
        return lane === pz
          ? { playerId: c.playerId, kind: "hold", ...(plan.slowSide ? { aimZone: plan.slowSide } : {}), executeAtMs: 0, sourceActionId: "plan:slow-hold" }
          : { playerId: c.playerId, kind: "move", targetZone: lane, ...(plan.slowSide ? { aimZone: plan.slowSide } : {}), moveMode: this.paceFor(view, p, "quiet", this.quietSlackMs(view, pz, lane, plan.slowSide)), executeAtMs: 0, sourceActionId: "plan:slow-move" };
      });
    }
    if (!plan.objective) return commands.slice();
    const objective = plan.objective;
    const alive = view.teammates.filter((p) => p.alive);
    // A fake's show is made by a few players, chosen once: the most aggressive who are not carrying
    // the spike. The body of the team — and the spike — goes to the real site, quietly. A team too
    // short to split (fewer than three alive) does not fake: it plays the objective straight.
    if (plan.feint && plan.showers === null) {
      const candidates = alive.filter((p) => String(p.id) !== holderId)
        .map((p) => ({ id: String(p.id), aggression: profileFor(p.id, this.profiles).aggression }))
        .sort((a, b) => b.aggression - a.aggression || (a.id < b.id ? -1 : 1));
      plan.showers = candidates.slice(0, Math.max(0, Math.min(FEINT_SHOW_SIZE, alive.length - 2))).map((c) => c.id);
      if (plan.showers.length === 0) plan.feint = null;
    }
    const showing = plan.feint !== null && view.timeRemainingMs > plan.feint.untilClockMs;
    const isShower = (id: string) => showing && (plan.showers?.includes(id) ?? false);
    // The execute waits for everyone who is going to make it. While the show lasts the showers are
    // across the map by design; when its window closes they come round to the real site, and the
    // hit is the whole team — on a defense that may by then be looking the other way.
    const team = alive;

    if (!showing && !plan.executeGo) {
      let staged = true;
      let slowest = 0;
      for (const p of team) {
        const pz = zoneOf(p);
        const midStage = midStageOf(String(p.id), pz, objective);
        if (pz !== objective && pz !== (midStage ?? this.stagingZone(pz, objective))) staged = false;
        slowest = Math.max(slowest, this.routeCost(this.planRoute(pz, objective).route, () => false).travelMs);
      }
      if (staged || view.timeRemainingMs <= slowest + PLANT_DURATION_MS + EXECUTE_TIME_MARGIN_MS) plan.executeGo = true;
    }

    return commands.map((c) => {
      const id = String(c.playerId);
      const p = view.teammates.find((t) => String(t.id) === id && t.alive);
      if (!p || c.kind === "useAbility" || c.kind === "plant") return c;
      const pz = zoneOf(p);
      // The mid party comes onto the site by mid's own way in — the second lane of a split hit.
      const midStage = isShower(id) ? null : midStageOf(id, pz, objective);
      if (midStage) {
        if (plan.mid) plan.mid.split = true;
        return plan.executeGo ? midOrder(p, pz, objective, objective, "go", "fast") : midOrder(p, pz, midStage, objective, "stage", "quiet");
      }
      // go: speed decides the entry — everyone runs.
      if (plan.executeGo) return order(p, pz, objective, objective, "go", "fast");
      // show: the few showers RUN, on purpose, where the feint site can hear them but not see them.
      if (isShower(id)) return order(p, pz, this.showTarget(plan, id, pz, plan.feint!.site), plan.feint!.site, "feint", "loud");
      // stage: close on the objective unannounced — walk wherever a run would be heard, while the clock allows.
      return order(p, pz, this.stagingZone(pz, objective), objective, "stage", "quiet");
    });
  }

  /**
   * Where a shower runs to next. A show has to keep making noise, and footsteps are only made
   * while moving: the shower runs a short patrol between the feint site's staging zone (the last
   * zone the site cannot see) and the zone behind it on the way home — both out of the site's
   * sight. With nothing hidden behind the staging zone it simply holds there.
   */
  private showTarget(plan: StandingPlan, id: string, pz: ZoneId, feintSite: ZoneId): ZoneId {
    const stage = pz === feintSite ? pz : this.stagingZone(pz, feintSite);
    const home = ATTACK_FALLBACK_ZONE as ZoneId;
    const behind = stage !== home ? this.spatial.findPath(stage, home, "run")?.path[1] ?? null : null;
    const back = behind && behind !== feintSite && !this.spatial.hasLineOfSight(behind, feintSite) ? behind : null;
    if (!back) return stage;
    if (pz === stage) plan.patrolLeg.set(id, "back");
    else if (pz === back) plan.patrolLeg.set(id, "out");
    return plan.patrolLeg.get(id) === "back" ? back : stage;
  }

  // ---- walk or run ------------------------------------------------------------------------

  /** Run-time legs summed at walking pace along a route. */
  private walkMs(route: readonly ZoneId[]): number {
    let ms = 0;
    for (let i = 0; i + 1 < route.length; i++) ms += this.spatial.shortestTravelTimeMs(route[i]!, route[i + 1]!, "walk") ?? Infinity;
    return ms;
  }

  /**
   * Clock the ATTACK still has in hand if it does the quiet move at walking pace: time remaining
   * − (walk to `target` + run from there onto the site `then` + plant + the execute margin).
   * Negative → walking would cost the plant, so the move is run.
   */
  private quietSlackMs(view: PolicyView, from: ZoneId, target: ZoneId, then: ZoneId | null): number {
    const walk = this.walkMs(this.planRoute(from, target).route);
    const entry = then && then !== target ? this.legMs(target, then) : 0;
    return view.timeRemainingMs - (walk + entry + PLANT_DURATION_MS + EXECUTE_TIME_MARGIN_MS);
  }

  /**
   * Whether a run at `position` would be heard by an enemy the team believes to be in range:
   * within the footstep radius of a place enemies are believed to be. The attack assumes the
   * sites are held (that is what a defense is) and adds every enemy it has seen; the defense has
   * no such map of the attack and goes by what it has seen and heard. Without zone positions
   * (no `zonePosition` lookup) the radius is applied as a run-travel time to the site instead.
   */
  private audible(view: PolicyView, position: Vector3): boolean {
    const radius = this.options.footstepRadiusUnits ?? DEFAULT_FOOTSTEP_RADIUS_UNITS;
    const listeners: Vector3[] = view.observation.visibleEnemies.map((e) => e.lastSeenPosition);
    if (view.side === "defense") {
      for (const s of view.observation.audibleEvents) listeners.push(s.approxPosition);
      return withinEarshot(position, listeners, radius);
    }
    if (withinEarshot(position, listeners, radius)) return true;
    const lookup = this.options.zonePosition;
    const here = this.spatial.nearestZone({ x: position.x, y: position.y });
    for (const site of this.spatial.zonesByType("site")) {
      const at = lookup?.(String(site));
      if (at ? withinEarshot(position, [at], radius) : this.legMs(here, site) <= (radius / RUN_UNITS_PER_SEC) * 1000) return true;
    }
    return false;
  }

  /** The pace of one move (movement.ts): the plan phase's intent, who can hear, and the clock. */
  private paceFor(view: PolicyView, p: PolicyView["teammates"][number], intent: MoveIntent, slackMs: number): MoveMode {
    return chooseMoveMode({ intent, audible: intent === "quiet" ? this.audible(view, p.position) : true, slackMs });
  }

  /** What a defender standing on a zone watches: from the map's tactics, else Ascent's table. */
  private aimOf(zone: ZoneId | string): ZoneId | undefined {
    const t = this.options.tactics;
    return (t ? t.aim[String(zone)] : DEFENSE_AIM[String(zone)]) as ZoneId | undefined;
  }

  /** Zones to smoke for an execute onto a zone: from the map's tactics, else Ascent's table. */
  private smokeTargets(zone: ZoneId | string): readonly string[] {
    const t = this.options.tactics;
    return (t ? t.smokes[String(zone)] : SMOKE_TARGETS[String(zone)]) ?? [];
  }

  /** The letters of the map's sites ("A", "B", and "C" on a three-site map). */
  private siteLetters(): readonly string[] {
    if (!this.lettersCache) {
      const t = this.options.tactics;
      this.lettersCache = t ? t.sites.map((s) => s.site) : [...new Set(this.plantableSites().map((z) => siteLetter(this.spatial, z)).filter((l): l is string => l !== null))];
    }
    return this.lettersCache;
  }
  private lettersCache: readonly string[] | null = null;

  /** Every plantable site zone, in map order. */
  private plantableSites(): readonly ZoneId[] {
    return this.spatial.zonesByType("site").filter((z) => this.spatial.isPlantableZone(z));
  }

  /** Zones the defense watches from its sites: each site and everything a site has a sightline onto. */
  private siteWatched(): ReadonlySet<string> {
    if (!this.watchedCache) {
      const w = new Set<string>();
      for (const site of this.spatial.zonesByType("site")) {
        w.add(String(site));
        for (const z of this.spatial.visibleZonesFrom(site)) w.add(String(z));
      }
      this.watchedCache = w;
    }
    return this.watchedCache;
  }

  /** Travel time of a route, and how much of it is spent in zones for which `seen` holds. */
  private routeCost(route: readonly ZoneId[], seen: (z: ZoneId) => boolean): { travelMs: number; exposedMs: number } {
    let travelMs = 0;
    let exposedMs = 0;
    for (let i = 0; i + 1 < route.length; i++) {
      const leg = this.legMs(route[i]!, route[i + 1]!);
      travelMs += leg;
      if (seen(route[i]!)) exposedMs += leg;
    }
    return { travelMs, exposedMs };
  }

  /**
   * The attack's route between two zones — a minimal-exposure path, like the retake approach. The
   * shortest path between the two halves of the map runs across defended ground (through a site
   * or its doorway); a team that is rotating does not walk its spike through the site it just
   * decided not to hit. Two candidates are compared: the direct shortest path, and the path back
   * through the team's own spawn. The one that spends less time in zones the sites watch wins
   * (ties: the faster). `waypoint` is the zone to order the player to — the destination itself, or
   * the spawn while the route still has to go around.
   */
  private planRoute(from: ZoneId, to: ZoneId): { route: readonly ZoneId[]; waypoint: ZoneId } {
    if (from === to) return { route: [from], waypoint: to };
    // With mid held, mid is the attack's own ground: time spent in it is not time under the sites' eyes.
    const midOpen = this.midOpen;
    const key = `${String(from)}>${String(to)}${midOpen ? "|mid" : ""}`;
    const hit = this.routeCache.get(key);
    if (hit) return hit;
    const direct = this.spatial.findPath(from, to, "run")?.path ?? null;
    const spawn = ATTACK_FALLBACK_ZONE as ZoneId;
    let around: ZoneId[] | null = null;
    if (from !== spawn && to !== spawn && this.spatial.getZoneMeta(spawn)) {
      const out = this.spatial.findPath(from, spawn, "run")?.path;
      const back = this.spatial.findPath(spawn, to, "run")?.path;
      if (out && back) around = [...out, ...back.slice(1)];
    }
    let result: { route: readonly ZoneId[]; waypoint: ZoneId };
    if (!direct || !around) {
      result = direct ? { route: direct, waypoint: to } : around ? { route: around, waypoint: spawn } : { route: [from, to], waypoint: to };
    } else {
      const watched = this.siteWatched();
      const mids = this.midZones();
      const seen = (z: ZoneId) => watched.has(String(z)) && !(midOpen && mids.has(String(z)));
      const d = this.routeCost(direct, seen);
      const a = this.routeCost(around, seen);
      const goAround = a.exposedMs < d.exposedMs || (a.exposedMs === d.exposedMs && a.travelMs < d.travelMs);
      result = goAround ? { route: around, waypoint: spawn } : { route: direct, waypoint: to };
    }
    this.routeCache.set(key, result);
    return result;
  }

  /** ATTACK: the team believes it holds mid this decision (set in decideWithTrace; read by planRoute). */
  private midOpen = false;

  /**
   * Where a player waits before the team enters `site`: the last zone of its route (planRoute) the
   * site has no sightline onto. Players on different routes stage on different entries.
   */
  private stagingZone(from: ZoneId, site: ZoneId): ZoneId {
    if (from === site) return site;
    const route = this.planRoute(from, site).route;
    for (let i = route.length - 2; i >= 0; i--) {
      if (!this.spatial.hasLineOfSight(route[i]!, site)) return route[i]!;
    }
    return from;
  }

  private commitSpikeCarrier(
    view: PolicyView,
    strategy: TeamStrategy,
    commands: readonly ActionCommand[],
    objective: ZoneId | null = null,
    executeGo = true,
  ): ActionCommand[] {
    const out = commands.slice();
    const holderId = view.spike.holderId;
    const phase = view.spike.phase;
    const canPlant = phase === "carried" || phase === "planting" || phase === "dropped";
    if (view.side !== "attack" || !canPlant || strategy === "save") return out;
    const put = (cmd: ActionCommand) => {
      const idx = out.findIndex((c) => String(c.playerId) === String(cmd.playerId));
      if (idx >= 0) out[idx] = cmd;
      else out.push(cmd);
    };

    // Dropped spike (carrier died): the nearest attacker goes back for it — no spike, no plant.
    if (!holderId) {
      const pos = view.spike.position;
      if (!pos) return out;
      const spikeZone = this.spatial.nearestZone({ x: pos.x, y: pos.y });
      let best: (typeof view.teammates)[number] | null = null;
      let bestMs = Infinity;
      for (const p of view.teammates) {
        if (!p.alive) continue;
        const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
        const t = pz === spikeZone ? 0 : this.spatial.shortestTravelTimeMs(pz, spikeZone, "run");
        if (t !== null && t < bestMs) { bestMs = t; best = p; }
      }
      if (best && bestMs > 0) put({ playerId: best.id, kind: "move", targetZone: spikeZone, moveMode: "run", executeAtMs: 0, sourceActionId: "spike-recover" });
      return out;
    }

    const carrier = view.teammates.find((p) => String(p.id) === String(holderId) && p.alive);
    if (!carrier) return out;

    const carrierZone = this.spatial.nearestZone({ x: carrier.position.x, y: carrier.position.y });
    // The plan's objective site; the nearest site only when the plan has none or it is unreachable.
    const site = objective && this.spatial.isReachable(carrierZone, objective) ? objective : this.nearestPlantableSite(carrierZone);
    // Plant on the site the plan is for — not on whichever plantable zone the carrier happens to
    // be crossing (a rotation through the other site used to start a plant there and walk off it).
    if (this.spatial.isPlantableZone(carrierZone) && (!site || carrierZone === site)) {
      put({ playerId: carrier.id, kind: "plant", targetZone: carrierZone, executeAtMs: 0, sourceActionId: "carrier-commit:plant" });
      return out;
    }
    if (!site) return out; // no reachable plantable site — leave the carrier's drawn command
    // Before the execute is called the carrier stages with the team (commitPlanMovement); once it
    // is, or when there is no team plan to wait on, the carrier goes for the site.
    if (!executeGo) return out;
    put({ playerId: carrier.id, kind: "move", targetZone: this.planRoute(carrierZone, site).waypoint, moveMode: "run", executeAtMs: 0, sourceActionId: "carrier-commit:move" });
    return out;
  }

  /**
   * DEFENSE, before the plant: a defender changing position (a stack, a rotation, going back to its
   * post) goes round the ground the attack holds first (MapTactics.attackerGround) where the map
   * allows. The shortest way between two sites runs through the attackers' lobbies on several maps
   * (Split: A Site > A Main > A Lobby > Sewer > B; Icebox: through Mid Blue); a defender taking it
   * walks alone into five attackers in the first ten seconds. The zone it stands in and the zone it
   * is sent to are never priced, so a deliberate push still goes where it is told.
   */
  private defenseRoutesOnOwnGround(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[]): ActionCommand[] {
    if (view.side !== "defense" || !this.options.tactics?.attackerGround) return commands.slice();
    const ground = this.enemyGround(plan);
    if (ground.size === 0) return commands.slice();
    const midLost = !!plan.mid && ownControl(plan.mid.c, "defense") <= -DEFAULT_MID_CONTROL_TUNING.holdThreshold;
    const phase = view.spike.phase;
    if (phase !== "carried" && phase !== "dropped") return commands.slice();
    return commands.map((c) => {
      if (c.kind !== "move" || !c.targetZone || (c.routePreference && c.routePreference !== "FASTEST")) return c;
      const me = view.teammates.find((p) => String(p.id) === String(c.playerId));
      const own = me ? String(this.spatial.nearestZone({ x: me.position.x, y: me.position.y })) : "";
      const zoneCosts: Record<string, number> = {};
      for (const z of ground) if (z !== String(c.targetZone) && z !== own) zoneCosts[z] = ENEMY_GROUND_COST;
      if (midLost && plan.mid && String(c.sourceActionId ?? "").startsWith("rotate:")) plan.mid.rotatedAround = true;
      return Object.keys(zoneCosts).length ? { ...c, routePreference: "SAFEST" as const, zoneCosts } : c;
    });
  }

  /**
   * DEFENSE pre-plant hold (opening-duel fix): the combat engine grants a stationary defender a
   * pre-aim first-contact edge (preAim = seesEnemy && !enemySeesSelf && !moving). The stochastic
   * draw had defenders move/save off their anchors ~28% of decisions, trading away that edge and
   * walking into attackers — so attackers won 0.75 of opening duels (ScriptedPolicy, which holds
   * anchors, wins only ~0.45). Defenders START on their anchors in the round, so on the
   * no-info hold (`defaultHold`) a move/save is abandoning a held angle: convert those to a hold
   * at the defender's current zone. Peeks (stationary info) and abilities are kept; a deliberate
   * push happens under the aggroPush strategy, which is left to the draw (not a holding strategy).
   */
  private commitDefenseHold(view: PolicyView, strategy: TeamStrategy, commands: readonly ActionCommand[]): ActionCommand[] {
    // Holding strategies only; aggroPush is an intentional push and is left to the draw.
    const holdStrategies = strategy === "defaultHold" || strategy === "stackA" || strategy === "stackB" || strategy === "stackC";
    if (view.side !== "defense" || !holdStrategies) return commands.slice();
    const phase = view.spike.phase;
    if (phase !== "carried" && phase !== "dropped") return commands.slice(); // pre-plant only
    return commands.map((c) => {
      // Hold the angle: move/save/peek off the anchor all trade away the pre-aim edge, and under
      // the peeker-advantage calibration a peeking defender becomes the worse-positioned mover, so
      // convert them to a hold. Ability use is kept. `aimZone` faces the defender at the entry choke
      // for the pre-aim first-contact edge (a targetZone would face them at their own zone).
      if (c.kind !== "move" && c.kind !== "save" && c.kind !== "peek") return c;
      const tm = view.teammates.find((p) => String(p.id) === String(c.playerId) && p.alive);
      if (!tm) return c;
      const anchor = this.spatial.nearestZone({ x: tm.position.x, y: tm.position.y });
      const aimZone = this.aimOf(anchor);
      return { playerId: c.playerId, kind: "hold", ...(aimZone ? { aimZone } : {}), executeAtMs: 0, sourceActionId: "defense-hold" };
    });
  }

  // ---- reading the noise (defense) ----------------------------------------------------------

  /** Site key ("A", "B", …) → its plantable zone. */
  private siteZones(): ReadonlyMap<string, ZoneId> {
    const m = new Map<string, ZoneId>();
    for (const z of this.plantableSites()) {
      const letter = siteLetter(this.spatial, z);
      if (letter && !m.has(letter)) m.set(letter, z);
    }
    return m;
  }

  /** Which site's side of the map a zone belongs to ("a-main" → A; a mid zone that leads to one site → that site), or null. */
  private sideOf(zone: ZoneId, sites: ReadonlyMap<string, ZoneId>): string | null {
    const m = /^([a-z])-/.exec(String(zone));
    const key = m ? m[1]!.toUpperCase() : null;
    if (key && sites.has(key)) return key;
    // a zone whose name does not say (mid, bridges): the site it leads the attack to, from the map
    const led = this.options.tactics?.approachSide?.[String(zone)];
    return led && sites.has(led) ? led : null;
  }

  /**
   * What the defense has observed per site, in the recent window — the evidence the belief is
   * updated on (hit-belief.ts). Footsteps are instantaneous, so the count of distinct runners is
   * remembered for NOISE_WINDOW_MS (the most heard at once in that window): a run that stops, or
   * moves away, stops counting. Sightings count for SEEN_WINDOW_MS; shot and ability cues arrive
   * already windowed by the observation.
   */
  private gatherEvidence(view: PolicyView, plan: StandingPlan, sites: ReadonlyMap<string, ZoneId>): Record<string, SiteEvidence> {
    const now = view.timeRemainingMs;
    const zoneAt = (v: Vector3) => this.spatial.nearestZone({ x: v.x, y: v.y });
    const runnersNow = new Map<string, number>();
    const contact = new Set<string>();
    const utility = new Set<string>();
    for (const e of view.observation.audibleEvents) {
      const side = this.sideOf(zoneAt(e.approxPosition), sites);
      if (!side) continue;
      // a landing off a drop is a body arriving there, as a running step is
      if (e.kind === "footstep" || e.kind === "landing") runnersNow.set(side, (runnersNow.get(side) ?? 0) + 1);
      else if (e.kind === "gunfire") contact.add(side);
      else if (e.kind === "abilityCast") utility.add(side);
    }
    for (const [site, count] of runnersNow) plan.heard.push({ atMs: now, site, count });
    plan.heard = plan.heard.filter((h) => h.atMs - now <= NOISE_WINDOW_MS);
    const seen = new Map<string, Set<string>>();
    for (const e of view.observation.visibleEnemies) {
      if (!e.currentlyVisible && Math.abs(e.lastSeenAtMs - view.observation.timestampMs) > SEEN_WINDOW_MS) continue;
      const side = this.sideOf(zoneAt(e.lastSeenPosition), sites);
      if (!side) continue;
      (seen.get(side) ?? seen.set(side, new Set()).get(side)!).add(String(e.playerId));
    }
    const out: Record<string, SiteEvidence> = {};
    for (const site of sites.keys()) {
      const runners = plan.heard.reduce((m, h) => (h.site === site ? Math.max(m, h.count) : m), 0);
      const seenCount = seen.get(site)?.size ?? 0;
      out[site] = { runners, seen: seenCount, contact: seenCount > 0 || contact.has(site), utility: utility.has(site) };
      if (!plan.shownSite && Math.max(runners, seenCount) >= 2) plan.shownSite = site;
    }
    return out;
  }

  /**
   * The defense's belief about what the attack is doing right now (hit-belief.ts), from this
   * round's evidence and the cross-round read of the opponent:
   *   π  where they attack           ← OpponentRead.attackSite
   *   φ  how often they fake         ← OpponentRead.fakeRate (base rate with no data), scaled by
   *      how feasible a fake still is: a show needs clock left to cross the map and plant —
   *      feasibility = clamp((clock − T) / T, 0, 1), T = site-to-site run + plant
   *   τ  how sharply evidence is weighed ← ½ + mean decisionMaking of the living defenders
   */
  private readNoise(view: PolicyView, evidence: Readonly<Record<string, SiteEvidence>>, sites: ReadonlyMap<string, ZoneId>): HitBelief {
    const alive = view.teammates.filter((p) => p.alive);
    const read = this.opponentRead;
    const attackPrior: Record<string, number> = {};
    if (read) for (const [k, v] of Object.entries(read.attackSite.probability)) if (sites.has(k)) attackPrior[k] = v;
    const zones = [...sites.values()];
    let cross = 0;
    for (const a of zones) for (const b of zones) if (a !== b) { const t = this.legMs(a, b); if (Number.isFinite(t)) cross = Math.max(cross, t); }
    const need = cross + PLANT_DURATION_MS;
    const feasibility = need > 0 ? Math.min(1, Math.max(0, (view.timeRemainingMs - need) / need)) : 1;
    const dm = alive.length > 0 ? alive.reduce((sum, p) => sum + profileFor(p.id, this.profiles).decisionMaking, 0) / alive.length : 0.5;
    return updateHitBelief({
      sites: [...sites.keys()],
      evidence,
      enemiesAlive: view.knownEnemyAliveCount ?? 5,
      attackPrior,
      fakeRate: read?.fakeRate?.rate ?? BASE_FAKE_RATE,
      fakeFeasibility: feasibility,
      utilityInPlay: view.teammates.some((p) => p.abilities.basic.length > 0 || p.abilities.signature !== null),
      sharpness: 0.5 + dm,
    });
  }

  /**
   * DEFENSE pre-plant: respond to the read in proportion to the belief. The site with the highest
   * hit belief gets round(P(hit) × available) of the players who are not already posted on it,
   * nearest first (hit-belief.ts rotationCount): a moderate belief sends the rotator as support and
   * leaves the far anchors; a near-certain one sends everyone; a show belief — however loud the
   * noise — sends nobody, because the mass is on show(s), not hit(s). The clock is in the belief:
   * late in the round a fake is no longer feasible, so the same noise reads as a hit.
   *
   * A rotator joins the site as a holder while it is still held (a teammate on it, no enemy seen
   * on it); once it has fallen it stops on its retake approach instead (retakeApproach) — it does
   * not run onto a taken site alone — and is in position when the retake is called. It runs when
   * the hit is likelier than not or the site is in contact (time decides), and walks otherwise
   * where the attack could hear it. Stood down, it goes back to its post.
   *
   * More is sent at once; less only after PLAN_COMMIT_MS (footsteps blink — a rotation does not).
   * Every change is recorded on the plan with what it rested on.
   */
  private decideDefenseRotation(view: PolicyView, plan: StandingPlan): void {
    const phase = view.spike.phase;
    if (view.side !== "defense" || (phase !== "carried" && phase !== "dropped")) return;
    const sites = this.siteZones();
    const alive = view.teammates.filter((p) => p.alive);
    if (sites.size === 0 || alive.length === 0) return;
    const zoneOf = (p: PolicyView["teammates"][number]) => this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
    for (const p of view.teammates) if (!plan.home.has(String(p.id))) plan.home.set(String(p.id), zoneOf(p));

    const evidence = this.gatherEvidence(view, plan, sites);
    const belief = this.readNoise(view, evidence, sites);
    plan.belief = belief;
    plan.evidence = evidence;
    const site = belief.likeliest!;
    const siteZone = sites.get(site)!;
    const pHit = belief.hit[site] ?? 0;
    const available = alive
      .filter((p) => this.sideOf(plan.home.get(String(p.id)) ?? zoneOf(p), sites) !== site)
      .map((p) => ({ p, id: String(p.id), ms: this.legMs(zoneOf(p), siteZone) }))
      .filter((a) => Number.isFinite(a.ms));
    let want = rotationCount(pHit, available.length);
    const now = view.timeRemainingMs;
    const current = plan.rotation;
    const currentAlive = current.ids.filter((id) => alive.some((p) => String(p.id) === id));
    // Standing a rotation down (or swinging it to another site) waits out the commit window.
    const reducing = current.site !== null && (current.site !== site || want < currentAlive.length);
    if (reducing && current.changedAtMs - now < PLAN_COMMIT_MS) return;
    if (current.site !== site) current.ids = [];
    const keep = (id: string) => (current.ids.includes(id) ? 0 : 1);
    const chosen = available
      .sort((a, b) => keep(a.id) - keep(b.id) || a.ms - b.ms || (a.id < b.id ? -1 : 1))
      .slice(0, want)
      .map((a) => a.id);
    want = chosen.length;
    const before = current.site === null ? 0 : currentAlive.length;
    if ((want > 0 ? site : null) !== current.site || want !== before) {
      const e = evidence[site] ?? NO_EVIDENCE;
      const bodies = Math.max(e.runners, e.seen);
      const what = `${bodies} ${e.seen >= e.runners && e.seen > 0 ? "seen" : `runner${bodies === 1 ? "" : "s"} heard`} on ${site}`;
      const elsewhere = [...sites.keys()].filter((k) => k !== site)
        .map((k) => { const o = evidence[k] ?? NO_EVIDENCE; return o.contact ? `contact on ${k}` : Math.max(o.runners, o.seen) > 0 ? `${Math.max(o.runners, o.seen)} on ${k}` : `no contact on ${k}`; }).join(", ");
      const odds = `P(hit ${site}) ${pHit.toFixed(2)}, fake ${belief.fake.toFixed(2)}`;
      const call = want === 0 ? "hold" : want >= available.length ? `stack ${site} ×${want}` : `support ${site} ×${want}`;
      const stackCall = (site === "A" ? "stackA" : site === "B" ? "stackB" : site === "C" ? "stackC" : plan.strategy) as TeamStrategy;
      const next = want > 0 ? stackCall : plan.opening;
      plan.revisions.push({
        atMs: now, from: plan.strategy, to: call,
        reason: `${what}${e.contact ? " with contact" : ""}${elsewhere ? `, ${elsewhere}` : ""} — ${odds} — ${want === 0 ? "stand down, hold" : `rotate ${want}`}`,
      });
      plan.rotations.push({ atMs: now, site: want > 0 ? site : null, count: want });
      plan.strategy = next;
      plan.decidedAtMs = now;
      plan.rotation = { site: want > 0 ? site : null, ids: chosen, changedAtMs: now };
      for (const id of chosen) plan.rotated.add(id);
    } else {
      current.ids = chosen;
    }
  }

  /**
   * The orders of the current rotation (decideDefenseRotation): rotators to the site, stood-down
   * rotators home. A rotator comes in by one of the site's entries (retakeApproach): the fastest
   * while the site is still held — it closes to that approach's staging zone and steps onto the
   * site from there — and the least-exposed once the site has fallen, where it waits in the
   * staging zone for the retake instead of running onto a taken site alone.
   */
  private commitDefenseRotation(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[]): ActionCommand[] {
    const phase = view.spike.phase;
    if (view.side !== "defense" || (phase !== "carried" && phase !== "dropped") || plan.rotated.size === 0 || !plan.belief) return commands.slice();
    const sites = this.siteZones();
    const evidence = plan.evidence;
    const belief = plan.belief;
    const zoneOf = (p: PolicyView["teammates"][number]) => this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
    const rot = plan.rotation;
    const siteZone = rot.site ? sites.get(rot.site)! : null;
    const enemyOnSite = siteZone !== null && view.observation.visibleEnemies.some(
      (e) => e.currentlyVisible && this.spatial.nearestZone({ x: e.lastSeenPosition.x, y: e.lastSeenPosition.y }) === siteZone);
    const held = siteZone !== null && !enemyOnSite &&
      view.teammates.some((p) => p.alive && !rot.ids.includes(String(p.id)) && zoneOf(p) === siteZone);
    const urgent = rot.site !== null && ((belief.hit[rot.site] ?? 0) >= 0.5 || (evidence[rot.site]?.contact ?? false));
    return commands.map((c) => {
      const id = String(c.playerId);
      if (!plan.rotated.has(id) || c.kind === "useAbility") return c;
      const p = view.teammates.find((t) => String(t.id) === id && t.alive);
      if (!p) return c;
      const pz = zoneOf(p);
      if (siteZone && rot.ids.includes(id)) {
        // Held site: nobody is watching its entries, so the fastest approach (a zero budget makes
        // retakeApproach pick by time). Fallen site: the least-exposed one, as for a retake.
        const stage = this.retakeApproach(pz, siteZone, held ? 0 : Infinity, this.enemyGround(plan)).stage;
        const target = pz === siteZone || (held && pz === stage) ? siteZone : stage;
        const aim = target === siteZone ? this.aimOf(siteZone) ?? siteZone : siteZone;
        return target === pz
          ? { playerId: p.id, kind: "hold", aimZone: aim, executeAtMs: 0, sourceActionId: "rotate:hold" }
          : { playerId: p.id, kind: "move", targetZone: target, aimZone: aim, moveMode: this.paceFor(view, p, urgent ? "fast" : "quiet", Infinity), executeAtMs: 0, sourceActionId: "rotate:move" };
      }
      const home = plan.home.get(id);
      if (!home || home === pz) return c;
      const aim = this.aimOf(home);
      return { playerId: p.id, kind: "move", targetZone: home, ...(aim ? { aimZone: aim } : {}), moveMode: this.paceFor(view, p, "quiet", Infinity), executeAtMs: 0, sourceActionId: "rotate:return" };
    });
  }

  /**
   * DEFENSE pre-plant: the exit-kill chase — the third posture of the throw model (see `throws`).
   * The defense reads the same kill feed as the attack: once the attack's chance to still take a
   * site, A² / (A² + κ · D²), is below tuning.attackSaveMinWinChance, the round is won by standing
   * still — the attackers will save (commitAttackSave) and the clock does the rest. Leaving the
   * angle to run them down is exactly what a throw is: giving up a winning posture to go hunting.
   * So it follows the same proportional-hazards process as the post-plant throws,
   *     λ = max(floor, λ₀ · exp(β · z)),   z = (aggression − ½) − (discipline − ½) − (decisionMaking − ½)
   * per second of holding a won round with nobody in sight; p = 1 − e^(−λ·Δt) per decision. An
   * aggressive, undisciplined player chases early and often; a disciplined one lets them go. A
   * chaser runs toward the attackers' own ground as a mover onto a set-up saver, so the chase
   * costs kills of its own — and enough of them reopens the round (commitAttackSave lifts the save
   * when the man count is even again). Sticky for the round; the first chase is recorded on the plan.
   */
  private commitDefenseChase(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[], rng: RandomSource): ActionCommand[] {
    const phase = view.spike.phase;
    if (view.side !== "defense" || (phase !== "carried" && phase !== "dropped")) return commands.slice();
    const alive = view.teammates.filter((p) => p.alive);
    const attackers = view.knownEnemyAliveCount;
    const quarry = ATTACK_FALLBACK_ZONE as ZoneId;
    if (alive.length === 0 || attackers == null || attackers <= 0 || !this.spatial.getZoneMeta(quarry)) return commands.slice();
    const t = this.tuning;
    const won = lanchesterWinChance(attackers, alive.length, t.postPlantHolderEdge) < t.attackSaveMinWinChance;
    const contact = view.observation.visibleEnemies.some((e) => e.currentlyVisible);
    if (won && !contact) {
      for (const p of alive) {
        const key = String(p.id);
        if (plan.chasers.has(key)) continue;
        const chance = throwChance(profileFor(p.id, this.profiles), DECISION_STEP_SEC, t, this.throwFloors?.get(key) ?? 0);
        if (rng.nextFloat() >= chance) continue;
        if (plan.chasers.size === 0) {
          plan.revisions.push({
            atMs: view.timeRemainingMs, from: plan.strategy, to: "aggroPush",
            reason: `attack is ${attackers}v${alive.length} down with nothing to play for — ${key} leaves the angle to chase the exit kill`,
          });
        }
        plan.chasers.add(key);
      }
    }
    if (plan.chasers.size === 0) return commands.slice();
    return commands.map((c) => {
      const p = alive.find((d) => String(d.id) === String(c.playerId));
      if (!p || !plan.chasers.has(String(p.id))) return c;
      const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
      return pz === quarry || !this.spatial.isReachable(pz, quarry)
        ? { playerId: p.id, kind: "hold", executeAtMs: 0, sourceActionId: "throw:chase-hold" }
        : { playerId: p.id, kind: "move", targetZone: quarry, moveMode: "run", executeAtMs: 0, sourceActionId: "throw:chase" };
    });
  }

  /**
   * Symmetric to commitSpikeCarrier for the DEFENSE post-plant: without this, a defuse (7000ms
   * of continuous `defuse`) is interrupted every 500ms by the stochastic re-draw and never
   * completes, so defenders never retake and every plant detonates — making matches degenerate
   * (attack-sided, non-converging). The single alive defender nearest the plant commits to
   * retake: move (run) to the plant zone, then `defuse` and keep defusing while on it. Only the
   * chosen defender's command is overridden; no combat parameter is changed.
   */
  private commitDefuser(view: PolicyView, commands: readonly ActionCommand[], rng: RandomSource): ActionCommand[] {
    const out = commands.slice();
    const phase = view.spike.phase;
    if (phase !== "planted" && phase !== "defusing") { // new round / pre-plant
      this.retakeCommitted = this.saveCommitted = false;
      this.throwers.clear();
      this.retakeStages.clear();
    }
    if (view.side !== "defense" || (phase !== "planted" && phase !== "defusing")) return out;
    const pos = view.spike.position;
    if (!pos) return out;
    const plantZone = this.spatial.nearestZone({ x: pos.x, y: pos.y });

    const defenders = view.teammates.filter((p) => p.alive);
    let best: (typeof defenders)[number] | null = null;
    let bestMs = Infinity;
    for (const d of defenders) {
      const t = this.retakeTravelMs(view, d, plantZone);
      if (t < bestMs) {
        bestMs = t;
        best = d;
      }
    }
    if (!best) return out;

    // A called save sticks: one pick on the way out does not turn a lost round back into a retake
    // (the saver would re-peek 1v3 and die) — only an even-or-better man count reopens it.
    const attackersAlive = view.knownEnemyAliveCount;
    if (this.saveCommitted && attackersAlive != null && attackersAlive <= defenders.length) this.saveCommitted = false;
    if (this.saveCommitted || !this.retakeViable(view, defenders, bestMs)) {
      this.saveCommitted = true;
      return this.postPlantSave(view, plantZone, out);
    }

    const byId = new Map(out.map((c) => [String(c.playerId), c]));
    const set = (c: ActionCommand) => byId.set(String(c.playerId), c);

    // Coordinated retake: stage at the entry zones, then go in together (see retakeGo).
    if (!this.retakeCommitted && defenders.length > 1 && !this.retakeGo(view, defenders, plantZone)) {
      for (const d of defenders) {
        const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
        const entry = this.retakeStageOf(view, d, plantZone);
        // Throw: runs onto the site alone instead of waiting for the group.
        if (dz !== plantZone && this.throws(d.id, rng)) {
          set({ playerId: d.id, kind: "move", targetZone: plantZone, moveMode: "run", executeAtMs: 0, sourceActionId: "throw:solo-retake" });
          continue;
        }
        set(dz === entry || dz === plantZone
          ? { playerId: d.id, kind: "hold", aimZone: plantZone, executeAtMs: 0, sourceActionId: "retake-stage:hold" }
          : { playerId: d.id, kind: "move", targetZone: entry, moveMode: "run", executeAtMs: 0, sourceActionId: "retake-stage:move" });
      }
      return [...byId.values()];
    }
    this.retakeCommitted = true;

    // Go: the nearest defender commits to the defuse; the rest swing onto the site with them.
    for (const d of defenders) {
      if (d === best) continue;
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      set(dz === plantZone
        ? { playerId: d.id, kind: "hold", executeAtMs: 0, sourceActionId: "retake-go:hold" }
        : { playerId: d.id, kind: "move", targetZone: plantZone, moveMode: "run", executeAtMs: 0, sourceActionId: "retake-go:move" });
    }
    const bz = this.spatial.nearestZone({ x: best.position.x, y: best.position.y });
    set(bz === plantZone
      ? { playerId: best.id, kind: "defuse", targetZone: plantZone, executeAtMs: 0, sourceActionId: "defuser-commit:defuse" }
      : { playerId: best.id, kind: "move", targetZone: plantZone, moveMode: "run", executeAtMs: 0, sourceActionId: "defuser-commit:move" });
    return [...byId.values()];
  }

  /**
   * Fallback staging zone when no entry of the plant zone can be evaluated (retakeApproach): the
   * last zone before the plant on the defender's shortest route that the plant cannot see.
   */
  private retakeEntry(from: ZoneId, plantZone: ZoneId): ZoneId {
    if (from === plantZone) return plantZone;
    const path = this.spatial.findPath(from, plantZone, "run")?.path;
    if (!path || path.length < 2) return from;
    // Stage out of sight of the spike: the zone nearest the plant on this route with no line of
    // sight onto it (staging in the doorway just feeds the post-plant pre-aim). Fallback: the
    // defender's own zone if every zone on the route sees the plant.
    for (let i = path.length - 2; i >= 0; i--) {
      if (!this.spatial.hasLineOfSight(path[i]!, plantZone)) return path[i]!;
    }
    return from;
  }

  /** Run travel time between two zones (0 for the same zone, ∞ when unreachable). */
  private legMs(from: ZoneId, to: ZoneId): number {
    return from === to ? 0 : this.spatial.shortestTravelTimeMs(from, to, "run") ?? Infinity;
  }

  /** The entries of a zone: every zone with a direct edge onto it. */
  private entriesOf(zone: ZoneId): readonly ZoneId[] {
    const key = String(zone);
    let e = this.entryCache.get(key);
    if (!e) {
      e = this.spatial.allZones().filter((z) => z !== zone && this.spatial.findPath(z, zone, "run")?.path.length === 2);
      this.entryCache.set(key, e);
    }
    return e;
  }

  /**
   * A defender's retake approach — a minimal-exposure path. The attackers holding the spike watch
   * the sightlines out of the plant zone, pre-aimed and standing still; a retaker who crosses one
   * of those sightlines is seen first, mid-stride, by every gun on the site (the worst duel in the
   * engine: the holder's first-sight edge and the crossfire on the entrant). So the approach is
   * chosen like a threat-weighted route: for each entry E of the plant zone,
   *     exposure(E) = Σ time spent in zones the plant zone can see, on  from → E → plant
   *     travel(E)   = time(from → E) + time(E → plant)
   * and the defender takes the entry with the least exposure among those that still leave a full
   * defuse plus the safety margin on the detonation timer (ties: the faster one); when no entry
   * fits the clock, the fastest. It stages at the last zone of that approach the plant cannot see.
   * Nothing here is map-specific — which entry is unwatched falls out of the map's sightlines.
   */
  retakeApproach(from: ZoneId, plantZone: ZoneId, timerMs: number, avoid?: ReadonlySet<string>): { stage: ZoneId; entry: ZoneId; travelMs: number; exposedMs: number } {
    if (from === plantZone) return { stage: plantZone, entry: plantZone, travelMs: 0, exposedMs: 0 };
    // Before the plant (`avoid` = the ground the attack holds first): an approach that comes in
    // through that ground is taken only when the site has no other way in.
    if (avoid && avoid.size > 0) {
      const clean = this.approachAmong(from, plantZone, timerMs, (entry) => (avoid.has(String(entry)) && entry !== from ? null : this.routeAround(from, entry, avoid)));
      if (clean) return clean;
    }
    return this.approachAmong(from, plantZone, timerMs, (entry) => (from === entry ? [from] : this.spatial.findPath(from, entry, "run")?.path ?? null))
      ?? { stage: this.retakeEntry(from, plantZone), entry: from, travelMs: this.legMs(from, plantZone), exposedMs: 0 };
  }

  /** The fastest zone route from `from` to `to` that enters none of `avoid` (the two ends excepted), or null. */
  private routeAround(from: ZoneId, to: ZoneId, avoid: ReadonlySet<string>): ZoneId[] | null {
    if (from === to) return [from];
    const dist = new Map<string, number>([[String(to), 0]]);
    const next = new Map<string, ZoneId>();
    const open: ZoneId[] = [to];
    // backwards from the goal over "zones with a direct edge onto this one" — all the query gives
    while (open.length > 0) {
      open.sort((p, q) => dist.get(String(p))! - dist.get(String(q))!);
      const v = open.shift()!;
      if (v === from) break;
      for (const u of this.entriesOf(v)) {
        if (u !== from && avoid.has(String(u))) continue;
        const d = dist.get(String(v))! + this.legMs(u, v);
        if (d < (dist.get(String(u)) ?? Infinity)) { dist.set(String(u), d); next.set(String(u), v); if (!open.includes(u)) open.push(u); }
      }
    }
    if (!next.has(String(from))) return null;
    const route: ZoneId[] = [from];
    while (route[route.length - 1] !== to) route.push(next.get(String(route[route.length - 1]))!);
    return route;
  }

  private approachAmong(from: ZoneId, plantZone: ZoneId, timerMs: number, routeTo: (entry: ZoneId) => readonly ZoneId[] | null): { stage: ZoneId; entry: ZoneId; travelMs: number; exposedMs: number } | null {
    const seen = (z: ZoneId) => this.spatial.hasLineOfSight(plantZone, z) || this.spatial.hasLineOfSight(z, plantZone);
    let best: { stage: ZoneId; entry: ZoneId; travelMs: number; exposedMs: number; fits: boolean } | null = null;
    for (const entry of this.entriesOf(plantZone)) {
      const route = routeTo(entry);
      if (!route || route.includes(plantZone)) continue; // through the plant is not an approach to it
      const { travelMs, exposedMs } = this.routeCost([...route, plantZone], seen);
      if (!Number.isFinite(travelMs)) continue;
      const fits = travelMs + DEFUSE_DURATION_MS + RETAKE_TIME_MARGIN_MS <= timerMs;
      let stage = from;
      for (let i = route.length - 1; i >= 0; i--) if (!seen(route[i]!)) { stage = route[i]!; break; }
      const better = !best
        || (fits !== best.fits ? fits
          : fits ? exposedMs < best.exposedMs || (exposedMs === best.exposedMs && travelMs < best.travelMs)
          : travelMs < best.travelMs);
      if (better) best = { stage, entry, travelMs, exposedMs, fits };
    }
    return best;
  }

  /**
   * Time a defender still needs to reach the spike: along its own approach (to the staging zone,
   * then onto the plant), or straight there when that is now shorter.
   */
  private retakeTravelMs(view: PolicyView, d: PolicyView["teammates"][number], plantZone: ZoneId): number {
    const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
    if (dz === plantZone) return 0;
    const stage = this.retakeStageOf(view, d, plantZone);
    return Math.min(this.legMs(dz, plantZone), this.legMs(dz, stage) + this.legMs(stage, plantZone));
  }

  /** The staging zone of a defender's retake approach, chosen once when the retake is called. */
  private retakeStageOf(view: PolicyView, d: PolicyView["teammates"][number], plantZone: ZoneId): ZoneId {
    const key = String(d.id);
    let stage = this.retakeStages.get(key);
    if (!stage) {
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      stage = this.retakeApproach(dz, plantZone, view.spike.detonationInMs ?? Infinity).stage;
      this.retakeStages.set(key, stage);
    }
    return stage;
  }

  /**
   * Retake trigger. The old policy sent the nearest defender in alone the instant the spike went
   * down, so retakes trickled in one at a time into attackers holding pre-aimed angles (post-plant
   * duels: attack 83%, a 1v3 post-plant still went to the attack 63%). Real retakes group first.
   * Go when every alive defender is staged (on its entry or the plant zone), or when waiting any
   * longer would leave too little time: the slowest *reachable* defender's travel + a full defuse +
   * a safety margin has reached the detonation timer.
   */
  private retakeGo(view: PolicyView, defenders: ReadonlyArray<PolicyView["teammates"][number]>, plantZone: ZoneId): boolean {
    const timer = view.spike.detonationInMs ?? Infinity;
    let allStaged = true;
    let slowest = 0;
    for (const d of defenders) {
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      if (dz !== plantZone && dz !== this.retakeStageOf(view, d, plantZone)) allStaged = false;
      const t = this.retakeTravelMs(view, d, plantZone);
      if (t + DEFUSE_DURATION_MS <= timer) slowest = Math.max(slowest, t);
    }
    return allStaged || slowest + DEFUSE_DURATION_MS + RETAKE_TIME_MARGIN_MS >= timer;
  }

  /**
   * Post-plant retake viability. Without it the defense ALWAYS retakes, so a plant ends only in a
   * defuse or an attack elimination and never detonates (real Ascent: 8.2% of rounds). The defense
   * gives up the retake when either
   *  - the defuse cannot finish in time: travel to the spike + a full defuse > detonation timer, or
   *  - the fight is not worth taking. Lanchester's square law (aimed fire: fighting strength ∝ N²)
   *    gives the retake's win chance
   *        P(retake) = D² / (D² + κ · A²)      D defenders, A attackers alive, κ = holder edge
   *    and the team saves when P(retake) < tuning.retakeMinWinChance. With κ = 1 and a 0.15 threshold:
   *    1v2 0.20 retake · 2v4 0.20 retake · 2v5 0.14 save · 1v3 0.10 save · 1v4 0.06 save.
   *    A hero-play profile (aggression ≥ HERO_AGGRESSION) accepts worse odds as the last man.
   *    A team/player minimum throw rate (setThrowFloors) floors λ.
   * Deterministic (no RNG draw). The call is sticky for the round (see commitDefuser).
   */
  private retakeViable(view: PolicyView, defenders: ReadonlyArray<PolicyView["teammates"][number]>, defuserTravelMs: number): boolean {
    const timer = view.spike.detonationInMs;
    if (timer != null && defuserTravelMs + DEFUSE_DURATION_MS > timer) return false;
    const attackers = view.knownEnemyAliveCount;
    if (attackers == null || attackers <= 0) return true;
    const hero = defenders.length === 1 && profileFor(defenders[0]!.id, this.profiles).aggression >= HERO_AGGRESSION;
    const t = this.tuning;
    return lanchesterWinChance(defenders.length, attackers, t.postPlantHolderEdge) >= (hero ? t.heroMinWinChance : t.retakeMinWinChance);
  }

  /**
   * Save after a lost post-plant: every alive defender breaks line of sight with the spike instead
   * of feeding the retake — it hides in the nearest zone the plant cannot see, reached without
   * crossing the plant (falling back to the defender spawn), and holds there. Running the whole
   * map to spawn under 4 attackers' sightlines just gets the saver hunted. The attackers may still
   * find them; otherwise the spike detonates.
   */
  private postPlantSave(view: PolicyView, plantZone: ZoneId, commands: readonly ActionCommand[]): ActionCommand[] {
    const byId = new Map(commands.map((c) => [String(c.playerId), c]));
    for (const d of view.teammates) {
      if (!d.alive) continue;
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      const hide = this.saveZone(dz, plantZone);
      const command: ActionCommand = hide === dz
        ? { playerId: d.id, kind: "hold", executeAtMs: 0, sourceActionId: "postplant-save:hold" }
        : { playerId: d.id, kind: "move", targetZone: hide, moveMode: "run", executeAtMs: 0, sourceActionId: "postplant-save:move" };
      byId.set(String(d.id), command);
    }
    return [...byId.values()];
  }

  /** Where a saving defender hides: nearest zone out of the plant's sight, on a route avoiding it. */
  private saveZone(from: ZoneId, plantZone: ZoneId): ZoneId {
    const hidden = (z: ZoneId) => z !== plantZone && !this.spatial.hasLineOfSight(z, plantZone);
    if (hidden(from)) return from;
    let best: ZoneId | null = null;
    let bestMs = Infinity;
    for (const z of this.spatial.allZones()) {
      if (!hidden(z)) continue;
      const route = this.spatial.findPath(from, z, "run");
      if (!route || route.path.includes(plantZone)) continue;
      if (route.timeMs < bestMs) {
        bestMs = route.timeMs;
        best = z;
      }
    }
    if (best) return best;
    const spawn = SAVE_FALLBACK_ZONE as ZoneId;
    return this.spatial.getZoneMeta(spawn) && this.spatial.isReachable(from, spawn) ? spawn : from;
  }

  /** Nearest plantable site to a zone by run travel time (falls back to the first plantable site). */
  private nearestPlantableSite(from: ZoneId): ZoneId | null {
    const plantable = this.spatial.zonesByType("site").filter((z) => this.spatial.isPlantableZone(z));
    let best: ZoneId | null = null;
    let bestMs = Infinity;
    for (const z of plantable) {
      const t = this.spatial.shortestTravelTimeMs(from, z, "run");
      if (t !== null && t < bestMs) {
        bestMs = t;
        best = z;
      }
    }
    return best ?? plantable[0] ?? null;
  }

  private candidates(view: PolicyView): GenerationResult {
    const belief = buildTeamBelief(view.observation, this.spatial, {
      knownEnemyAliveCount: view.knownEnemyAliveCount,
    });
    const team = synthContextFromView(view);
    return generateActions({
      team,
      spatial: this.spatial,
      enemyPressure: (z) => enemyPressureOnZone(belief, z),
      ...(this.options.economy ? { economy: this.options.economy } : {}),
    });
  }

  decide(view: PolicyView, rng: RandomSource): PolicyDecision {
    return this.decideWithTrace(view, rng).decision;
  }

  decideWithTrace(view: PolicyView, rng: RandomSource): { decision: PolicyDecision; trace: TeamRoundTrace } {
    const generation = this.candidates(view);
    // The plan persists across decisions: the opening call is made ONCE per round (not re-drawn
    // every 500ms) and then only changes when new information justifies it (reconsider).
    const plan = this.currentPlan(view, rng);
    this.updateMid(view, plan, rng);
    this.midOpen = view.side === "attack" && !!plan.mid && !plan.mid.abandoned && this.midOwn(plan) >= DEFAULT_MID_CONTROL_TUNING.holdThreshold;
    const opening = plan.opening;
    const recon = this.revisePlan(view, plan, rng);
    // A coach order (timeout) forces the strategy, overriding the IGL's own call.
    const ordered = this.order?.strategy;
    // The defense reads the noise and sets its rotation before the call is announced (a coach's
    // forced call is not second-guessed).
    if (!ordered) this.decideDefenseRotation(view, plan);
    // A round called lost is saved, unless the coach has ordered a strategy for it.
    const saveOrders = ordered ? null : this.commitAttackSave(view, plan);
    const strategy = ordered ?? plan.strategy;
    const reconReason = ordered ? `order: forced ${ordered}` : recon.reason;
    const reconChanged = ordered ? ordered !== opening : plan.strategy !== opening;
    const roles = this.applyRoleOrder(assignRoles(view, strategy, this.profiles, rng));
    const roleOf = new Map(roles.map((r) => [String(r.playerId), r.role]));

    const alive = view.teammates.filter((p) => p.alive);
    const choices: Array<{ choice: PlayerChoice; entry: TeamworkEntry }> = [];
    for (const p of alive) {
      const role = roleOf.get(String(p.id)) ?? "support";
      const profile = profileFor(p.id, this.profiles);
      const drawn = choosePlayerCommand(String(p.id), role, strategy, generation.feasible, profile, rng);
      // A move the player drew for themselves: an impatient player (aggression > 0.6) takes speed
      // over stealth; anyone else runs only where nobody is in a position to hear it.
      const choice = drawn.command.kind === "move"
        ? { ...drawn, command: { ...drawn.command, moveMode: this.paceFor(view, p, profile.aggression > 0.6 ? "fast" : "quiet", Infinity) } }
        : drawn;
      choices.push({ choice, entry: { command: choice.command, role, profile } });
    }

    let commands = this.commitAttackUtil(view, strategy, applyTeamwork(choices.map((c) => c.entry)));
    if (saveOrders) {
      commands = saveOrders;
    } else {
      commands = planUtility(view, strategy, commands, this.spatial, this.options.abilityEffect);
      this.commitSlowPlan(view, plan, rng);
      commands = this.commitPlanMovement(view, plan, commands, roleOf);
      commands = this.commitSpikeCarrier(view, strategy, commands, plan.objective, plan.executeGo && !plan.uncommitted);
    }
    commands = this.commitPostPlantContest(view, commands, rng);
    commands = this.commitDefenseHold(view, strategy, commands);
    commands = this.commitDefenseMid(view, plan, commands);
    if (!ordered) commands = this.commitDefenseRotation(view, plan, commands);
    commands = this.commitDefenseChase(view, plan, commands, rng);
    commands = this.commitDefuser(view, commands, rng);

    // Route intent: every move order says how it wants to get there (route-intent.ts).
    commands = annotateRoutes(view, strategy, roleOf, commands);
    commands = this.defenseRoutesOnOwnGround(view, plan, commands);
    // own utility thrown into mid counts toward holding it for as long as a smoke lasts
    if (plan.mid && commands.some((c) => c.kind === "useAbility" && c.targetZone && this.midZones().has(String(c.targetZone)))) {
      plan.mid.utilityUntilClockMs = view.timeRemainingMs - SMOKE_WINDOW_MS;
    }

    const decision: PolicyDecision = { strategy, roles, commands };
    const trace: TeamRoundTrace = {
      contextId: view.contextId,
      scenarioRef: view.scenarioRef,
      teamId: String(view.teamId),
      side: view.side,
      openingStrategy: opening,
      finalStrategy: strategy,
      reconsidered: reconChanged,
      reconsiderReason: reconReason,
      plan: { opening, strategy, objective: plan.objective, feint: plan.feint?.site ?? null, decidedAtMs: plan.decidedAtMs, revisions: plan.revisions },
      evidence: {
        seenEnemies: view.observation.visibleEnemies.length,
        heardCues: view.observation.audibleEvents.map((s) => ({ kind: s.kind, confidence: s.confidence })),
        siteBias: enemySiteBias(view, this.spatial),
        opponentRead: this.opponentRead ?? null,
        hitBelief: plan.belief,
        midControl: plan.mid ? midControlState(plan.mid.c) : null,
      },
      roles,
      players: choices.map(({ choice }, i) => ({
        playerId: String(alive[i]!.id),
        role: roleOf.get(String(alive[i]!.id)) ?? "support",
        chosenActionId: choice.chosenActionId,
        considered: choice.considered,
        reason: choice.reason,
      })),
      generation: {
        feasibleCount: generation.feasible.length,
        excludedCount: generation.excluded.length,
        selected: generation.selected?.id ?? null,
      },
      decision,
    };
    return { decision, trace };
  }
}
