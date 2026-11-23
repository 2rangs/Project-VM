// What the live match view draws is each round's recorded `move` events (MatchConfig.recordTracks).
// This checks them against the navigation roadmap for whole real matches: every position is on
// walkable floor, every step is one tick long, and the middle of every step is on the floor too —
// so no player is ever drawn passing through a wall or jumping between two places.
import { describe, it, expect } from "vitest";
import { runMatch } from "../src/index.js";
import { loadSpatial } from "../src/setup.js";

type P3 = { x: number; y: number; z: number };
interface Move { kind: string; playerId: string; timeMs: number; from: P3; to: P3 }

describe("recorded movement of a real match stays on the floor", () => {
  const nav = loadSpatial("ascent").nav!;

  it.each([[11], [42]])("seed %i: every recorded position and step", (seed) => {
    const r = runMatch({ teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, map: "ascent", seed, recordTracks: true });
    let samples = 0, worst = 0, longest = 0, spawnMoves = 0;
    for (const round of r.rounds) {
      const last = new Map<string, P3>();
      for (const e of round.replay.events as unknown as Move[]) {
        if (e.kind !== "move") continue;
        samples++;
        if (e.timeMs === 0 && e.from.x === e.to.x && e.from.y === e.to.y) spawnMoves++;
        worst = Math.max(worst, nav.distanceToWalkable(e.to));
        worst = Math.max(worst, nav.distanceToWalkable({ x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2, z: (e.from.z + e.to.z) / 2 }));
        longest = Math.max(longest, Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y, e.to.z - e.from.z));
        // a track is continuous: each step starts where the previous one ended
        const prev = last.get(e.playerId);
        if (prev) expect(Math.hypot(e.from.x - prev.x, e.from.y - prev.y)).toBeLessThan(1e-6);
        last.set(e.playerId, e.to);
      }
      expect(last.size).toBe(10); // every player has a position, also one who never left their spot
    }
    expect(spawnMoves).toBe(10 * r.rounds.length);
    expect(samples).toBeGreaterThan(20_000);
    expect(worst).toBeLessThanOrEqual(1);     // uu off the roadmap's floor (a body is 35 uu wide)
    expect(longest).toBeLessThanOrEqual(110); // one 100 ms tick at running speed is 67.5 uu; a drop is steeper
    // eslint-disable-next-line no-console
    console.log(`seed ${seed}: ${samples} positions, furthest off the floor ${worst.toFixed(2)} uu, longest step ${longest.toFixed(1)} uu`);
  }, 120_000);
});
