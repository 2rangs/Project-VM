/**
 * Player policy (README §23.2) — turn team orders + the player's own feasible candidates
 * into one action command, biased by role, strategy, and the player's tendencies/stats
 * (aggression/discipline/decisionMaking). Selection is a seeded weighted draw, so the same
 * seed + profile yields the same choice (determinism), while different profiles produce
 * different styles (an aggressive player peeks more; a disciplined one follows the call).
 */
import type {
  ActionCommand,
  AbilityId,
  MoveMode,
  PlayerProfile,
  PlayerRole,
  RandomSource,
  TeamStrategy,
  ZoneId,
} from "@pv/shared-types";
import type { EvaluatedAction } from "@pv/action-generator";

const EXECUTE_STRATEGIES = new Set<TeamStrategy>(["aExecute", "bExecute", "midControl", "fakeAtoB", "fakeBtoA"]);

export interface PlayerChoice {
  readonly command: ActionCommand;
  readonly chosenActionId: string;
  readonly considered: ReadonlyArray<{ readonly id: string; readonly weight: number }>;
  readonly reason: string;
}

function selectionWeight(
  cand: EvaluatedAction,
  role: PlayerRole,
  strategy: TeamStrategy,
  profile: PlayerProfile,
): number {
  let w = Math.max(0.01, cand.evaluation.expectedUtility + 0.3);
  const kind = cand.schemaId;
  const risk = cand.evaluation.estimatedRisk;

  // Better decision-makers discount risky actions; poor ones pick more flatly.
  w *= 1 - risk * (1 - profile.decisionMaking);

  if (kind === "individual.peek" || kind === "individual.move") w *= 0.6 + profile.aggression;
  if (kind === "individual.hold") w *= Math.max(0.1, 1.4 - profile.aggression);
  if (kind === "individual.save") w *= strategy === "save" ? 2.2 : Math.max(0.2, 1.1 - profile.aggression);

  if (role === "entry" && (kind === "individual.move" || kind === "individual.peek")) w *= 1.6;
  if (role === "anchor" && kind === "individual.hold") w *= 1.6;
  if (role === "lurker" && kind === "individual.move") w *= 1.3;

  if (EXECUTE_STRATEGIES.has(strategy) && kind === "individual.move") w *= 1 + profile.discipline;
  if (strategy === "defaultHold" && kind === "individual.hold") w *= 1 + profile.discipline;

  return Math.max(0.0001, w);
}

function weightedPick<T>(rng: RandomSource, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.nextFloat() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function toCommand(cand: EvaluatedAction, profile: PlayerProfile, role: PlayerRole): ActionCommand {
  const p = cand.parameters as Record<string, unknown>;
  const playerId = cand.actors[0]!;
  const zone = (k: string): ZoneId | undefined => (p[k] as ZoneId | undefined) ?? undefined;
  const moveMode: MoveMode = role === "entry" || profile.aggression > 0.6 ? "run" : "walk";
  const base = { playerId, sourceActionId: cand.id } as const;
  switch (cand.schemaId) {
    case "individual.move":
      return { ...base, kind: "move", targetZone: zone("to"), moveMode };
    case "individual.peek":
      return { ...base, kind: "peek", targetZone: zone("at") };
    case "individual.useAbility":
      return { ...base, kind: "useAbility", abilityId: p["abilityId"] as AbilityId };
    case "individual.plant":
      return { ...base, kind: "plant", targetZone: zone("zone") };
    case "individual.defuse":
      return { ...base, kind: "defuse", targetZone: zone("zone") };
    case "individual.save":
      return { ...base, kind: "save", targetZone: zone("zone") };
    case "individual.hold":
    default:
      return { ...base, kind: "hold", targetZone: zone("zone") };
  }
}

/**
 * Choose one command for a player from their feasible individual candidates.
 * `candidates` is the Action Generator's feasible list; only the player's own individual
 * actions are considered.
 */
export function choosePlayerCommand(
  playerId: string,
  role: PlayerRole,
  strategy: TeamStrategy,
  candidates: readonly EvaluatedAction[],
  profile: PlayerProfile,
  rng: RandomSource,
): PlayerChoice {
  const mine = candidates.filter(
    (c) => c.category === "individual" && c.actors.some((a) => String(a) === playerId),
  );
  if (mine.length === 0) {
    return {
      command: { playerId: playerId as never, kind: "hold" },
      chosenActionId: "",
      considered: [],
      reason: "no feasible individual candidate — default hold",
    };
  }
  const weighted = mine.map((c) => [c, selectionWeight(c, role, strategy, profile)] as const);
  const chosen = weightedPick(rng, weighted);
  return {
    command: toCommand(chosen, profile, role),
    chosenActionId: chosen.id,
    considered: weighted.map(([c, w]) => ({ id: c.id, weight: Number(w.toFixed(4)) })),
    reason: `role=${role} strategy=${strategy} aggr=${profile.aggression.toFixed(2)} disc=${profile.discipline.toFixed(2)}`,
  };
}
