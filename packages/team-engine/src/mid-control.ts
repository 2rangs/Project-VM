/**
 * Mid control as a round state (docs/MID_CONTROL.md).
 *
 * One number, C ∈ [−1, +1]: −1 the defence holds mid, +1 the attack holds it, 0 nobody does. It
 * is moved by evidence, never set:
 *
 *   presence   w_side = bodies in mid + UTILITY_BODY · utility in mid
 *              target v = (w_A − w_D) / (w_A + w_D)
 *              C ← C + (1 − e^(−Δt·s/τ_presence)) · (v − C)
 *   fights     each kill in mid by a side jumps C toward that side:  C ← C + KILL_GAIN · (±1 − C)
 *   decay      with nobody and nothing in mid, C relaxes to 0 with τ_decay — control that is not
 *              kept up is lost, slowly
 *
 * `s` (sharpness) is how fast the reader updates: the simulator's own record uses 1; a team's own
 * estimate uses ½ + mean decisionMaking of its living players, the same factor its hit belief uses.
 *
 * The SAME update runs on two kinds of evidence. The round record feeds it the truth. A team's
 * policy feeds it only what the team knows — its own players, enemies it sees or hears in mid, its
 * own utility, deaths it witnessed — so each side holds its own estimate, and the two can
 * disagree (a team that gave mid up does not know who is standing in it).
 */
import type { MapTactics, MidControlState, MidHolder, MidSidePlan, MidPlans, ResolvedMidSidePlan } from "@pv/shared-types";
import { resolveMidPlan } from "@pv/shared-types";

export interface MidControlTuning {
  /** Time constant of presence (ms): mid is "taken" after standing in it unopposed for about this long. */
  readonly presenceTauMs: number;
  /** Time constant of the decay with nobody there (ms). */
  readonly decayTauMs: number;
  /** A smoke / recon / molly in mid counts as this much of a body. */
  readonly utilityBody: number;
  /** How far one kill in mid moves control toward the killer's side (share of the remaining distance). */
  readonly killGain: number;
  /** |C| at or above this = that side holds mid. */
  readonly holdThreshold: number;
}

export const DEFAULT_MID_CONTROL_TUNING: MidControlTuning = {
  presenceTauMs: 6000,
  decayTauMs: 15_000,
  utilityBody: 0.5,
  killGain: 0.35,
  holdThreshold: 0.4,
};

/** What happened in mid during one step, as counted by whoever is reading it. */
export interface MidEvidence {
  /** Bodies in mid per side. */
  readonly attack: number;
  readonly defense: number;
  /** Utility (smokes, recon, area denial) in play in mid per side. */
  readonly attackUtility?: number;
  readonly defenseUtility?: number;
  /** Kills made in mid during the step, by side of the killer. */
  readonly killsByAttack?: number;
  readonly killsByDefense?: number;
}

const clampC = (v: number): number => Math.min(1, Math.max(-1, v));

/** One step of the control value (see the header). */
export function stepMidControl(prev: number, ev: MidEvidence, dtMs: number, sharpness = 1, tuning: MidControlTuning = DEFAULT_MID_CONTROL_TUNING): number {
  const wA = ev.attack + tuning.utilityBody * (ev.attackUtility ?? 0);
  const wD = ev.defense + tuning.utilityBody * (ev.defenseUtility ?? 0);
  let c = prev;
  if (dtMs > 0) {
    if (wA + wD > 0) {
      const target = (wA - wD) / (wA + wD);
      c += (1 - Math.exp((-dtMs * Math.max(0.05, sharpness)) / tuning.presenceTauMs)) * (target - c);
    } else {
      c += (1 - Math.exp(-dtMs / tuning.decayTauMs)) * (0 - c);
    }
  }
  for (let i = 0; i < (ev.killsByAttack ?? 0); i++) c += tuning.killGain * (1 - c);
  for (let i = 0; i < (ev.killsByDefense ?? 0); i++) c += tuning.killGain * (-1 - c);
  return clampC(c);
}

