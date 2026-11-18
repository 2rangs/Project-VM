import { describe, it, expect } from "vitest";
import { SimulationClock } from "@pv/simulation-core";

describe("SimulationClock (fixed-tick, DECISION-010)", () => {
  it("advances ticks and reports exact integer elapsed ms", () => {
    const clock = new SimulationClock(50);
    expect(clock.tick).toBe(0);
    expect(clock.elapsedMs).toBe(0);
    clock.advance();
    expect(clock.tick).toBe(1);
    expect(clock.elapsedMs).toBe(50);
    clock.advanceBy(9);
    expect(clock.tick).toBe(10);
    expect(clock.elapsedMs).toBe(500);
  });

  it("constructs from an integer-divisible Hz rate", () => {
    const clock = SimulationClock.fromHz(20);
    expect(clock.tickDurationMs).toBe(50);
  });

  it("rejects a tick rate that is not integer ms", () => {
    expect(() => SimulationClock.fromHz(32)).toThrow();
  });

  it("converts ms to covering ticks (ceil)", () => {
    const clock = new SimulationClock(50);
    expect(clock.msToTicks(0)).toBe(0);
    expect(clock.msToTicks(50)).toBe(1);
    expect(clock.msToTicks(51)).toBe(2);
    expect(clock.msToTicks(4000)).toBe(80); // spike plant 4s at 50ms ticks
  });

  it("serializes and restores state", () => {
    const clock = new SimulationClock(25, 7);
    const restored = SimulationClock.restore(clock.getState());
    expect(restored.tick).toBe(7);
    expect(restored.tickDurationMs).toBe(25);
    expect(restored.elapsedMs).toBe(175);
  });

  it("rejects invalid tick durations", () => {
    expect(() => new SimulationClock(0)).toThrow();
    expect(() => new SimulationClock(10.5)).toThrow();
  });
});
