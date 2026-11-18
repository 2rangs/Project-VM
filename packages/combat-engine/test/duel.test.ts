import { describe, it, expect } from "vitest";
import { resolveDuel } from "../src/index.js";
import { mkCombatant } from "./fixtures/weapons.js";

describe("resolveDuel basics", () => {
  const duel = {
    a: mkCombatant({ id: "a", weapon: "Vandal", posture: { preAim: true } }),
    b: mkCombatant({ id: "b", weapon: "Vandal" }),
    distanceMeters: 20,
  };

  it("produces a time-ordered event log ending in a kill", () => {
    const r = resolveDuel(duel, 7);
    expect(r.events.length).toBeGreaterThan(0);
    for (let i = 1; i < r.events.length; i++) {
      expect(r.events[i].timeMs).toBeGreaterThanOrEqual(r.events[i - 1].timeMs);
    }
    const firstKind = r.events[0].kind;
    expect(firstKind).toBe("shot"); // nothing happens before someone shoots
    expect(r.winner).not.toBeNull();
    expect(r.outcomes[r.loser!].health).toBe(0);
    expect(r.outcomes[r.winner!].alive).toBe(true);
    expect(r.timeToKillMs).toBeGreaterThan(0);
  });

  it("a hit is always preceded by a shot from the same actor", () => {
    const r = resolveDuel(duel, 11);
    const firstHit = r.events.findIndex((e) => e.kind === "hit");
    if (firstHit >= 0) {
      const priorShot = r.events.slice(0, firstHit).some((e) => e.kind === "shot" && e.actor === r.events[firstHit].actor);
      expect(priorShot).toBe(true);
    }
  });
});