export function midHolder(value: number, tuning: MidControlTuning = DEFAULT_MID_CONTROL_TUNING): MidHolder {
  return value >= tuning.holdThreshold ? "attack" : value <= -tuning.holdThreshold ? "defense" : null;
}

export function midControlState(value: number, tuning: MidControlTuning = DEFAULT_MID_CONTROL_TUNING): MidControlState {
  return { value, attack: Math.max(0, value), defense: Math.max(0, -value), holder: midHolder(value, tuning) };
}

/** Control seen from one side: +1 = this side holds mid. */
export function ownControl(value: number, side: "attack" | "defense"): number {
  return side === "attack" ? value : -value;
}

/**
 * A running record of mid control over a round (the truth, or one team's estimate): the value,
 * how long each side held it, and when it first changed hands.
 */
export class MidControlTracker {
  private c = 0;
  private heldMs = { attack: 0, defense: 0 };
  private firstHeld: { side: "attack" | "defense"; atMs: number } | null = null;
  private readonly samples: Array<{ atMs: number; value: number }> = [];
  constructor(private readonly tuning: MidControlTuning = DEFAULT_MID_CONTROL_TUNING, private readonly sampleEveryMs = 2000) {}

  /** Advance by `dtMs` on this step's evidence; `atMs` is the round's elapsed time after the step. */
  step(ev: MidEvidence, dtMs: number, atMs: number, sharpness = 1): MidControlState {
    this.c = stepMidControl(this.c, ev, dtMs, sharpness, this.tuning);
    const holder = midHolder(this.c, this.tuning);
    if (holder) {
      this.heldMs[holder] += dtMs;
      if (!this.firstHeld) this.firstHeld = { side: holder, atMs };
    }
    const last = this.samples[this.samples.length - 1];
    if (!last || atMs - last.atMs >= this.sampleEveryMs) this.samples.push({ atMs, value: Math.round(this.c * 1000) / 1000 });
    return midControlState(this.c, this.tuning);
  }

  get value(): number { return this.c; }
  state(): MidControlState { return midControlState(this.c, this.tuning); }
  summary(): MidControlRecord {
    return { final: this.state(), heldMs: { ...this.heldMs }, firstHeld: this.firstHeld ? { ...this.firstHeld } : null, samples: this.samples.slice() };
  }
}

/** Mid control over one round (RoundRecord.mid: the truth, from the simulator's own positions and kills). */
export interface MidControlRecord {
  readonly final: MidControlState;
  /** How long each side held mid (|C| ≥ the hold threshold), ms. */
  readonly heldMs: { readonly attack: number; readonly defense: number };
  /** Who held mid first and when (elapsed ms), or null if nobody ever did. */
  readonly firstHeld: { readonly side: "attack" | "defense"; readonly atMs: number } | null;
  /** The value every ~2 s (elapsed ms). */
  readonly samples: ReadonlyArray<{ readonly atMs: number; readonly value: number }>;
}

// ---- the decision: fight for mid or not ----------------------------------------------------

/** What the IGL knows when it decides about mid at the start of a round. */
export interface MidCallContext {
  readonly side: "attack" | "defense";
  /** The team's buy this round. */
  readonly eco: boolean;
  readonly partialBuy: boolean;
  /** The attack's opening call names mid (the IGL drew `midControl`). */
  readonly calledMid: boolean;
  readonly alive: number;
}

export interface MidCall {
  readonly stance: "contest" | "hold" | "giveUp";
  readonly by: "auto" | "manager";
  readonly reason: string;
  /** How many players go. */
  readonly count: number;
}

/**
 * Whether the team fights for mid this round.
 *
 * A manager's stance is followed. Left to the IGL ("auto"):
 *   attack   contests when the round's call is mid control — which the IGL draws with a weight
 *            that rises with what mid saves the attack on this map (midCallWeight) and only on a
 *            full buy; on an eco or a partial buy it plays for picks instead (igl.ts).
 *   defence  holds mid with its mid player (the map's derived start) on a gun round, and gives
 *            it up on an eco: a pistol alone in mid loses the duel and the team needs every body
 *            for a stacked retake.
 * The count is the manager's, else two attackers (the fight is taken with a trade) or one defender.
 */
