import { describe, it, expect } from "vitest";
import { OpponentModel, tendencyLean } from "../src/index.js";

describe("OpponentModel.seed — prior knowledge is pseudo-observations, not a verdict", () => {
  it("an unseeded model is unchanged: no data, even split, zero confidence", () => {
    const read = new OpponentModel().read();
    expect(read.attackSite).toEqual({ probability: { A: 0.5, B: 0.5 }, confidence: 0, samples: 0 });
  });

  it("a prior tilts the read from round 1, with confidence N / (N + K·α)", () => {
    const m = new OpponentModel(0.6); // α = 1
    m.seed({ attackSite: { A: 3, B: 1 } });
    const est = m.read().attackSite;
    expect(est.probability.A).toBeCloseTo((3 + 1) / (4 + 2), 12);
    expect(est.confidence).toBeCloseTo(4 / 6, 12);
    expect(m.read().defenseSite.samples).toBe(0); // only what was seeded
    expect(tendencyLean(est, "A")).toBeGreaterThan(0);
  });

  it("thin evidence gives a thin prior", () => {
    const thin = new OpponentModel();
    thin.seed({ attackSite: { A: 0.6, B: 0.2 } });
    const thick = new OpponentModel();
    thick.seed({ attackSite: { A: 4.5, B: 1.5 } });
    expect(tendencyLean(thin.read().attackSite, "A")).toBeLessThan(tendencyLean(thick.read().attackSite, "A") / 2);
  });

  it("counterfactual: in-match evidence overturns a scouted habit the opponent has broken", () => {
    const m = new OpponentModel();
    m.seed({ attackSite: { A: 4.5, B: 1.5 } });
    expect(m.read().attackSite.probability.A).toBeGreaterThan(0.6);
    for (let i = 0; i < 4; i++) m.observeRound({ opponentSide: "attack", plantSite: "B" });
    expect(m.read().attackSite.probability.A).toBeLessThan(0.5);
  });

  it("a standing prior (a team's own conviction) does not fade, but can still be outweighed", () => {
    const fading = new OpponentModel();
    fading.seed({ attackSite: { A: 6 } });
    const standing = new OpponentModel();
    standing.seed({ attackSite: { A: 6 } }, { standing: true });
    for (let i = 0; i < 6; i++) {
      fading.observeRound({ opponentSide: "attack", plantSite: "B" });
      standing.observeRound({ opponentSide: "attack", plantSite: "B" });
    }
    expect(standing.read().attackSite.probability.A).toBeGreaterThan(fading.read().attackSite.probability.A);
    expect(standing.read().attackSite.probability.A).toBeLessThan((6 + 1) / (6 + 2)); // moved by the evidence
    expect(standing.read().attackSite.confidence).toBeLessThan(1);
  });

  it("junk counts are ignored", () => {
    const m = new OpponentModel();
    m.seed({ attackSite: { A: -3, B: Number.NaN } });
    expect(m.read().attackSite.samples).toBe(0);
  });
});
