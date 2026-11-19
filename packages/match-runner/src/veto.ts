/**
 * Map veto (docs/SERIES_AND_VETO.md §2).
 *
 * A veto format is DATA: an ordered list of steps (ban / pick / side by team, and "decider" for
 * the one map left). The VCT sequences are presets, not code paths; a tournament with another
 * order passes its own list. `VetoProcess` walks a format one step at a time — a human supplies a
 * choice, or `recommendVeto` supplies the AI's — and yields the maps of the series with who
 * picked each and who starts on which side.
 *
 * Source of the presets: VALORANT Champions Tour "VALORANT Official Competition Ruleset" (last
 * updated April 3, 2023), §4.6.6–4.6.10. Not re-confirmed against the 2026 edition — see the docs.
 */
import { getMapComps } from "@pv/game-data";

/** Series team: "A" starts the map selection (the ruleset's Team A), "B" is the other. */
export type SeriesTeam = "A" | "B";
export type StartSide = "attack" | "defense";

export type VetoStep =
  | { readonly kind: "ban"; readonly team: SeriesTeam }
  | { readonly kind: "pick"; readonly team: SeriesTeam }
  /** Choose the starting side on the map most recently picked / left as the decider. */
  | { readonly kind: "side"; readonly team: SeriesTeam }
  /** The single remaining map becomes the next game. */
  | { readonly kind: "decider" };

export interface VetoFormat {
  readonly id: string;
  readonly name: string;
  /** Maps in the series (the winner needs more than half). */
  readonly games: number;
  /** Pool size the sequence is written for. */
  readonly poolSize: number;
  readonly steps: readonly VetoStep[];
  /** Where the sequence comes from, and whether it was checked against a primary source. */
  readonly source: string;
  readonly verified: boolean;
}

const ban = (team: SeriesTeam): VetoStep => ({ kind: "ban", team });
const pick = (team: SeriesTeam): VetoStep => ({ kind: "pick", team });
const side = (team: SeriesTeam): VetoStep => ({ kind: "side", team });
const DECIDER: VetoStep = { kind: "decider" };
const other = (t: SeriesTeam): SeriesTeam => (t === "A" ? "B" : "A");

const RULESET = "VCT VALORANT Official Competition Ruleset (updated 2023-04-03)";

/** §4.6.7 — six alternating bans, the seventh map is played, Team A picks side. */
export const VCT_BO1: VetoFormat = {
  id: "vct-bo1", name: "VCT best-of-one", games: 1, poolSize: 7,
  steps: [ban("A"), ban("B"), ban("A"), ban("B"), ban("A"), ban("B"), DECIDER, side("A")],
  source: `${RULESET} §4.6.7`, verified: true,
};
/** §4.6.8 — ban, ban, A picks map 1 (B side), B picks map 2 (A side), ban, ban, decider (A side). */
export const VCT_BO3: VetoFormat = {
  id: "vct-bo3", name: "VCT best-of-three", games: 3, poolSize: 7,
  steps: [ban("A"), ban("B"), pick("A"), side("B"), pick("B"), side("A"), ban("A"), ban("B"), DECIDER, side("A")],
  source: `${RULESET} §4.6.8`, verified: true,
};
/** §4.6.9 — ban, ban, then picks A/B/A/B with the other team choosing side, decider (B side). */
export const VCT_BO5: VetoFormat = {
  id: "vct-bo5", name: "VCT best-of-five", games: 5, poolSize: 7,
  steps: [ban("A"), ban("B"), pick("A"), side("B"), pick("B"), side("A"), pick("A"), side("B"), pick("B"), side("A"), DECIDER, side("B")],
  source: `${RULESET} §4.6.9`, verified: true,
};
/** §4.6.10 — double-elimination grand final: the upper-bracket team makes both bans. */
export function vctGrandFinalBo5(upperBracketTeam: SeriesTeam): VetoFormat {
  return {
    id: `vct-bo5-grand-final-${upperBracketTeam}`, name: "VCT grand final (best-of-five)", games: 5, poolSize: 7,
    steps: [ban(upperBracketTeam), ban(upperBracketTeam), pick("A"), side("B"), pick("B"), side("A"), pick("A"), side("B"), pick("B"), side("A"), DECIDER, side("B")],
    source: `${RULESET} §4.6.10`, verified: true,
  };
}

