// MatchConfig.geometry: by default every map is simulated on Ascent's geometry (the tactical layer
// is written for Ascent); "own" simulates a map on its own zone graph, roadmap and sight table.
import { describe, it, expect } from "vitest";
import { MAP_IDS, loadMapData } from "@pv/spatial-engine";
import { runMatch, type MatchConfig } from "../src/index.js";
import { geometryOf } from "../src/match.js";
import { loadSpatial } from "../src/setup.js";

const base = { teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, seed: 5, maxRounds: 6 } as const;
const signature = (c: MatchConfig): string => JSON.stringify(runMatch(c).rounds.map((r) => [r.winner, r.reason, r.kills, r.events.length]));
const zonesIn = (c: MatchConfig): Set<string> => {
  const out = new Set<string>();
  for (const r of runMatch(c).rounds) for (const e of r.events as ReadonlyArray<{ zoneId?: string }>) if (e.zoneId) out.add(e.zoneId);
  return out;
};

describe("which geometry a match is simulated on", () => {
  it("default: Ascent's, whatever the map is called — and asking for Ascent's own is the same match", () => {
    expect(geometryOf({ map: "Bind" })).toBe("ascent");
    expect(geometryOf({ map: "Ascent", geometry: "own" })).toBe("ascent");
    expect(geometryOf({ map: " Bind ", geometry: "own" })).toBe("bind");
    const ascentZones = new Set(loadMapData("ascent").data.zones.map((z) => z.id));
    for (const z of zonesIn({ ...base, map: "Bind" })) expect(ascentZones.has(z), z).toBe(true);
    expect(signature({ ...base, map: "Ascent", geometry: "own" })).toBe(signature({ ...base, map: "Ascent" }));
    expect(signature({ ...base, map: "Ascent", geometry: "ascent" })).toBe(signature({ ...base, map: "Ascent" }));
  });

  it('"own": a Bind match happens in Bind\'s zones, on Bind\'s floor, with Bind\'s sight table', () => {
    const bind = loadMapData("bind");
    const bindZones = new Set(bind.data.zones.map((z) => z.id));
    const ascentZones = new Set(loadMapData("ascent").data.zones.map((z) => z.id));
    const seen = zonesIn({ ...base, map: "Bind", geometry: "own" });
    expect(seen.size).toBeGreaterThan(3);
    for (const z of seen) expect(bindZones.has(z), z).toBe(true);
    expect([...seen].some((z) => !ascentZones.has(z))).toBe(true); // somewhere Ascent does not have
    // every recorded position is on Bind's roadmap floor
    const nav = loadSpatial("bind").nav!;
    expect(nav.hasVisibility).toBe(true);
    const r = runMatch({ ...base, map: "Bind", geometry: "own", recordTracks: true });
    let samples = 0, worst = 0;
    for (const round of r.rounds) for (const e of round.replay.events as unknown as Array<{ kind: string; to: { x: number; y: number; z: number } }>) {
      if (e.kind !== "move") continue;
      samples++;
      worst = Math.max(worst, nav.distanceToWalkable(e.to));
    }
    expect(samples).toBeGreaterThan(2000);
    expect(worst).toBeLessThanOrEqual(1);
    // and it is not the Ascent match under another name
    expect(signature({ ...base, map: "Bind", geometry: "own" })).not.toBe(signature({ ...base, map: "Bind" }));
  });

  it('"own" is deterministic, and a map with no spatial data is refused by name', () => {
    expect(signature({ ...base, map: "Sunset", geometry: "own" })).toBe(signature({ ...base, map: "Sunset", geometry: "own" }));
    expect(() => runMatch({ ...base, map: "Dust2", geometry: "own" })).toThrow(/no spatial data for map "Dust2"/);
    expect(() => runMatch({ ...base, map: "Dust2" })).not.toThrow(); // default: the name is only a label
  });

  it.each(MAP_IDS.map((id) => [id] as const))('"own" on %s: a match runs to the end and every map loads its sight table', (id) => {
    const engine = loadSpatial(id);
    expect(engine.nav!.hasVisibility).toBe(true);
    const r = runMatch({ ...base, map: id, geometry: "own", maxRounds: 3 });
    expect(r.rounds).toHaveLength(3);
    for (const round of r.rounds) expect(["elimination", "spikeDetonation", "spikeDefused", "timeExpired"]).toContain(round.reason);
  });
});