export function decideMidCall(plan: ResolvedMidSidePlan, mid: MapTactics["midArea"], ctx: MidCallContext): MidCall {
  const auto = ctx.side === "attack" ? 2 : 1;
  const wanted = plan.count === "auto" ? auto : Math.max(0, Math.min(ctx.alive, Math.round(plan.count)));
  if (!mid) return { stance: "giveUp", by: "auto", reason: "this map has no mid", count: 0 };
  if (plan.stance === "giveUp" || wanted === 0) return { stance: "giveUp", by: "manager", reason: "manager: give mid up", count: 0 };
  if (plan.stance === "contest") return { stance: "contest", by: "manager", reason: "manager: contest mid", count: Math.max(1, wanted) };
  if (ctx.side === "attack") {
    return ctx.calledMid
      ? { stance: "contest", by: "auto", reason: "the call is mid control", count: Math.max(1, wanted) }
      : { stance: "giveUp", by: "auto", reason: "the call does not go through mid", count: 0 };
  }
  if (ctx.eco) return { stance: "giveUp", by: "auto", reason: "eco round — no mid duel on pistols; play the retake", count: 0 };
  return { stance: "hold", by: "auto", reason: "gun round — the mid player holds", count: Math.max(1, wanted) };
}

/**
 * Weight of the `midControl` opening call (igl.ts selectStrategy), relative to an execute's
 * weight of 1. It scales with what mid is worth to the attack on the map (MidArea.attackValue,
 * the share of a site switch mid saves): BASE · (½ + value / REFERENCE). On Ascent (value 0.20)
 * this is the 0.8 the IGL always used; a map whose mid saves nothing gets half of it, a map with
 * no way round except through mid gets three times it. No mid → the call is a slow default, as before.
 */
export const MID_CALL_BASE = 0.8;
const MID_VALUE_REFERENCE = 0.4;
export function midCallWeight(mid: MapTactics["midArea"] | undefined): number {
  if (mid === undefined || mid === null) return MID_CALL_BASE;
  return MID_CALL_BASE * (0.5 + Math.min(1, mid.attackValue) / MID_VALUE_REFERENCE);
}

/**
 * The defenders' start zones under a mid stance (the derived starts put one player on the mid
 * anchor on a two-site map):
 *   hold     the derived starts
 *   giveUp   the mid player starts on a site instead — the one with the fewest defenders, the
 *            site the attack reaches soonest on a tie
 *   contest  `count` players start on the mid anchor: the extra ones come off the site with the
 *            most defenders (the one the attack reaches latest on a tie), never its last
 */
export function defenderStartsFor(tactics: MapTactics, stance: "contest" | "hold" | "giveUp", count: number): string[] {
  const starts = [...tactics.defenderStarts];
  const midZone = tactics.mid?.zone;
  if (!midZone || !tactics.midArea) return starts;
  const reach = (zone: string): number => tactics.sites.find((s) => s.zone === zone)?.attackTravelMs ?? Infinity;
  const onSite = (zone: string): number => starts.filter((z) => z === zone).length;
  const sites = tactics.sites.map((s) => s.zone);
  if (stance === "giveUp") {
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] !== midZone) continue;
      starts[i] = [...sites].sort((p, q) => onSite(p) - onSite(q) || reach(p) - reach(q))[0] ?? starts[i]!;
    }
    return starts;
  }
  if (stance === "contest") {
    let have = starts.filter((z) => z === midZone).length;
    while (have < count) {
      const from = [...sites].filter((z) => onSite(z) > 1).sort((p, q) => onSite(q) - onSite(p) || reach(q) - reach(p))[0];
      if (!from) break;
      starts[starts.lastIndexOf(from)] = midZone;
      have++;
    }
  }
  return starts;
}

/** The plan for one side of one map from a team's `midPlans` (shared-types resolveMidPlan). */
export function midPlanFor(plans: MidPlans | undefined | null, mapId: string, side: "attack" | "defense"): ResolvedMidSidePlan {
  return resolveMidPlan(plans, mapId, side);
}

export type { MidSidePlan };
