// Messages between the Electron main process and the bundled engine host (src/engine/host.ts).
// Results travel as a JSON string: the renderer-facing payloads are then exactly what the old
// stdout-JSON subprocesses produced (no `undefined` properties, no NaN), whatever the transport.

export type EngineOp =
  | 'ping'
  /** One whole map; emits `progress` events ({round, score}) after every round. */
  | 'match.run'
  /** Interactive (managed) match session: start (config incl. plan / scouting) → {state}; cmd (SessionCommand) → reply; stop. */
  | 'session.start' | 'session.cmd' | 'session.stop'
  /** Series (veto → maps): start (SeriesStartRequest) → {view}; cmd → reply; stop. */
  | 'series.start' | 'series.cmd' | 'series.stop'
  /** One background career series (CareerSimRequest) → {outcome}. */
  | 'career.series'
  /** [manager] Pre-match opponent report (PrematchRequest) → {report, filmGames}. */
  | 'prematch.report'
  /** [tactics] The map's plant spots, retake entries and mid ({mapId}) → TacticsMapView. Plays nothing. */
  | 'tactics.map';

export interface EngineRequest { id: number; op: EngineOp; payload?: unknown }

export type EngineMessage =
  /** Sent once, when the host has loaded and can take requests. */
  | { ready: true; pid: number }
  | { id: number; ok: true; json: string }
  | { id: number; ok: false; error: string }
  | { id: number; event: 'progress'; data: unknown };
