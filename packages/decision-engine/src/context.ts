/**
 * Per-decider DecisionContext assembly (README §15.1).
 *
 * The Action Generator's schemas consume a per-player {@link DecisionContext} (self +
 * observation + belief + public round facts). This builds one from a loaded
 * {@link TeamDecisionContext}, exposing only non-omniscient information: own-team state is
 * read directly; enemy alive-count comes from the team's known (kill-feed) count, never
 * from counting enemy ground truth (DECISION-004).
 */
import type {
  DecisionContext,
  PlayerState,
  PublicRoundContext,
  SpatialQuery,
  TeamDecisionContext,
  PlayerId,
} from "@pv/shared-types";
import { buildTeamBelief, type TeamBeliefModel } from "./belief.js";

type MinimalTeamBelief = TeamBeliefModel;

/** Alive players on the deciding team. */
export function decidingTeamPlayers(team: TeamDecisionContext): PlayerState[] {
  return team.world.players.filter((p) => p.teamId === team.decidingTeamId);
}

export function aliveDecidingPlayers(team: TeamDecisionContext): PlayerState[] {
  return decidingTeamPlayers(team).filter((p) => p.alive);
}

/** Build the zone-level belief model for the deciding team from its observation. */
export function teamBeliefFor(team: TeamDecisionContext, spatial: SpatialQuery): MinimalTeamBelief {
  return buildTeamBelief(team.observation, spatial, {
    knownEnemyAliveCount: team.knownEnemyAliveCount,
  });
}

function publicRound(team: TeamDecisionContext): PublicRoundContext {
  const aliveSelf = aliveDecidingPlayers(team).length;
  const enemyAlive =
    team.knownEnemyAliveCount ??
    // Fallback: enemies observed as alive (still non-omniscient — observation only).
    team.observation.visibleEnemies.length;
  return {
    mapId: team.world.mapId,
    patchVersion: team.world.patchVersion,
    roundNumber: team.world.roundNumber,
    timeRemainingMs: team.world.timeRemainingMs,
    spikePhase: team.world.spike.phase,
    aliveCountSelfTeam: aliveSelf,
    aliveCountEnemyTeam: enemyAlive,
  };
}

/** Assemble the per-player DecisionContext for `selfId` (must be on the deciding team). */
export function buildDecisionContext(team: TeamDecisionContext, selfId: PlayerId): DecisionContext {
  const self = team.world.players.find((p) => p.id === selfId);
  if (self === undefined) throw new Error(`player ${selfId} not found in world`);
  if (self.teamId !== team.decidingTeamId) {
    throw new Error(`player ${selfId} is not on the deciding team`);
  }
  const economy =
    team.world.economy.find((e) => e.teamId === team.decidingTeamId) ?? {
      teamId: team.decidingTeamId,
      side: team.decidingSide,
      credits: 0,
      lossBonusTier: 0,
      consecutiveLosses: 0,
    };
  return {
    selfId,
    teamId: team.decidingTeamId,
    side: team.decidingSide,
    round: publicRound(team),
    economy,
    observation: team.observation,
    belief: team.belief,
  };
}
