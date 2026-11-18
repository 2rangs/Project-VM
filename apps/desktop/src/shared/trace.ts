// DecisionTrace type + parser (Handoff §21).
//
// Shape MIRRORS PV-3's @pv/decision-debugger `src/trace.ts` DecisionTrace
// (origin/claude/pv-core). Copied here (not imported) so the desktop app stays
// standalone; the committed fixtures in test/fixtures/traces are REAL output of
// that pipeline (see their README). parseTrace() validates the minimum shape the
// Debugger UI renders, so a schema drift fails loudly instead of rendering junk.

export interface TraceObservedEnemy {
  playerId: string; zone: string; msAgo: number; currentlyVisible: boolean;
}
export interface TraceBeliefZone { zone: string; pressure: number }
export interface TraceGeneratedAction { id: string; category: string; feasible: boolean }
export interface TraceExcluded { id: string; reasons: string[]; explanation: string }
export interface TracePrediction {
  id: string; category: string; requiredTimeMs: number;
  estimatedRisk: number; expectedUtility: number; rationale: string[];
}
export interface DecisionTrace {
  contextId: string;
  scenarioRef: string | null;
  mapId: string;
  roundNumber: number;
  timeRemainingMs: number;
  provenance: { synthetic: boolean; notes: string[] };
  world: {
    decidingTeamId: string; decidingSide: string;
    attackersAlive: number; defendersAlive: number;
    knownEnemyAliveCount: number | null;
    spikePhase: string; spikeZone: string | null;
  };
  observed: { visibleEnemies: TraceObservedEnemy[]; beliefTopZones: TraceBeliefZone[] };
  generated: TraceGeneratedAction[];
  excluded: TraceExcluded[];
  prediction: TracePrediction[];
  selected: { id: string; rationale: string } | null;
}

function req(obj: Record<string, unknown>, key: string): unknown {
  if (!(key in obj)) throw new TypeError(`trace missing "${key}"`);
  return obj[key];
}

/** Validate + normalize unknown JSON into a DecisionTrace. Throws on drift. */
export function parseTrace(input: unknown): DecisionTrace {
  if (!input || typeof input !== 'object') throw new TypeError('trace must be an object');
  const t = input as Record<string, unknown>;
  for (const k of ['contextId', 'mapId', 'world', 'observed', 'generated', 'excluded', 'prediction']) req(t, k);
  const world = t.world as Record<string, unknown>;
  for (const k of ['decidingSide', 'attackersAlive', 'defendersAlive', 'spikePhase']) req(world, k);
  const observed = t.observed as Record<string, unknown>;
  if (!Array.isArray(observed.visibleEnemies) || !Array.isArray(observed.beliefTopZones)) {
    throw new TypeError('trace.observed must have visibleEnemies[] and beliefTopZones[]');
  }
  if (!Array.isArray(t.excluded)) throw new TypeError('trace.excluded must be an array');
  // trust the structure now that the required keys exist
  return input as DecisionTrace;
}

/** Convenience selectors the UI uses. */
export function feasibleCount(trace: DecisionTrace): number {
  return trace.generated.filter((g) => g.feasible).length;
}
export function predictionById(trace: DecisionTrace, id: string): TracePrediction | undefined {
  return trace.prediction.find((p) => p.id === id);
}
