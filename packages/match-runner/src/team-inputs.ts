/**
 * Per-team match inputs (series layer → match engine).
 *
 * `MatchConfig.tuning` sets the formula constants for BOTH teams. A series needs the same formulas
 * to run on different values per team and per map — a team that knows a map throws less, swings
 * less, trades information better and reads patterns sooner there (mastery.ts), and a team that
 * studied its opponent starts with a read instead of a blank model (scouting.ts).
 *
 * Nothing here is an outcome modifier. Every field feeds an EXISTING documented formula
 * (docs/STAT_OUTCOME_MATRIX.md) with a team-specific value:
 *
 *   throwRateScale           → throw hazard   λ₀' = λ₀ · scale                       (§3.3)
 *   formSigmaScale           → round form     σ'  = σ · scale                        (§4)
 *   traitDelta               → crossfire delay (gameSense, §2.1), info half-life (trading, §2.2)
 *   patternRecognitionDelta  → opponent model prior pseudo-count α                   (CTI §4.4)
 *   opponentPrior            → opponent model pseudo-observations (fade with evidence)
 *   standingPrior            → opponent model pseudo-observations that do not fade (a game plan)
 *
 * All fields are optional; an omitted / neutral field leaves the match byte-identical.
 */
import type { TacticalTraits } from "@pv/round-simulator";
import type { OpponentPrior, PolicyTuning, SiteKey } from "@pv/team-engine";

export interface TeamMatchInputs {
  /** Multiplies the team's throw hazard λ₀ (1 = unchanged). */
  readonly throwRateScale?: number;
  /** Multiplies every player's round-form σ (1 = unchanged). */
  readonly formSigmaScale?: number;
  /** Added to each player's gameSense / trading / clutch rating (clamped to 0..1). */
  readonly traitDelta?: Partial<TacticalTraits>;
  /** Added to the roster's pattern recognition (mean decisionMaking) behind its opponent model. */
  readonly patternRecognitionDelta?: number;
  /** What the team believes about the opponent before round 1 (scouting). Fades as rounds are observed. */
  readonly opponentPrior?: OpponentPrior;
  /** A conviction that in-match evidence has to outweigh (the team's own game plan). Does not fade. */
  readonly standingPrior?: OpponentPrior;
}

/**
 * [manager] Per-ROUND values a manager layer sets between rounds (MatchEngine.setRoundInputs):
 * the team's current state of mind (tilt / confidence, manager.ts) and its risk shout. They
 * compose with the match-long TeamMatchInputs — scales multiply, deltas add — and feed the same
 * formulas. All neutral → the round is played exactly as without them.
 */
export interface RoundTeamInputs {
  readonly throwRateScale?: number;
  readonly formSigmaScale?: number;
  readonly traitDelta?: Partial<TacticalTraits>;
  /** Overrides of the team's decision thresholds (retake / save / hero chance) for this round. */
  readonly tuning?: Partial<PolicyTuning>;
}

/**
 * A team's own game plan — a pre-match option. "Lean" is a standing preference, not a script: the
 * IGL still samples its opening call each round, with the preferred site weighted up.
 *
 * The IGL chooses where to attack from where it believes the defense is thinner, and where to
 * stack from where it believes the attack comes (team-engine igl.ts selectStrategy). A game plan
 * is expressed in that same currency — a standing belief:
 *
 *   attack lean on site X with strength s  ≡  s standing pseudo-observations "their defense sits on the OTHER site"
 *   defense lean on site X with strength s ≡  s standing pseudo-observations "their attack comes to X"
 *
 * so with league-average pattern recognition (α = 1) a strength-s lean gives the opening-call tilt
 *   lean = s/(s+2) · s/(s+2)        (confidence × (2P − 1) with P = (s+1)/(s+2))
 * e.g. s = 4 → 0.44, s = 8 → 0.64; weights are multiplied by 1 + 3·lean (TENDENCY_WEIGHT).
 * In-match evidence against the plan (meeting their defenders on "our" site) pulls it back — a
 * stubborn team needs more of it.
 */
export interface GamePlan {
  readonly attack?: { readonly site: SiteKey; readonly strength: number };
  readonly defense?: { readonly site: SiteKey; readonly strength: number };
}

const otherSite = (s: SiteKey): SiteKey => (s === "A" ? "B" : "A");

/** The standing prior a game plan amounts to (see GamePlan). */
export function gamePlanPrior(plan: GamePlan | undefined | null): OpponentPrior | undefined {
  if (!plan) return undefined;
  const out: { attackSite?: Partial<Record<SiteKey, number>>; defenseSite?: Partial<Record<SiteKey, number>> } = {};
  if (plan.attack && plan.attack.strength > 0) out.defenseSite = { [otherSite(plan.attack.site)]: plan.attack.strength };
  if (plan.defense && plan.defense.strength > 0) out.attackSite = { [plan.defense.site]: plan.defense.strength };
  return out.attackSite || out.defenseSite ? out : undefined;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Traits with a per-team delta applied (each rating stays in 0..1). */
export function applyTraitDelta(traits: readonly TacticalTraits[], delta: Partial<TacticalTraits> | undefined): TacticalTraits[] {
  if (!delta) return traits.slice();
  return traits.map((t) => ({
    gameSense: clamp01(t.gameSense + (delta.gameSense ?? 0)),
    trading: clamp01(t.trading + (delta.trading ?? 0)),
    clutch: clamp01(t.clutch + (delta.clutch ?? 0)),
  }));
}

/**
 * Series context of one map — pure metadata carried on the game's MatchConfig / MatchResult so a
 * result is self-describing. The engine does not read it.
 */
export interface SeriesGameContext {
  readonly seriesId: string;
  /** 1-based game number within the series. */
  readonly gameNumber: number;
  /** The map this game is. */
  readonly map: string;
  /** The map whose spatial data the engine actually simulated (all maps are Ascent today). */
  readonly geometry: string;
  /** Series team ("A" starts the veto) that picked the map, or "decider" for the last map left. */
  readonly pickedBy: "A" | "B" | "decider";
  /** Series team that chose the starting side. */
  readonly sideChosenBy: "A" | "B";
  /** Starting side of each SERIES team. */
  readonly startingSides: Readonly<Record<"A" | "B", "attack" | "defense">>;
  /** Engine slot (MatchConfig.teamA / teamB) each series team occupies in this game. */
  readonly slots: Readonly<Record<"A" | "B", "A" | "B">>;
}
