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
import type {
  ActionCommand,
  DecisionPolicy,
  EconomyEvaluator,
  PlayerProfile,
  PolicyDecision,
  PolicyView,
  RandomSource,
  RoleAssignment,
  SpatialQuery,
  TeamStrategy,
  ZoneId,
} from "@pv/shared-types";
import { buildTeamBelief, enemyPressureOnZone } from "@pv/decision-engine";
import { generateActions, type GenerationResult } from "@pv/action-generator";
import { synthContextFromView } from "./view.js";
import { assignRoles, enemySiteBias, profileFor, reconsider, selectStrategy } from "./igl.js";
import { tendencyLean, type OpponentRead } from "./opponent-model.js";
import { choosePlayerCommand, type PlayerChoice } from "./player-policy.js";
import { applyTeamwork, type TeamworkEntry } from "./teamwork.js";
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
}

/** Strategies that commit to a site execute (where entry utility is worth firing). */
const ATTACK_EXECUTE: ReadonlySet<TeamStrategy> = new Set<TeamStrategy>([
  "aExecute",
  "bExecute",
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
 * side, mid angles); a later pass can read these from the KB directly.
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
/**
 * Pre-match tunables of the decision formulas. Every field has a calibrated default
 * (DEFAULT_POLICY_TUNING); a match may override any subset (MatchConfig.tuning).
 */
export interface PolicyTuning {
  /** Throw hazard λ₀: neutral-profile throws per second of holding a post-plant posture. */
  readonly throwRatePerSec: number;
  /** Throw hazard β: profile sensitivity (each +0.1 of z multiplies the rate by e^(β/10)). */
  readonly throwProfileBeta: number;
  /** Lanchester κ: fighting-strength multiplier of the side already holding the planted spike. */
  readonly postPlantHolderEdge: number;
  /** The defense retakes only when the Lanchester win chance is at least this. */
  readonly retakeMinWinChance: number;
  /** Odds a hero-play lone defender (aggression ≥ 0.75) still accepts. */
  readonly heroMinWinChance: number;
}

/** Calibrated on 160 Ascent matches (seeds 1..160) → 8/8 judged metrics vs the VCT baselines. */
export const DEFAULT_POLICY_TUNING: PolicyTuning = {
  throwRatePerSec: 0.006,
  throwProfileBeta: 3,
  postPlantHolderEdge: 1,
  retakeMinWinChance: 0.15,
  heroMinWinChance: 0.08,
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
/** Latest round clock (ms remaining) at which a slow plan must have picked its site. */
const SLOW_COMMIT_CLOCK_MS = 40_000;

/** Site letter of a zone: from its metadata, else from the callout id ("a-site" → A). */
function siteLetter(spatial: SpatialQuery, z: ZoneId): string | null {
  const id = String(z);
  return spatial.getZoneMeta(z)?.site ?? (id.startsWith("a-") ? "A" : id.startsWith("b-") ? "B" : null);
}

/** A fake shows presence on the other site for this long before the team turns to the real objective. */
const FEINT_SHOW_MS = 18_000;
/** After a mid-round call change, the new call is held at least this long before another swing. */
const PLAN_COMMIT_MS = 5000;

/** A read-only summary of a round's plan: the opening call, where it ended, and each revision. */
export interface PlanSummary {
  readonly opening: TeamStrategy;
  readonly strategy: TeamStrategy;
  readonly objective: string | null;
  readonly feint: string | null;
  readonly revisions: ReadonlyArray<{ readonly atMs: number; readonly from: string; readonly to: string; readonly reason: string }>;
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
  private tuning: PolicyTuning = DEFAULT_POLICY_TUNING;
  /** What this team has learned about the opponent in earlier rounds (null = no memory). */
  private opponentRead: OpponentRead | undefined;
  /** The standing plan for the round in progress. */
  private plan: StandingPlan | null = null;
  private throwFloors: ReadonlyMap<string, number> | undefined;
  /** Post-plant: the defense has called the retake "go" this round (sticky until the next plant). */
  private retakeCommitted = false;
  /** Post-plant: the defense has called the save this round (sticky; see commitDefuser). */
  private saveCommitted = false;
  /** Post-plant: players who have thrown (broken their hold to dry-peek) this round. */
  private readonly throwers = new Set<string>();
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
    const fallback = a ?? b ?? [...sites.values()][0] ?? null;
    const before = plan.objective;
    plan.feint = null;
    switch (plan.strategy) {
      case "aExecute": plan.objective = a ?? fallback; break;
      case "bExecute": plan.objective = b ?? fallback; break;
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
        if (plan.uncommitted && !plan.slowSide) plan.slowSide = rng.nextFloat() < 0.5 ? a : b;
        if (!plan.objective && !plan.uncommitted) plan.objective = fallback;
    }
    if (plan.objective) plan.uncommitted = false;
    if (plan.objective !== before) plan.executeGo = false; // a new target is staged for again
  }

  /** The standing plan of the round in progress / just played (for match records and the debugger). */
  planSummary(): PlanSummary | null {
    const p = this.plan;
    return p ? { opening: p.opening, strategy: p.strategy, objective: p.objective, feint: p.feint?.site ?? null, revisions: p.revisions.map((r) => ({ ...r })) } : null;
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
    const opening = selectStrategy(view, this.spatial, rng, this.opponentRead);
    this.plan = {
      contextId: view.contextId, side: view.side, opening, strategy: opening,
      objective: null, feint: null, executeGo: false, uncommitted: false, slowSide: null,
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
    const recon = reconsider(view, this.spatial, plan.strategy, rng);
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
    const smokeTargets = SMOKE_TARGETS[site] ?? [];

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
   * ATTACK slow play: with no site named, the team takes forward lanes on both sides, HOLDS them
   * (stationary and pre-aimed — a defender who over-extends walks into a set-up gun) and burns
   * clock while information comes in. It commits to a site when
   *  - it is a player up (a pick was found — hit while they are short), or
   *  - the clock reaches SLOW_COMMIT_CLOCK_MS (the latest a cross-map execute still fits).
   * The site is the one this round's evidence shows thinner, with the cross-round read of their
   * defense behind it; the choice is recorded as a plan revision with its reason.
   */
  private commitSlowPlan(view: PolicyView, plan: StandingPlan, rng: RandomSource): void {
    if (view.side !== "attack" || !plan.uncommitted) return;
    const alive = view.teammates.filter((p) => p.alive).length;
    const enemies = view.knownEnemyAliveCount;
    const up = enemies != null && enemies < alive;
    const late = view.timeRemainingMs <= SLOW_COMMIT_CLOCK_MS;
    if (!up && !late) return;
    const site = (letter: "A" | "B"): ZoneId | null =>
      this.spatial.zonesByType("site").find((z) => this.spatial.isPlantableZone(z) && siteLetter(this.spatial, z) === letter) ?? null;
    const a = site("A");
    const b = site("B");
    if (!a || !b) { plan.objective = a ?? b; plan.uncommitted = false; return; }
    const bias = enemySiteBias(view, this.spatial);
    const defA = this.opponentRead ? tendencyLean(this.opponentRead.defenseSite, "A") : 0;
    // The side already held is the cheap choice (no cross-map rotate); evidence can outweigh it.
    const wA = (1 + Math.max(0, bias.B - bias.A)) * (1 + Math.max(0, -defA)) * (plan.slowSide === a ? SLOW_SIDE_PREFERENCE : 1);
    const wB = (1 + Math.max(0, bias.A - bias.B)) * (1 + Math.max(0, defA)) * (plan.slowSide === b ? SLOW_SIDE_PREFERENCE : 1);
    plan.objective = rng.nextFloat() * (wA + wB) < wA ? a : b;
    plan.uncommitted = false;
    plan.executeGo = false;
    plan.revisions.push({
      atMs: view.timeRemainingMs, from: `${plan.strategy} (slow)`, to: `commit ${siteLetter(this.spatial, plan.objective)}`,
      reason: up ? `player advantage ${alive}v${enemies} — hit while they are short` : "clock — commit with the information gathered",
    });
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
   *   show   (fakes only) — non-carriers take the doorstep of the feint site: presence, no commit.
   *   stage  — everyone closes to a staging zone on their own route to the objective, out of the
   *            site's sight (so different routes give a split entry).
   *   go     — called once every alive attacker is staged, or when the clock forces it (slowest
   *            travel + plant + margin); sticky for the round. Everyone enters the objective.
   * A player keeps their own choice to cast an ability, and the lurker keeps their own command
   * throughout (a lurk is by definition off the team's timing). The carrier never shows on a fake;
   * on "go" it enters with the team and plants (commitSpikeCarrier).
   */
  private commitPlanMovement(view: PolicyView, plan: StandingPlan, commands: readonly ActionCommand[], roleOf: ReadonlyMap<string, string>): ActionCommand[] {
    if (view.side !== "attack") return commands.slice();
    const phase = view.spike.phase;
    if (phase !== "carried" && phase !== "dropped") return commands.slice();
    if (plan.uncommitted) {
      // Slow play: take a lane and hold it. Abilities and the lurker keep their own command.
      return commands.map((c) => {
        const id = String(c.playerId);
        const p = view.teammates.find((t) => String(t.id) === id && t.alive);
        if (!p || c.kind === "useAbility" || roleOf.get(id) === "lurker") return c;
        const pz = this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
        const lane = this.slowLane(plan, pz);
        return lane === pz
          ? { playerId: c.playerId, kind: "hold", executeAtMs: 0, sourceActionId: "plan:slow-hold" }
          : { playerId: c.playerId, kind: "move", targetZone: lane, moveMode: "run", executeAtMs: 0, sourceActionId: "plan:slow-move" };
      });
    }
    if (!plan.objective) return commands.slice();
    const objective = plan.objective;
    const holderId = view.spike.holderId ? String(view.spike.holderId) : null;
    const zoneOf = (p: PolicyView["teammates"][number]) => this.spatial.nearestZone({ x: p.position.x, y: p.position.y });
    const team = view.teammates.filter((p) => p.alive && (roleOf.get(String(p.id)) !== "lurker" || String(p.id) === holderId));
    const showing = plan.feint !== null && view.timeRemainingMs > plan.feint.untilClockMs;

    if (!showing && !plan.executeGo) {
      let staged = true;
      let slowest = 0;
      for (const p of team) {
        const pz = zoneOf(p);
        if (pz !== objective && pz !== this.retakeEntry(pz, objective)) staged = false;
        slowest = Math.max(slowest, pz === objective ? 0 : this.spatial.shortestTravelTimeMs(pz, objective, "run") ?? 0);
      }
      if (staged || view.timeRemainingMs <= slowest + PLANT_DURATION_MS + EXECUTE_TIME_MARGIN_MS) plan.executeGo = true;
    }

    const ids = new Set(team.map((p) => String(p.id)));
    return commands.map((c) => {
      const id = String(c.playerId);
      if (!ids.has(id) || c.kind === "useAbility" || c.kind === "plant") return c;
      const p = team.find((t) => String(t.id) === id)!;
      const pz = zoneOf(p);
      const cmd = (target: ZoneId, aim: ZoneId, tag: string): ActionCommand => target === pz
        ? { playerId: c.playerId, kind: "hold", aimZone: aim, executeAtMs: 0, sourceActionId: `plan:${tag}-hold` }
        : { playerId: c.playerId, kind: "move", targetZone: target, moveMode: "run", executeAtMs: 0, sourceActionId: `plan:${tag}-move` };
      if (showing) {
        if (id === holderId) return cmd(this.retakeEntry(pz, objective), objective, "stage"); // the spike stages toward the real site
        const path = this.spatial.findPath(pz, plan.feint!.site, "run")?.path;
        return cmd(path && path.length >= 2 ? path[path.length - 2]! : pz, plan.feint!.site, "feint");
      }
      if (!plan.executeGo) return cmd(this.retakeEntry(pz, objective), objective, "stage");
      return cmd(objective, objective, "go");
    });
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
    if (this.spatial.isPlantableZone(carrierZone)) {
      put({ playerId: carrier.id, kind: "plant", targetZone: carrierZone, executeAtMs: 0, sourceActionId: "carrier-commit:plant" });
      return out;
    }
    // The plan's objective site; the nearest site only when the plan has none or it is unreachable.
    const site = objective && this.spatial.isReachable(carrierZone, objective) ? objective : this.nearestPlantableSite(carrierZone);
    if (!site) return out; // no reachable plantable site — leave the carrier's drawn command
    // Before the execute is called the carrier stages with the team (commitPlanMovement); once it
    // is, or when there is no team plan to wait on, the carrier goes for the site.
    if (!executeGo) return out;
    put({ playerId: carrier.id, kind: "move", targetZone: site, moveMode: "run", executeAtMs: 0, sourceActionId: "carrier-commit:move" });
    return out;
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
    const holdStrategies = strategy === "defaultHold" || strategy === "stackA" || strategy === "stackB";
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
      const aimZone = DEFENSE_AIM[anchor] as ZoneId | undefined;
      return { playerId: c.playerId, kind: "hold", ...(aimZone ? { aimZone } : {}), executeAtMs: 0, sourceActionId: "defense-hold" };
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
    }
    if (view.side !== "defense" || (phase !== "planted" && phase !== "defusing")) return out;
    const pos = view.spike.position;
    if (!pos) return out;
    const plantZone = this.spatial.nearestZone({ x: pos.x, y: pos.y });

    const defenders = view.teammates.filter((p) => p.alive);
    let best: (typeof defenders)[number] | null = null;
    let bestMs = Infinity;
    for (const d of defenders) {
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      const t = dz === plantZone ? 0 : this.spatial.shortestTravelTimeMs(dz, plantZone, "run");
      if (t !== null && t < bestMs) {
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
        const entry = this.retakeEntry(dz, plantZone);
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
   * The zone a defender stages in before swinging onto the plant: the last zone before the plant
   * on its own route (so several defenders stage on different entries → a crossfire retake).
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
      if (dz !== plantZone && dz !== this.retakeEntry(dz, plantZone)) allStaged = false;
      const t = dz === plantZone ? 0 : this.spatial.shortestTravelTimeMs(dz, plantZone, "run");
      if (t != null && t + DEFUSE_DURATION_MS <= timer) slowest = Math.max(slowest, t);
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
    const opening = plan.opening;
    const recon = this.revisePlan(view, plan, rng);
    // A coach order (timeout) forces the strategy, overriding the IGL's own call.
    const ordered = this.order?.strategy;
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
      const choice = choosePlayerCommand(String(p.id), role, strategy, generation.feasible, profile, rng);
      choices.push({ choice, entry: { command: choice.command, role, profile } });
    }

    let commands = this.commitAttackUtil(view, strategy, applyTeamwork(choices.map((c) => c.entry)));
    commands = planUtility(view, strategy, commands, this.spatial, this.options.abilityEffect);
    this.commitSlowPlan(view, plan, rng);
    commands = this.commitPlanMovement(view, plan, commands, roleOf);
    commands = this.commitSpikeCarrier(view, strategy, commands, plan.objective, plan.executeGo && !plan.uncommitted);
    commands = this.commitPostPlantContest(view, commands, rng);
    commands = this.commitDefenseHold(view, strategy, commands);
    commands = this.commitDefuser(view, commands, rng);

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
