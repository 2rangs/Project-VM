/**
 * Fixed-tick simulation clock (README §27.3, Handoff §17).
 *
 * The simulation advances in fixed, integer-millisecond ticks so that time is exact and
 * reproducible — never a wall-clock delta. Render speed is fully decoupled from this
 * clock (DECISION-010: "화면 배속과 경기 판정은 서로 독립적"): the UI may replay ticks at any
 * rate, but the judged outcome depends only on the tick sequence, not on real time.
 *
 * Time is kept as `tick * tickDurationMs` using integers, so there is no float drift.
 */

export interface ClockState {
  readonly tick: number;
  readonly tickDurationMs: number;
}

export class SimulationClock {
  private _tick: number;
  readonly tickDurationMs: number;

  constructor(tickDurationMs = 50, startTick = 0) {
    if (!Number.isInteger(tickDurationMs) || tickDurationMs <= 0) {
      throw new RangeError("tickDurationMs must be a positive integer (ms)");
    }
    if (!Number.isInteger(startTick) || startTick < 0) {
      throw new RangeError("startTick must be a non-negative integer");
    }
    this.tickDurationMs = tickDurationMs;
    this._tick = startTick;
  }

  /** Construct from a tick rate in Hz; the rate must divide 1000 evenly (integer ms). */
  static fromHz(hz: number, startTick = 0): SimulationClock {
    if (!Number.isInteger(1000 / hz)) {
      throw new RangeError(`tick rate ${hz}Hz does not yield an integer ms per tick`);
    }
    return new SimulationClock(1000 / hz, startTick);
  }

  get tick(): number {
    return this._tick;
  }

  /** Elapsed round time in milliseconds (exact integer). */
  get elapsedMs(): number {
    return this._tick * this.tickDurationMs;
  }

  /** Advance by one tick; returns the new tick index. */
  advance(): number {
    this._tick += 1;
    return this._tick;
  }

  /** Advance by N ticks; returns the new tick index. */
  advanceBy(ticks: number): number {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new RangeError("ticks must be a non-negative integer");
    }
    this._tick += ticks;
    return this._tick;
  }

  /** Smallest tick count that covers `ms` of simulated time (ceil). */
  msToTicks(ms: number): number {
    if (ms < 0) throw new RangeError("ms must be non-negative");
    return Math.ceil(ms / this.tickDurationMs);
  }

  reset(startTick = 0): void {
    if (!Number.isInteger(startTick) || startTick < 0) {
      throw new RangeError("startTick must be a non-negative integer");
    }
    this._tick = startTick;
  }

  getState(): ClockState {
    return { tick: this._tick, tickDurationMs: this.tickDurationMs };
  }

  static restore(state: ClockState): SimulationClock {
    return new SimulationClock(state.tickDurationMs, state.tick);
  }
}