export const VETO_FORMATS = { bo1: VCT_BO1, bo3: VCT_BO3, bo5: VCT_BO5 } as const;
export type SeriesFormatId = keyof typeof VETO_FORMATS;

/**
 * Seven-map pools. The ruleset fixes the SIZE (7) and leaves the maps to each event's own
 * ruleset, so which pool a given 2026 event used is not asserted here:
 *  - "rotation-13.04": the ranked rotation after patches 13.00 (Summit, Sunset in; Fracture, Pearl
 *    out) and 13.04 (Abyss in; Breeze out). It is also the set of maps with international
 *    matches on patch ≥ 13 in this repo's data (docs/research/NEXT_MAP_PREP.md), and it contains
 *    Ascent — the one map the engine has geometry for — so it is the default.
 *  - "rotation-13.08": after patch 13.08 (Bind, Corrode in; Ascent, Split out).
 */
export const MAP_POOLS = {
  "rotation-13.04": ["Abyss", "Ascent", "Haven", "Lotus", "Split", "Summit", "Sunset"],
  "rotation-13.08": ["Abyss", "Bind", "Corrode", "Haven", "Lotus", "Summit", "Sunset"],
} as const;
export const DEFAULT_MAP_POOL: readonly string[] = MAP_POOLS["rotation-13.04"];

/** Throws unless the sequence consumes the pool exactly and yields `games` maps, each with a side. */
export function validateVetoFormat(format: VetoFormat, poolSize: number): void {
  let remaining = poolSize;
  let maps = 0;
  let awaitingSide = false;
  for (const [i, step] of format.steps.entries()) {
    if (step.kind === "ban" || step.kind === "pick") {
      if (awaitingSide) throw new Error(`veto format ${format.id}: step ${i} — map ${maps} has no starting side yet`);
      if (remaining <= 1) throw new Error(`veto format ${format.id}: step ${i} — no map left to ${step.kind}`);
      remaining -= 1;
      if (step.kind === "pick") { maps += 1; awaitingSide = true; }
    } else if (step.kind === "decider") {
      if (awaitingSide) throw new Error(`veto format ${format.id}: step ${i} — map ${maps} has no starting side yet`);
      if (remaining !== 1) throw new Error(`veto format ${format.id}: decider at step ${i} with ${remaining} maps left (pool of ${poolSize})`);
      remaining -= 1;
      maps += 1;
      awaitingSide = true;
    } else {
      if (!awaitingSide) throw new Error(`veto format ${format.id}: step ${i} — side choice with no map waiting for one`);
      awaitingSide = false;
    }
  }
  if (awaitingSide) throw new Error(`veto format ${format.id}: the last map has no starting side`);
  if (maps !== format.games) throw new Error(`veto format ${format.id}: yields ${maps} maps, declares ${format.games}`);
}

// ------------------------------------------------------------------------------------------------
// The process
// ------------------------------------------------------------------------------------------------

export interface VetoMap {
  readonly map: string;
  readonly pickedBy: SeriesTeam | "decider";
  readonly sideChosenBy: SeriesTeam;
  /** Starting side of each series team. */
  readonly startingSides: Readonly<Record<SeriesTeam, StartSide>>;
}

export interface VetoAction {
  /** Index of the step in the format. */
  readonly step: number;
  readonly kind: VetoStep["kind"];
  /** Acting team (null for the decider, which nobody chooses). */
  readonly team: SeriesTeam | null;
  /** The map banned / picked / left, or the map the side was chosen on. */
  readonly map: string;
  /** For a side step: the side the acting team starts on. */
  readonly side?: StartSide;
  readonly by: "human" | "ai" | "rule";
  /** Why the AI chose it (its own evaluation), when it did. */
  readonly reason?: string;
}

export interface VetoPrompt {
  readonly step: number;
  readonly kind: "ban" | "pick" | "side";
  readonly team: SeriesTeam;
  /** Maps that can be banned / picked, or ["attack", "defense"] for a side step. */
  readonly options: readonly string[];
  /** For a side step: the map the side is chosen on. */
  readonly map?: string;
}

interface PendingMap { map: string; pickedBy: SeriesTeam | "decider" }

/** Walks a veto format one step at a time. Deterministic: the same choices give the same result. */
export class VetoProcess {
  private stepIndex = 0;
  private readonly remainingMaps: string[];
  private readonly bannedMaps: string[] = [];
  private readonly decided: VetoMap[] = [];
  private pendingMap: PendingMap | null = null;
  private readonly log: VetoAction[] = [];

