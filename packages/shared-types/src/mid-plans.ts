/**
 * Mid control — the pre-match option and the round record (docs/research/MID_CONTROL.md,
 * docs/MID_CONTROL.md). Same conventions as the plant / post-plant / retake plans
 * (./plant-plans.ts on the engine-truth branch): every field is optional, "auto" or a missing
 * field leaves the call to the IGL, and the most specific key wins field by field.
 */

/** What a team does about mid on one side: fight for it, leave it, or let the IGL decide. */
export type MidStance = "auto" | "contest" | "giveUp";

/** Who goes to mid: the IGL's pick, tactical roles in order of preference, or named players. */
export type MidWho = "auto" | { readonly roles: readonly string[] } | { readonly players: readonly string[] };

export interface MidSidePlan {
  readonly stance?: MidStance;
  /** How many players go ("auto" = the IGL's number: two on attack, one on defence). */
  readonly count?: "auto" | number;
  /** Who goes. Player ids are game-data / roster ids; roles are the engine's tactical roles (entry, lurker, support, rotator, anchor). */
  readonly who?: MidWho;
}

/** A team's mid plan on one map: one entry per side. */
export interface MidPlan {
  readonly attack?: MidSidePlan;
  readonly defense?: MidSidePlan;
}

/**
 * `MatchConfig.teamInputs[slot].midPlans`: keyed by map id, "*" for every map. The map's own entry
 * wins over "*" field by field.
 */
export type MidPlans = Readonly<Record<string, MidPlan>>;

/** A side's mid plan with every field resolved against the keys (still "auto" where nobody chose). */
export interface ResolvedMidSidePlan {
  readonly stance: MidStance;
  readonly count: "auto" | number;
  readonly who: MidWho;
  /** Fields the manager set (not "auto"). */
  readonly byManager: readonly ("stance" | "count" | "who")[];
}

/** Resolve one side's plan for a map: the map's entry over "*", field by field. */
export function resolveMidPlan(plans: MidPlans | undefined | null, mapId: string, side: "attack" | "defense"): ResolvedMidSidePlan {
  const own = plans?.[mapId]?.[side];
  const any = plans?.["*"]?.[side];
  const stance = own?.stance ?? any?.stance ?? "auto";
  const count = own?.count ?? any?.count ?? "auto";
  const who = own?.who ?? any?.who ?? "auto";
  const byManager: ("stance" | "count" | "who")[] = [];
  if (stance !== "auto") byManager.push("stance");
  if (count !== "auto") byManager.push("count");
  if (who !== "auto") byManager.push("who");
  return { stance, count, who, byManager };
}

/** Who holds mid: one side, nobody (empty or still fought over). */
export type MidHolder = "attack" | "defense" | null;

/**
 * Mid control at one moment. `value` runs from −1 (the defence holds it) to +1 (the attack holds
 * it); the two shares are its halves, so both sides are read off one number.
 */
export interface MidControlState {
  readonly value: number;
  readonly attack: number;
  readonly defense: number;
  readonly holder: MidHolder;
}

/** What a team did about mid in one round, and how it believed mid stood (PlanSummary.mid). */
export interface MidDecision {
  /** The stance played this round. */
  readonly stance: "contest" | "hold" | "giveUp";
  /** Who chose it. */
  readonly by: "auto" | "manager";
  /** Why (the IGL's reason, or the manager's setting). */
  readonly reason: string;
  /** Sim ids of the players sent to mid (attack: the mid party; defence: the mid players). */
  readonly party: readonly string[];
  /** The team's own estimate of mid control when the round ended — from what it saw and heard, not the truth. */
  readonly estimate: MidControlState;
  /** Round clock (ms remaining) at which the team first believed it held mid / had lost it; null = never. */
  readonly heldAtMs: number | null;
  readonly lostAtMs: number | null;
  /** ATTACK: the hit came through two lanes (the mid party by mid's own way onto the site). */
  readonly split: boolean;
  /** ATTACK: the mid party showed on one site while the team hit the other. */
  readonly fake: boolean;
  /** DEFENCE: rotations went round mid because the team believed the attack held it. */
  readonly rotatedAround: boolean;
}
