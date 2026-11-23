// Per-map tactics in a real match: on a map's own geometry the teams play that map's sites.
import { describe, it, expect } from "vitest";
import { runMatch } from "../src/index.js";

const plants = (map: string, seeds: number[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const seed of seeds) {
    const r = runMatch({ teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, seed, map, geometry: "own" });
    for (const round of r.rounds) for (const e of round.events as ReadonlyArray<{ kind?: string; zoneId?: string }>) {
      if (e.kind === "planted" && e.zoneId) out[e.zoneId] = (out[e.zoneId] ?? 0) + 1;
    }
  }
  return out;
};

describe("per-map tactics in a match", () => {
  it.each(["Haven", "Lotus"])("%s: the spike goes down on all three sites, C among them", (map) => {
    const p = plants(map, [1, 2, 3, 4]);
    for (const site of ["a-site", "b-site", "c-site"]) expect(p[site] ?? 0, `${map} ${site} ${JSON.stringify(p)}`).toBeGreaterThan(0);
    const total = Object.values(p).reduce((s, n) => s + n, 0);
    expect((p["c-site"] ?? 0) / total, JSON.stringify(p)).toBeGreaterThan(0.1);
  });
});
