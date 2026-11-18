/**
 * End-to-end analysis pipeline: DecisionContext JSON → WorldState → Belief → Actions →
 * Trace. This is the glue the Decision Debugger CLI and tests run.
 *
 * The SpatialQuery defaults to the Ascent placeholder; at final integration pass a real
 * spatial-engine adapter instead.
 */
import { loadDecisionContext } from "@pv/world-state";
import { buildTeamBelief, enemyPressureOnZone, type TeamBeliefModel } from "@pv/decision-engine";
import { generateActions, type GenerationResult } from "@pv/action-generator";
import type { SpatialQuery, TeamDecisionContext } from "@pv/shared-types";
import { createAscentPlaceholderSpatial } from "./ascent-placeholder.js";
import { buildTrace, type DecisionTrace } from "./trace.js";

export interface Analysis {
  readonly team: TeamDecisionContext;
  readonly belief: TeamBeliefModel;
  readonly result: GenerationResult;
  readonly trace: DecisionTrace;
}

export function analyzeDecisionContext(raw: unknown, spatial?: SpatialQuery): Analysis {
  const sq = spatial ?? createAscentPlaceholderSpatial();
  const team = loadDecisionContext(raw);
  const belief = buildTeamBelief(team.observation, sq, {
    knownEnemyAliveCount: team.knownEnemyAliveCount,
  });
  const result = generateActions({
    team,
    spatial: sq,
    enemyPressure: (z) => enemyPressureOnZone(belief, z),
  });
  const trace = buildTrace(team, belief, result, sq);
  return { team, belief, result, trace };
}
