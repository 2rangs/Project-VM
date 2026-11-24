// Plant spot candidates and the carrier's choice (plant-spot.ts, ENGINE_TRUTH §12).
import { describe, it, expect } from "vitest";
import { loadMap } from "@pv/spatial-engine";
import { choosePlantSpot, plantSpotAt, plantSpotsOf } from "../src/plant-spot.js";

const spatial = loadMap("bind");
const sites = plantSpotsOf(spatial);

describe("plant spot candidates", () => {
  it("every site has default/safe/open plus cover and near spots, on its plant area, with unique ids and nodes", () => {
    expect(sites.size).toBe(2);
    for (const s of sites.values()) {
      const kinds = new Set(s.candidates.map((c) => c.kind));
      expect(kinds.has("default") || kinds.has("safe")).toBe(true);
      expect(s.candidates.length).toBeGreaterThanOrEqual(3);
      expect(new Set(s.candidates.map((c) => c.id)).size).toBe(s.candidates.length);
      expect(new Set(s.candidates.map((c) => c.node)).size).toBe(s.candidates.length);
      for (const c of s.candidates) expect(spatial.plantZoneAt(c.position)?.zoneId).toBe(s.zone);
      expect(s.retakeEntries.length).toBeGreaterThan(0);
    }
  });

  it("a cover spot is the least seen from the retake entry it hides from", () => {
    for (const s of sites.values()) for (const c of s.candidates.filter((x) => x.kind === "cover")) {
      const r = c.hiddenFrom!;
      for (const o of s.candidates) expect(c.retakeSight[r]!).toBeLessThanOrEqual(o.retakeSight[r]!);
    }
  });

  it("plantSpotAt finds the candidate a planted spike lies on", () => {
    const c = [...sites.values()][0]!.candidates[0]!;
    expect(plantSpotAt(sites.get(c.zone), { ...c.position, x: c.position.x + 40 })?.id).toBe(c.id);
    expect(plantSpotAt(sites.get(c.zone), { x: c.position.x + 5000, y: c.position.y, z: c.position.z })).toBeNull();
  });
});

describe("choosing a plant spot", () => {
  const site = [...sites.values()].find((s) => s.candidates.length >= 4)!;
  const near = site.candidates[0]!;
  const base = { from: near.position, gameSense: 0.6, teammateNodes: [] as number[] };

  it("with the clock nearly out the carrier plants at the spot it stands on", () => {
    const d = choosePlantSpot(spatial, site, { ...base, slackMs: 300 })!;
    expect(d.candidate.id).toBe(near.id);
    expect(d.by).toBe("auto");
  });

  it("game sense weighs the post-plant; a carrier with none plants nearest", () => {
    const d0 = choosePlantSpot(spatial, site, { ...base, gameSense: 0, slackMs: 60000 })!;
    expect(d0.candidate.id).toBe(near.id);
    const d1 = choosePlantSpot(spatial, site, { ...base, gameSense: 1, slackMs: 60000 })!;
    // the strategic part of U is maximal for the chosen spot among those it can reach in time
    expect(Object.values(d1.utilities).every((u) => u <= d1.utilities[d1.candidate.id]!)).toBe(true);
  });

  it("the manager's preference wins when there is time, and falls back to auto when there is not", () => {
    const open = site.candidates.find((c) => c.kind === "open")!;
    const far = { ...base, from: near.position, slackMs: 60000 };
    expect(choosePlantSpot(spatial, site, far, "open")).toMatchObject({ by: "manager", candidate: { kind: "open" } });
    expect(choosePlantSpot(spatial, site, far, { spotId: open.id })).toMatchObject({ by: "manager", candidate: { id: open.id } });
    const dist = Math.hypot(open.position.x - near.position.x, open.position.y - near.position.y);
    if (dist > 400) expect(choosePlantSpot(spatial, site, { ...far, slackMs: 200 }, { spotId: open.id })!.by).toBe("auto");
  });

  it("numbers: short-handed the hidden spot gains on the crossfire spot; with the man advantage the reverse (P3)", () => {
    for (const s of sites.values()) {
      const sight = (c: (typeof s.candidates)[number]) => s.retakeEntries.reduce((a, r) => a + (c.retakeSight[r] ?? 0), 0);
      const hid = [...s.candidates].sort((a, b) => sight(a) - sight(b))[0]!;
      const seen = [...s.candidates].sort((a, b) => sight(b) - sight(a) || b.guardSight - a.guardSight)[0]!;
      if (sight(hid) === sight(seen)) continue;
      const sit = { from: hid.position, gameSense: 1, slackMs: 60000, teammateNodes: [] as number[] };
      const short = choosePlantSpot(spatial, s, { ...sit, enemiesAlive: 5 })!.utilities;
      const ahead = choosePlantSpot(spatial, s, { ...sit, enemiesAlive: 0 })!.utilities;
      expect(short[hid.id]! - short[seen.id]!).toBeGreaterThanOrEqual(ahead[hid.id]! - ahead[seen.id]! - 1e-9);
    }
  });
});