  constructor(readonly format: VetoFormat, readonly pool: readonly string[]) {
    if (new Set(pool.map((m) => m.toLowerCase())).size !== pool.length) throw new Error("veto: the map pool has duplicates");
    validateVetoFormat(format, pool.length);
    this.remainingMaps = [...pool];
    this.settleRuleSteps();
  }

  /** Steps nobody chooses (the decider) resolve on their own. */
  private settleRuleSteps(): void {
    for (let step = this.format.steps[this.stepIndex]; step?.kind === "decider"; step = this.format.steps[this.stepIndex]) {
      const map = this.remainingMaps.pop()!;
      this.pendingMap = { map, pickedBy: "decider" };
      this.log.push({ step: this.stepIndex, kind: "decider", team: null, map, by: "rule" });
      this.stepIndex += 1;
    }
  }

  isComplete(): boolean { return this.stepIndex >= this.format.steps.length; }
  get remaining(): readonly string[] { return this.remainingMaps; }
  get banned(): readonly string[] { return this.bannedMaps; }
  /** Maps settled so far (map + side), in playing order. */
  get maps(): readonly VetoMap[] { return this.decided; }
  get actions(): readonly VetoAction[] { return this.log; }
  /** Index of the next step to act on. */
  get position(): number { return this.stepIndex; }

  /** The choice the veto is waiting for, or null when it is complete. */
  pending(): VetoPrompt | null {
    const step = this.format.steps[this.stepIndex];
    if (!step || step.kind === "decider") return null;
    if (step.kind === "side") return { step: this.stepIndex, kind: "side", team: step.team, options: ["attack", "defense"], map: this.pendingMap!.map };
    return { step: this.stepIndex, kind: step.kind, team: step.team, options: [...this.remainingMaps] };
  }

  /** Apply the pending step's choice: a map name (ban / pick) or "attack" / "defense" (side). */
  apply(choice: string, by: "human" | "ai" = "human", reason?: string): VetoAction {
    const prompt = this.pending();
    if (!prompt) throw new Error("veto: nothing to choose — the veto is complete");
    let action: VetoAction;
    if (prompt.kind === "side") {
      if (choice !== "attack" && choice !== "defense") throw new Error(`veto: side must be "attack" or "defense", got "${choice}"`);
      const map = this.pendingMap!;
      const mine: StartSide = choice;
      const theirs: StartSide = mine === "attack" ? "defense" : "attack";
      const startingSides = { [prompt.team]: mine, [other(prompt.team)]: theirs } as Record<SeriesTeam, StartSide>;
      this.decided.push({ map: map.map, pickedBy: map.pickedBy, sideChosenBy: prompt.team, startingSides });
      this.pendingMap = null;
      action = { step: prompt.step, kind: "side", team: prompt.team, map: map.map, side: mine, by, ...(reason ? { reason } : {}) };
    } else {
      const idx = this.remainingMaps.findIndex((m) => m.toLowerCase() === choice.toLowerCase());
      if (idx < 0) throw new Error(`veto: "${choice}" is not available (remaining: ${this.remainingMaps.join(", ")})`);
      const [map] = this.remainingMaps.splice(idx, 1) as [string];
      if (prompt.kind === "ban") this.bannedMaps.push(map);
      else this.pendingMap = { map, pickedBy: prompt.team };
      action = { step: prompt.step, kind: prompt.kind, team: prompt.team, map, by, ...(reason ? { reason } : {}) };
    }
    this.log.push(action);
    this.stepIndex += 1;
    this.settleRuleSteps();
    return action;
  }
}

// ------------------------------------------------------------------------------------------------
// The AI's choice
// ------------------------------------------------------------------------------------------------

/** What a team believes going into the veto. Beliefs, not outcomes — they only steer choices. */
export interface VetoBeliefs {
  /** The team's own estimate of its chance to win each pool map (0..1). */
  readonly winProbability: Readonly<Record<string, number>>;
}

