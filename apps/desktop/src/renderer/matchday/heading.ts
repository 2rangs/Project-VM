// Per-player heading eased over MATCH time, so a first-person camera, a figure or a radar that
// rotates with the player turns instead of snapping when the engine's facing jumps (a duel, a new
// hold angle). A jump in match time — a seek, a new round, a scrub while paused — snaps to the
// target, so the eased heading never lags behind a cut. Pure module: runs under `node --test`.

/** Time constant of the ease (match ms). */
export const TURN_TAU_MS = 90;
/** Fastest turn (degrees per match second). */
export const TURN_MAX_DEG_S = 720;
/** A gap in match time larger than this is a cut, not playback: snap. */
export const TURN_SNAP_GAP_MS = 400;

export class HeadingSmoother {
  private readonly state = new Map<string, { rad: number; tMs: number }>();

  /** The eased heading (radians) of `id` at match time `tMs`, moving toward `target`. */
  get(id: string, target: number, tMs: number): number {
    const s = this.state.get(id);
    const dt = s ? tMs - s.tMs : Infinity;
    if (!s || dt < 0 || dt > TURN_SNAP_GAP_MS) { this.state.set(id, { rad: target, tMs }); return target; }
    if (dt === 0) return s.rad;
    const diff = Math.atan2(Math.sin(target - s.rad), Math.cos(target - s.rad));
    const maxStep = (TURN_MAX_DEG_S * Math.PI / 180) * (dt / 1000);
    s.rad += Math.max(-maxStep, Math.min(maxStep, diff * (1 - Math.exp(-dt / TURN_TAU_MS))));
    s.tMs = tMs;
    return s.rad;
  }
}
