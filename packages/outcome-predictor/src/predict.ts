/**
 * Outcome Predictor v0 (README §25) — limited, budget-bounded lookahead.
 *
 * Does NOT explore the full future (README §25.2). It ranks the generator's feasible
 * candidates by static utility, takes the top K, and for each runs a shallow (depth-1)
 * projection: if the candidate's target zone has believed enemy contact, it estimates the
 * duel win probability (via a CombatEstimator) and folds that, plus any economy value, into
 * a projected value. A compute budget caps how many contact evaluations ("nodes") run;
 * once the budget is spent, remaining candidates fall back to their static utility
 * (heuristic fallback, §25.2). Deterministic: same inputs → same predictions.
 */
import type {
  CombatEstimator,
  EconomyContext,
  EconomyEvaluator,
  PolicyView,
  SpatialQuery,
  Vector3,
  ZoneId,
} from "@pv/shared-types";
import { economyOptionValue, pickEconomyOption } from "@pv/shared-types";
import type { EvaluatedAction } from "@pv/action-generator";

export interface PredictBudget {
  /** Max number of combat ("contact") evaluations before falling back. Default Infinity. */
  readonly maxNodes?: number;
  /** How many top candidates to consider. Default 6. */
  readonly topK?: number;
}

export interface OutcomePrediction {
  readonly actionId: string;
  readonly category: string;
  readonly staticUtility: number;
  readonly projectedWinProb: number | null;
  readonly economyValue: number;
  readonly projectedValue: number;
  readonly usedFallback: boolean;
  readonly rationale: readonly string[];
}

export interface PredictInput {
  readonly candidates: readonly EvaluatedAction[]; // feasible actions
  readonly view: PolicyView;
  readonly spatial: SpatialQuery;
  readonly combat: CombatEstimator;
  readonly economy?: EconomyEvaluator;
  readonly enemyPressure?: (zone: ZoneId) => number;
  readonly budget?: PredictBudget;
}

export interface PredictResult {
  readonly predictions: readonly OutcomePrediction[];
  readonly nodesUsed: number;
  readonly maxNodes: number;
  readonly topK: number;
}

const COMBAT_WEIGHT = 0.6;
const ECONOMY_WEIGHT = 0.4;
const CONTACT_EPSILON = 1e-6;

const v2 = (v: Vector3) => ({ x: v.x, y: v.y });

/** Extract a target zone from a candidate's parameters, if any. */
function targetZoneOf(cand: EvaluatedAction): ZoneId | null {
  const p = cand.parameters as Record<string, unknown>;
  return (p["targetZone"] ?? p["to"] ?? p["at"] ?? p["zone"] ?? p["plantZone"] ?? p["realZone"] ?? null) as ZoneId | null;
}

export function predictOutcomes(input: PredictInput): PredictResult {
  const { view, spatial, combat } = input;
  const pressure = input.enemyPressure ?? (() => 0);
  const topK = input.budget?.topK ?? 6;
  const maxNodes = input.budget?.maxNodes ?? Infinity;

  const ranked = [...input.candidates]
    .sort((a, b) => b.evaluation.expectedUtility - a.evaluation.expectedUtility || (a.id < b.id ? -1 : 1))
    .slice(0, topK);

  const econCtx: EconomyContext = {
    roundNumber: view.roundNumber,
    side: view.side,
    aliveSelf: view.teammates.filter((p) => p.alive).length,
    aliveEnemy: view.knownEnemyAliveCount ?? view.observation.visibleEnemies.length,
    timeRemainingMs: view.timeRemainingMs,
    matchScore: view.matchScore,
    selfLoadoutValue: null,
  };

  let nodesUsed = 0;
  const predictions: OutcomePrediction[] = ranked.map((cand) => {
    const rationale: string[] = [`static ${cand.evaluation.expectedUtility.toFixed(3)}`];
    const zone = targetZoneOf(cand);
    const contact = zone ? pressure(zone) : 0;

    // Economy value for economy-sensitive actions.
    let economyValue = 0;
    if (input.economy && (cand.schemaId === "strategic.save" || cand.schemaId.startsWith("strategic.exitKill"))) {
      const re = cand.schemaId === "strategic.save" ? /save/i : /exit/i;
      const opts = cand.schemaId === "strategic.save" ? input.economy.saveOptions(econCtx) : input.economy.exitKillOptions(econCtx);
      const opt = pickEconomyOption(opts, re);
      if (opt) {
        economyValue = economyOptionValue(opt) / 2; // normalize [-2,2] → [-1,1]
        rationale.push(`econ ${economyValue.toFixed(3)} (${opt.action})`);
      }
    }

    // No expected contact → no duel to look ahead through.
    if (!zone || contact <= CONTACT_EPSILON) {
      const projectedValue = cand.evaluation.expectedUtility + ECONOMY_WEIGHT * economyValue;
      rationale.push("no expected contact — static projection");
      return {
        actionId: cand.id, category: cand.category, staticUtility: cand.evaluation.expectedUtility,
        projectedWinProb: null, economyValue, projectedValue: Number(projectedValue.toFixed(4)),
        usedFallback: false, rationale,
      };
    }

    // Contact expected → costs one node. Over budget → heuristic fallback.
    if (nodesUsed + 1 > maxNodes) {
      rationale.push("compute budget exceeded — heuristic fallback (§25.2)");
      const projectedValue = cand.evaluation.expectedUtility + ECONOMY_WEIGHT * economyValue;
      return {
        actionId: cand.id, category: cand.category, staticUtility: cand.evaluation.expectedUtility,
        projectedWinProb: null, economyValue, projectedValue: Number(projectedValue.toFixed(4)),
        usedFallback: true, rationale,
      };
    }
    nodesUsed += 1;

    const actor = view.teammates.find((p) => p.id === cand.actors[0]);
    const winProb = combat.estimateDuelWinProb({
      attackerWeapon: actor?.weapon ? String(actor.weapon.weaponId) : null,
      defenderWeapon: "vandal", // believed rifle; refine when enemy loadout belief exists
      attackerHealth: actor?.health ?? 100,
      defenderHealth: 100,
      distanceMeters: null,
      attackerHasCover: false,
      defenderHasCover: true, // defender typically holds an angle
      attackerFlashed: false,
      defenderFlashed: false,
      attackerAim: 0.5,
      defenderAim: 0.5,
    });
    rationale.push(`contact ${contact.toFixed(2)} → winProb ${winProb.toFixed(2)}`);
    const projectedValue =
      cand.evaluation.expectedUtility + COMBAT_WEIGHT * (winProb - 0.5) + ECONOMY_WEIGHT * economyValue;
    return {
      actionId: cand.id, category: cand.category, staticUtility: cand.evaluation.expectedUtility,
      projectedWinProb: Number(winProb.toFixed(4)), economyValue, projectedValue: Number(projectedValue.toFixed(4)),
      usedFallback: false, rationale,
    };
  });

  predictions.sort((a, b) => b.projectedValue - a.projectedValue || (a.actionId < b.actionId ? -1 : 1));
  return { predictions, nodesUsed, maxNodes: maxNodes === Infinity ? -1 : maxNodes, topK };
}