/** P(win a first-to-`ceil(n/2)` series) given the per-game win probabilities, in playing order. */
export function seriesWinProbability(ps: readonly number[]): number {
  const need = Math.floor(ps.length / 2) + 1;
  // dist[w] = P(w wins so far and the series still undecided)
  let dist = new Map<string, number>([["0:0", 1]]);
  let won = 0;
  for (const p of ps) {
    const next = new Map<string, number>();
    for (const [key, prob] of dist) {
      const [w, l] = key.split(":").map(Number) as [number, number];
      if (w + 1 >= need) won += prob * p;
      else next.set(`${w + 1}:${l}`, (next.get(`${w + 1}:${l}`) ?? 0) + prob * p);
      if (l + 1 < need) next.set(`${w}:${l + 1}`, (next.get(`${w}:${l + 1}`) ?? 0) + prob * (1 - p));
    }
    dist = next;
  }
  return won;
}

export interface VetoRecommendation {
  readonly choice: string;
  readonly reason: string;
  /** Series win probability (by the team's own beliefs) after each available choice, best play after. */
  readonly values: Readonly<Record<string, number>>;
}

/**
 * The veto choice a team makes from its beliefs, looking ahead through the rest of the sequence:
 *
 *     V(state) = P(win the series)                       at the end (seriesWinProbability)
 *              = max over my options of V(next)           on my step
 *              = min over their options of V(next)        on theirs
 *
 * i.e. the team assumes the opponent answers in the way that hurts it most BY ITS OWN ESTIMATES —
 * so it bans what the opponent would otherwise pick against it, and does not waste a ban on a map
 * the opponent has to ban anyway. Ties go to the earlier map in the pool (no randomness).
 * A 7-map pool is at most 5,040 lines, so the search is exact.
 */
export function recommendVeto(veto: VetoProcess, team: SeriesTeam, beliefs: VetoBeliefs): VetoRecommendation {
  const prompt = veto.pending();
  if (!prompt) throw new Error("veto: nothing to recommend — the veto is complete");
  if (prompt.kind === "side") return recommendSide(prompt.map!);
  const p = (map: string): number => beliefs.winProbability[map] ?? 0.5;
  const steps = veto.format.steps;
  const played = veto.maps.map((m) => m.map);
  const pendingPick = veto.actions.filter((a) => a.kind === "pick" || a.kind === "decider").map((a) => a.map).filter((m) => !played.includes(m));
  const order0 = [...played, ...pendingPick];

  const value = (stepIndex: number, remaining: readonly string[], order: readonly string[]): number => {
    const step = steps[stepIndex];
    if (!step) return seriesWinProbability(order.map(p));
    if (step.kind === "side") return value(stepIndex + 1, remaining, order);
    if (step.kind === "decider") return value(stepIndex + 1, [], [...order, remaining[0]!]);
    let best = step.team === team ? -Infinity : Infinity;
    for (const map of remaining) {
      const rest = remaining.filter((m) => m !== map);
      const v = value(stepIndex + 1, rest, step.kind === "pick" ? [...order, map] : order);
      best = step.team === team ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  };

  const values: Record<string, number> = {};
  let choice = prompt.options[0]!;
  let bestValue = -Infinity;
  for (const map of prompt.options) {
    const rest = veto.remaining.filter((m) => m !== map);
    const v = value(veto.position + 1, rest, prompt.kind === "pick" ? [...order0, map] : order0);
    values[map] = v;
    if (v > bestValue + 1e-12) { bestValue = v; choice = map; }
  }
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const reason = prompt.kind === "ban"
    ? `ban ${choice}: we rate our chance there at ${pct(p(choice))}; series estimate after this ban ${pct(bestValue)}`
    : `pick ${choice}: we rate our chance there at ${pct(p(choice))}; series estimate after this pick ${pct(bestValue)}`;
  return { choice, reason, values };
}

/**
 * Starting side: the side with the higher round win rate on that map in the data (attack-side
 * round win rate from the map's comp statistics). No data, or an even map → defense, the
 * conventional choice (unverified as a rule of thumb; see the docs).
 */
export function recommendSide(map: string): VetoRecommendation {
  const atk = getMapComps(map)?.atkRoundWR;
  if (atk !== undefined && atk > 0.5) {
    return { choice: "attack", reason: `start on attack: attackers win ${(atk * 100).toFixed(1)}% of rounds on ${map} in the data`, values: { attack: atk, defense: 1 - atk } };
  }
  const reason = atk === undefined
    ? `start on defense: no side statistics for ${map}, conventional choice`
    : `start on defense: defenders win ${((1 - atk) * 100).toFixed(1)}% of rounds on ${map} in the data`;
  return { choice: "defense", reason, values: { attack: atk ?? 0.5, defense: 1 - (atk ?? 0.5) } };
}
