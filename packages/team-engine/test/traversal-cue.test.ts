// MS-09: a teleporter heard at its exit is one body on that side — evidence the defence weighs with
// the opponent's fake rate (hit-belief.ts). A team that fakes often is believed less.
import { describe, it, expect } from "vitest";
import { NO_EVIDENCE, updateHitBelief } from "../src/hit-belief.js";

describe("a teleporter cue as hit evidence (counterfactual)", () => {
  const belief = (runnersAtB: number, fakeRate: number) => updateHitBelief({
    sites: ["A", "B"], enemiesAlive: 5, fakeRate, fakeFeasibility: 1,
    evidence: { A: NO_EVIDENCE, B: { ...NO_EVIDENCE, runners: runnersAtB } },
  });
  it("a cue at the exit side raises P(hit) there over no cue, and P(show) more for a team that fakes often", () => {
    const none = belief(0, 0.2), cue = belief(1, 0.2);
    expect(cue.hit["B"]!).toBeGreaterThan(none.hit["B"]!);
    const faker = belief(1, 0.6);
    expect(faker.show["B"]!).toBeGreaterThan(cue.show["B"]!);
    // eslint-disable-next-line no-console
    console.log(`P(hit B): no cue ${none.hit["B"]!.toFixed(3)}, cue ${cue.hit["B"]!.toFixed(3)}; P(show B) fake rate 0.2 ${cue.show["B"]!.toFixed(3)}, 0.6 ${faker.show["B"]!.toFixed(3)}`);
  });
});
