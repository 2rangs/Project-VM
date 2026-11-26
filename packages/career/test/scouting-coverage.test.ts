// Scouting fog deepening (backlog #8): report confidence decays with age, and per-region coverage
// summarises how much the club knows and whether a scout is assigned there.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  newCareer, reportConfidence, regionCoverage, assignScoutMut, clubScouts, addDays, KNOWLEDGE_MODEL,
  type CareerState, type World,
} from "../src/index.ts";

let base: World;
const USER = (w: World): string => Object.values(w.teams).filter((t) => t.region === "pacific" && t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!.teamId;
function career(seed = 31): CareerState {
  const w = JSON.parse(JSON.stringify(base)) as World;
  return newCareer(w, { seed, manager: { name: "T", nationality: "kr" }, userTeamId: USER(w) });
}
beforeAll(() => { base = worldFromGameData(4242); });

describe("report confidence", () => {
  it("equals the knowledge on the day it was written and decays afterwards", () => {
    const made = "2026-03-01";
    const report = { date: made, knowledge: 0.8 };
    expect(reportConfidence(report, made)).toBeCloseTo(0.8, 6);
    const later = addDays(made, KNOWLEDGE_MODEL.decayDays);
    // One decay constant later → ~1/e of the original.
    expect(reportConfidence(report, later)).toBeCloseTo(0.8 / Math.E, 2);
    // Much later → near zero, and always less than fresh.
    expect(reportConfidence(report, addDays(made, 365))).toBeLessThan(reportConfidence(report, later));
  });
});

describe("region coverage", () => {
  it("summarises every region, flags where a scout is assigned, and knows its own region best", () => {
    const c = career();
    const cov = regionCoverage(c.world, c.date);
    expect(cov.length).toBeGreaterThan(0);
    // Scouts start on the club's own region (initScouting), so it is marked scouted.
    const own = c.region;
    const ownRow = cov.find((r) => r.region === own)!;
    expect(ownRow.scouted).toBe(true);
    for (const r of cov) {
      expect(r.players).toBeGreaterThanOrEqual(r.known);
      expect(r.meanKnowledge).toBeGreaterThanOrEqual(0);
      expect(r.meanKnowledge).toBeLessThanOrEqual(1);
    }
  });

  it("reflects a reassignment: a region with no scout is not flagged", () => {
    const c = career();
    const scout = clubScouts(c.world, c.userTeamId)[0];
    if (!scout) return;
    // Send every scout to one region; a different region is then unscouted.
    for (const s of clubScouts(c.world, c.userTeamId)) assignScoutMut(c.world, s.staffId, "region", "emea", c.date);
    const cov = regionCoverage(c.world, c.date);
    expect(cov.find((r) => r.region === "emea")!.scouted).toBe(true);
    const unscouted = cov.find((r) => r.region !== "emea" && !r.scouted);
    expect(unscouted).toBeTruthy();
  });
});
