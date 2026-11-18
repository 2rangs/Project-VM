import type { ObservedEnemy, PlayerId, TeamReport } from "./shared-mirror.js";
import type { PerceptionParams } from "./params.js";

interface PendingReport {
  readonly report: TeamReport;
  /** The round-remaining value at or below which this report becomes team-available. */
  readonly availableAtRemainingMs: number;
}

export interface PlayerSightingInput {
  readonly observerId: PlayerId;
  readonly alive: boolean;
  readonly visibleEnemies: readonly ObservedEnemy[];
}

/**
 * Team communication: a player's sighting becomes a team-wide report only after a
 * comms delay (Handoff §24.2 — teammates don't act on info instantly). A dead player's
 * already-sent reports are optionally retained (their last callout still informs the team).
 *
 * Round clock is `timeRemainingMs` (decreasing): a report made at remaining R is
 * available once the clock has dropped to R - commsDelay, i.e. nowRemaining <= R - delay.
 */
export class CommunicationHub {
  private pending: PendingReport[] = [];

  constructor(private readonly params: PerceptionParams) {}

  /**
   * Ingest this tick's sightings and return the team reports available now.
   * `aliveIds` is the set of currently-alive players (for the dead-retention rule).
   */
  step(
    sightings: readonly PlayerSightingInput[],
    nowRemainingMs: number,
    aliveIds: ReadonlySet<PlayerId>,
  ): TeamReport[] {
    const delay = this.params.communication.commsDelayMs;
    for (const s of sightings) {
      for (const e of s.visibleEnemies) {
        if (!e.currentlyVisible) continue; // only fresh sightings are called out
        this.pending.push({
          report: {
            fromPlayerId: s.observerId,
            aboutEnemy: e.playerId,
            approxPosition: e.lastSeenPosition,
            reportedAtMs: nowRemainingMs,
          },
          availableAtRemainingMs: nowRemainingMs - delay,
        });
      }
    }

    // Retention: drop very old reports to keep the queue bounded (half-life based).
    const retention = this.params.memory.halfLifeMs + delay;
    this.pending = this.pending.filter(
      (p) => p.report.reportedAtMs - nowRemainingMs <= retention,
    );

    const available: TeamReport[] = [];
    for (const p of this.pending) {
      if (nowRemainingMs > p.availableAtRemainingMs) continue; // delay not elapsed yet
      if (!this.params.communication.retainDeadPlayerReports && !aliveIds.has(p.report.fromPlayerId)) {
        continue; // dead sender's report suppressed
      }
      available.push(p.report);
    }
    return available;
  }
}
