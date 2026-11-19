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
import { assignRoles, profileFor, reconsider, selectStrategy } from "./igl.js";
import { choosePlayerCommand, type PlayerChoice } from "./player-policy.js";
import { applyTeamwork, type TeamworkEntry } from "./teamwork.js";

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

  private commitSpikeCarrier(
    view: PolicyView,
    strategy: TeamStrategy,
    commands: readonly ActionCommand[],
  ): ActionCommand[] {
    const out = commands.slice();
    const holderId = view.spike.holderId;
    const phase = view.spike.phase;
    const canPlant = phase === "carried" || phase === "planting" || phase === "dropped";
    if (view.side !== "attack" || !holderId || !canPlant || strategy === "save") return out;

    const carrier = view.teammates.find((p) => String(p.id) === String(holderId) && p.alive);
    if (!carrier) return out;

    const carrierZone = this.spatial.nearestZone({ x: carrier.position.x, y: carrier.position.y });
    let command: ActionCommand;
    if (this.spatial.isPlantableZone(carrierZone)) {
      command = { playerId: carrier.id, kind: "plant", targetZone: carrierZone, executeAtMs: 0, sourceActionId: "carrier-commit:plant" };
    } else {
      const site = this.nearestPlantableSite(carrierZone);
      if (!site) return out; // no reachable plantable site — leave the carrier's drawn command
      command = { playerId: carrier.id, kind: "move", targetZone: site, moveMode: "run", executeAtMs: 0, sourceActionId: "carrier-commit:move" };
    }
    const idx = out.findIndex((c) => String(c.playerId) === String(holderId));
    if (idx >= 0) out[idx] = command;
    else out.push(command);
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
    const opening = selectStrategy(view, this.spatial, rng);
    const recon = reconsider(view, this.spatial, opening, rng);
    // A coach order (timeout) forces the strategy, overriding the IGL's own call. Draws from the
    // same RNG first so order-vs-no-order stays deterministic for every other decision.
    const ordered = this.order?.strategy;
    const strategy = ordered ?? recon.strategy;
    const reconReason = ordered ? `order: forced ${ordered}` : recon.reason;
    const reconChanged = ordered ? ordered !== opening : recon.changed;
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
    commands = this.commitSpikeCarrier(view, strategy, commands);
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
