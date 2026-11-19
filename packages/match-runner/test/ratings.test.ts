import { describe, it, expect } from "vitest";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { listSimulatableTeams } from "@pv/game-data";
import { applyRoundForm, FORM_SIGMA_MAX, rosterProfiles, rosterTraits } from "../src/teams.js";
import { runMatch, type MatchConfig } from "../src/index.js";

describe("round form — normal distribution sized by consistency", () => {
  it("a perfectly consistent player is always exactly on level", () => {
    expect(applyRoundForm(AVERAGE_SKILLS, 1, 0.01, 0.3)).toEqual(AVERAGE_SKILLS);
  });
  it("an inconsistent player swings, bounded at ±2σ", () => {
    const hot = applyRoundForm(AVERAGE_SKILLS, 0, 1e-9, 0); // z clamps to +2
    const cold = applyRoundForm(AVERAGE_SKILLS, 0, 1e-9, 0.5); // z clamps to −2
    expect(hot.aim).toBeCloseTo(AVERAGE_SKILLS.aim * (1 + 2 * FORM_SIGMA_MAX));
    expect(cold.aim).toBeCloseTo(AVERAGE_SKILLS.aim * (1 - 2 * FORM_SIGMA_MAX));
  });
  it("pressure rounds lift the clutch player and sink the nervous one", () => {
    const up = applyRoundForm(AVERAGE_SKILLS, 1, 0.5, 0.5, { clutch: 1.0 });
    const down = applyRoundForm(AVERAGE_SKILLS, 1, 0.5, 0.5, { clutch: 0.2 });
    expect(up.aim).toBeCloseTo(AVERAGE_SKILLS.aim * 1.02);
    expect(down.aim).toBeCloseTo(AVERAGE_SKILLS.aim * 0.98);
  });
});

describe("real ratings → traits and profiles", () => {
  it("every simulatable team yields five in-range traits and profiles", () => {
    const team = listSimulatableTeams()[0]!;
    const traits = rosterTraits(team.id, 5);
    const profiles = rosterProfiles(team.id, 5);
    expect(traits).toHaveLength(5);
    expect(profiles).toHaveLength(5);
    for (const v of [...traits.flatMap((t) => Object.values(t)), ...profiles.flatMap((p) => Object.values(p))]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("an unknown team falls back to league-average traits", () => {
    expect(rosterTraits("no-such-team", 2)).toEqual([
      { gameSense: 0.6, trading: 0.6, clutch: 0.6 },
      { gameSense: 0.6, trading: 0.6, clutch: 0.6 },
    ]);
  });
});

describe("pre-match options", () => {
  const teams = listSimulatableTeams();
  const base: MatchConfig = {
    teamA: { id: teams[0]!.id, name: teams[0]!.name ?? "A" },
    teamB: { id: teams[1]!.id, name: teams[1]!.name ?? "B" },
    map: "Ascent",
    seed: 11,
    maxRounds: 12,
  };
  // Round signature: outcome plus every event's kind and time — sensitive to any behavioural change.
  const reasons = (c: MatchConfig) =>
    runMatch(c).rounds.map((r) => `${r.winner}:${r.reason}:${r.events.map((e) => `${e.kind}@${e.elapsedMs}`).join("/")}`).join(",");

  it("defaults are deterministic and explicit defaults change nothing", () => {
    expect(reasons(base)).toBe(reasons(base));
    expect(reasons({ ...base, tuning: {}, minThrowRates: {} })).toBe(reasons(base));
  });
  it("tuning and minimum throw rates are honoured (they change how the match plays out)", () => {
    const tuned = reasons({ ...base, tuning: { crossfireMsPerBit: 0, infoHalfLifeMs: 0, throwRatePerSec: 0 } });
    const throwing = reasons({ ...base, minThrowRates: { teams: { [base.teamA.id]: 2 } } });
    expect(tuned).not.toBe(reasons(base));
    expect(throwing).not.toBe(reasons(base));
  });
});
