import { describe, it, expect } from "vitest";
import { EventLog } from "@pv/simulation-core";
import { asEventId, asPlayerId, asWeaponId } from "@pv/shared-types";
import type { GameEvent } from "@pv/shared-types";

const killInput = (id: string, tick: number, timeMs: number) =>
  ({
    kind: "kill" as const,
    id: asEventId(id),
    tick,
    timeMs,
    victim: asPlayerId("p-victim"),
    killer: asPlayerId("p-killer"),
    assists: [],
    cause: "weapon" as const,
    weaponId: asWeaponId("vandal"),
  });

describe("EventLog (Handoff §17)", () => {
  it("assigns monotonic seq on record", () => {
    const log = new EventLog();
    const e0 = log.record(killInput("e0", 0, 0));
    const e1 = log.record(killInput("e1", 1, 50));
    expect(e0.seq).toBe(0);
    expect(e1.seq).toBe(1);
    expect(log.size).toBe(2);
  });

  it("round-trips through toJSON/fromJSON preserving order", () => {
    const log = new EventLog();
    log.record(killInput("a", 0, 0));
    log.record(killInput("b", 2, 100));
    log.record(killInput("c", 5, 250));

    const json = JSON.stringify(log.toJSON());
    const restored = EventLog.fromJSON(JSON.parse(json) as GameEvent[]);
    expect(restored.size).toBe(3);
    expect(restored.all().map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(restored.last()?.id).toBe("c");
  });

  it("rejects an appended event with non-increasing seq", () => {
    const log = new EventLog();
    log.record(killInput("a", 0, 0)); // seq 0
    const bad = { ...killInput("b", 1, 50), seq: 0 } as GameEvent;
    expect(() => log.append(bad)).toThrow();
  });

  it("filters by kind with a narrowed type", () => {
    const log = new EventLog();
    log.record({ kind: "roundStart", id: asEventId("r"), tick: 0, timeMs: 0, roundNumber: 1 });
    log.record(killInput("k", 1, 40));
    const kills = log.ofKind("kill");
    expect(kills).toHaveLength(1);
    expect(kills[0]!.victim).toBe("p-victim");
  });

  it("since() returns only events after a given seq", () => {
    const log = new EventLog();
    log.record(killInput("a", 0, 0));
    log.record(killInput("b", 1, 50));
    log.record(killInput("c", 2, 100));
    expect(log.since(0).map((e) => e.id)).toEqual(["b", "c"]);
  });
});
