// PROJECT V — perception-engine public output types.
//
// NOTE: `PlayerObservation` is structurally the shared-types `ObservationState`
// (PV-3). `TeamObservation` is NOT yet in shared-types — it is a local type and a
// candidate to move into `@pv/shared-types` during monorepo integration.

import type {
  ObservationState,
  ObservedEnemy,
  PlayerId,
  TeamId,
  TeamReport,
} from "./shared-mirror.js";

/** Per-player observation. Identical shape to shared-types ObservationState. */
export type PlayerObservation = ObservationState;

/** Aggregated team-level picture built from every teammate's observation + comms. */
export interface TeamObservation {
  readonly teamId: TeamId;
  readonly timestampMs: number;
  /** Each living player's own observation this tick. */
  readonly perPlayer: Readonly<Record<PlayerId, PlayerObservation>>;
  /** Reports that have propagated to the team (post comms-delay). */
  readonly sharedReports: readonly TeamReport[];
  /** De-duplicated merged enemy picture across the team (freshest sighting wins). */
  readonly teamEnemyPicture: readonly ObservedEnemy[];
}
