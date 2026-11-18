/**
 * PolicyView ↔ TeamDecisionContext adapters.
 *
 * `viewFromTeamContext` projects a loaded scenario into the team's *observable* view,
 * dropping the WorldState and all enemy ground truth (teammates only) — this is what the
 * round-simulator would hand a DecisionPolicy (DECISION-004).
 *
 * `synthContextFromView` rebuilds the minimal TeamDecisionContext the Action Generator
 * needs FROM a view. The synthetic world contains only the team's own players, so no enemy
 * ground truth can enter generation through it; enemy info comes solely from
 * `view.observation`/`view.belief`.
 */
import {
  asMatchId,
  asRoundId,
  type PolicyView,
  type ScenarioProvenance,
  type Side,
  type TeamDecisionContext,
  type TeamEconomyState,
} from "@pv/shared-types";
import { createWorldState } from "@pv/world-state";

export function viewFromTeamContext(team: TeamDecisionContext): PolicyView {
  const world = team.world;
  const teammates = world.players.filter((p) => p.teamId === team.decidingTeamId);
  const economy: TeamEconomyState =
    world.economy.find((e) => e.teamId === team.decidingTeamId) ?? {
      teamId: team.decidingTeamId,
      side: team.decidingSide,
      credits: 0,
      lossBonusTier: 0,
      consecutiveLosses: 0,
    };
  return {
    contextId: team.contextId,
    scenarioRef: team.scenarioRef,
    teamId: team.decidingTeamId,
    side: team.decidingSide,
    roundNumber: world.roundNumber,
    timeRemainingMs: world.timeRemainingMs,
    mapId: world.mapId,
    patchVersion: world.patchVersion,
    spike: world.spike,
    teammates,
    observation: team.observation,
    belief: team.belief,
    economy,
    knownEnemyAliveCount: team.knownEnemyAliveCount,
    matchScore: world.matchScore ?? null,
  };
}

const SYNTH_PROVENANCE: ScenarioProvenance = {
  sourceId: "pv-team-engine-synth",
  sourceUrl: null,
  sourceVersion: null,
  gamePatch: null,
  retrievedAt: "",
  evidenceType: "simulated",
  confidence: null,
  verified: false,
  verificationLevel: 0,
  synthetic: true,
  sha256: null,
  notes: ["Synthetic TeamDecisionContext rebuilt from a PolicyView (team-observable only)."],
};

export function synthContextFromView(view: PolicyView): TeamDecisionContext {
  const world = createWorldState({
    matchId: asMatchId(`${view.contextId}:synth`),
    roundId: asRoundId(`${view.contextId}:r${view.roundNumber}`),
    roundNumber: view.roundNumber,
    mapId: view.mapId,
    patchVersion: view.patchVersion,
    players: view.teammates, // own team only — no enemy ground truth
    timeRemainingMs: view.timeRemainingMs,
    spike: view.spike,
    economy: [view.economy],
    matchScore: view.matchScore ?? null,
  });
  const side: Side = view.side;
  return {
    contextId: view.contextId,
    scenarioRef: view.scenarioRef,
    world,
    decidingTeamId: view.teamId,
    decidingSide: side,
    observation: view.observation,
    belief: view.belief,
    knownEnemyAliveCount: view.knownEnemyAliveCount,
    coordinateSpace: "minimapUnits",
    provenance: SYNTH_PROVENANCE,
  };
}
