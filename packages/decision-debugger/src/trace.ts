/**
 * Decision trace (Handoff §21).
 *
 * A structured record of what the AI considered: world summary, what the deciding team
 * observed/believes, the actions generated, which were excluded (and why), the per-action
 * prediction numbers, the selected action, and the reason. Every number here is copied
 * from the Action Generator's own computed evaluation — no illustrative values
 * (Handoff §21: "실제 숫자를 출력할 때는 모델이 계산한 값이어야 한다").
 */
import type { GenerationResult } from "@pv/action-generator";
import type { SpatialQuery, TeamDecisionContext, ZoneId } from "@pv/shared-types";
import type { TeamBeliefModel } from "@pv/decision-engine";

export interface TraceObservedEnemy {
  readonly playerId: string;
  readonly zone: string;
  readonly msAgo: number;
  readonly currentlyVisible: boolean;
}

export interface TraceBeliefZone {
  readonly zone: string;
  readonly pressure: number;
}

export interface TraceGeneratedAction {
  readonly id: string;
  readonly category: string;
  readonly feasible: boolean;
}

export interface TraceExcluded {
  readonly id: string;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

export interface TracePrediction {
  readonly id: string;
  readonly category: string;
  readonly requiredTimeMs: number;
  readonly estimatedRisk: number;
  readonly expectedUtility: number;
  readonly rationale: readonly string[];
}

export interface DecisionTrace {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly mapId: string;
  readonly roundNumber: number;
  readonly timeRemainingMs: number;
  readonly provenance: { readonly synthetic: boolean; readonly notes: readonly string[] };
  readonly world: {
    readonly decidingTeamId: string;
    readonly decidingSide: string;
    readonly attackersAlive: number;
    readonly defendersAlive: number;
    readonly knownEnemyAliveCount: number | null;
    readonly spikePhase: string;
    readonly spikeZone: string | null;
  };
  readonly observed: {
    readonly visibleEnemies: readonly TraceObservedEnemy[];
    readonly beliefTopZones: readonly TraceBeliefZone[];
  };
  readonly generated: readonly TraceGeneratedAction[];
  readonly excluded: readonly TraceExcluded[];
  readonly prediction: readonly TracePrediction[];
  readonly selected: { readonly id: string; readonly rationale: string } | null;
}

/** How many feasible actions to include in the PREDICTION section. */
const PREDICTION_LIMIT = 10;

export function buildTrace(
  team: TeamDecisionContext,
  belief: TeamBeliefModel,
  result: GenerationResult,
  spatial: SpatialQuery,
): DecisionTrace {
  const world = team.world;
  const attackersAlive = world.players.filter((p) => p.side === "attack" && p.alive).length;
  const defendersAlive = world.players.filter((p) => p.side === "defense" && p.alive).length;
  const spikeZone = world.spike.position
    ? String(spatial.nearestZone({ x: world.spike.position.x, y: world.spike.position.y }))
    : null;

  const visibleEnemies: TraceObservedEnemy[] = team.observation.visibleEnemies.map((e) => ({
    playerId: String(e.playerId),
    zone: String(spatial.nearestZone({ x: e.lastSeenPosition.x, y: e.lastSeenPosition.y })),
    msAgo: Math.max(0, team.observation.timestampMs - e.lastSeenAtMs),
    currentlyVisible: e.currentlyVisible,
  }));

  // Top believed enemy zones by aggregated pressure.
  const pressureByZone = new Map<ZoneId, number>();
  for (const b of belief.enemyBeliefs) {
    for (const [z, p] of b.distribution) pressureByZone.set(z, (pressureByZone.get(z) ?? 0) + p);
  }
  for (const [z, w] of belief.contactZones) pressureByZone.set(z, (pressureByZone.get(z) ?? 0) + w);
  const beliefTopZones: TraceBeliefZone[] = [...pressureByZone.entries()]
    .map(([z, p]) => ({ zone: String(z), pressure: Number(p.toFixed(3)) }))
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 5);

  const generated: TraceGeneratedAction[] = [
    ...result.feasible.map((a) => ({ id: a.id, category: a.category, feasible: true })),
    ...result.excluded.map((e) => ({ id: e.candidate.id, category: e.candidate.category, feasible: false })),
  ];

  const prediction: TracePrediction[] = result.feasible.slice(0, PREDICTION_LIMIT).map((a) => ({
    id: a.id,
    category: a.category,
    requiredTimeMs: a.evaluation.requiredTimeMs,
    estimatedRisk: a.evaluation.estimatedRisk,
    expectedUtility: a.evaluation.expectedUtility,
    rationale: a.evaluation.rationale,
  }));

  return {
    contextId: team.contextId,
    scenarioRef: team.scenarioRef,
    mapId: String(world.mapId),
    roundNumber: world.roundNumber,
    timeRemainingMs: world.timeRemainingMs,
    provenance: { synthetic: team.provenance.synthetic, notes: team.provenance.notes },
    world: {
      decidingTeamId: String(team.decidingTeamId),
      decidingSide: team.decidingSide,
      attackersAlive,
      defendersAlive,
      knownEnemyAliveCount: team.knownEnemyAliveCount,
      spikePhase: world.spike.phase,
      spikeZone,
    },
    observed: { visibleEnemies, beliefTopZones },
    generated,
    excluded: result.excluded.map((e) => ({
      id: e.candidate.id,
      reasons: e.reasons.map(String),
      explanation: e.explanation,
    })),
    prediction,
    selected: result.selected
      ? { id: result.selected.id, rationale: result.selectionRationale }
      : null,
  };
}
