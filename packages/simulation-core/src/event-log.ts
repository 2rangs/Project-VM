/**
 * Event log / event system (Handoff §17 "Event System", DECISION-010).
 *
 * The event log is the canonical, append-only, totally-ordered record of everything
 * that happened in a round. Events are the only mutation channel (the world-state
 * package folds them into state), and a serialised log plus the initial state and the
 * RNG seed is enough to reproduce a round exactly — the basis of the Replay Recorder
 * (Handoff §17) and of deterministic replay.
 *
 * The log owns `seq` assignment so ordering is monotonic by construction.
 */
import type { GameEvent, GameEventKind } from "@pv/shared-types";

/** A new event minus the `seq` the log assigns. Distributes over the union. */
export type EventInput = GameEvent extends infer E
  ? E extends GameEvent
    ? Omit<E, "seq">
    : never
  : never;

export class EventLog {
  private readonly events: GameEvent[] = [];
  private nextSeq: number;

  constructor(startSeq = 0) {
    if (!Number.isInteger(startSeq) || startSeq < 0) {
      throw new RangeError("startSeq must be a non-negative integer");
    }
    this.nextSeq = startSeq;
  }

  /** Stamp the next `seq` onto `input`, append it, and return the finalised event. */
  record(input: EventInput): GameEvent {
    const event = { ...input, seq: this.nextSeq } as GameEvent;
    this.events.push(event);
    this.nextSeq += 1;
    return event;
  }

  /**
   * Append an already-sequenced event (replay/deserialisation path). Enforces strictly
   * increasing `seq` so a restored log cannot silently reorder history.
   */
  append(event: GameEvent): void {
    const last = this.events[this.events.length - 1];
    if (last !== undefined && event.seq <= last.seq) {
      throw new RangeError(
        `event seq ${event.seq} is not greater than previous seq ${last.seq}`,
      );
    }
    this.events.push(event);
    if (event.seq >= this.nextSeq) this.nextSeq = event.seq + 1;
  }

  /** All events in order (read-only view). */
  all(): readonly GameEvent[] {
    return this.events;
  }

  /** Events with `seq` strictly greater than `afterSeq`. */
  since(afterSeq: number): GameEvent[] {
    return this.events.filter((e) => e.seq > afterSeq);
  }

  /** Narrow to a single kind, preserving the precise event subtype. */
  ofKind<K extends GameEventKind>(kind: K): Extract<GameEvent, { kind: K }>[] {
    return this.events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
  }

  last(): GameEvent | undefined {
    return this.events[this.events.length - 1];
  }

  get size(): number {
    return this.events.length;
  }

  /** Serialise to a plain, JSON-safe array (events are already plain objects). */
  toJSON(): GameEvent[] {
    return this.events.slice();
  }

  /** Rebuild a log from serialised events, validating order via {@link append}. */
  static fromJSON(events: readonly GameEvent[]): EventLog {
    const log = new EventLog();
    for (const e of events) log.append(e);
    return log;
  }
}
