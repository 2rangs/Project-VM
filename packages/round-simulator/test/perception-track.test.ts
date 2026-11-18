import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, toPv6ReplayFormat } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(recordPerception: boolean) {
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: "a-site" }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    config: { seed: 5, roundTimeMs: 30000, recordPerception },
  }).runRound(makeSyntheticRound(spatial));
}

describe("recordPerception (PV-6 fog-of-war / belief heatmap)", () => {
  it("is off by default: no perception track", () => {
    expect(run(false).perception).toBeUndefined();
  });

  it("records one PerceptionTrack per team, side-keyed, with ascending-time snapshots", () => {
    const r = run(true);
    expect(r.perception).toBeDefined();
    expect(r.perception).toHaveLength(2);
    const [atk, def] = r.perception!;
    expect(atk.teamIdx).toBe(0);
    expect(atk.side).toBe("attack");
    expect(def.teamIdx).toBe(1);
    expect(def.side).toBe("defense");
    expect(atk.snapshots.length).toBeGreaterThan(0);
    // snapshots are time-ordered
    for (let i = 1; i < atk.snapshots.length; i++) {
      expect(atk.snapshots[i].tMs).toBeGreaterThanOrEqual(atk.snapshots[i - 1].tMs);
    }
  });

  it("snapshots carry observation (never ground truth) + belief zones with p in [0,1]", () => {
    const r = run(true);
    const snaps = r.perception![0].snapshots;
    for (const s of snaps) {
      for (const e of s.observedEnemies) {
        expect(typeof e.zone).toBe("string");
        expect(e.lastSeenMsAgo).toBeGreaterThanOrEqual(0);
      }
      for (const z of s.beliefZones) {
        expect(z.p).toBeGreaterThanOrEqual(0);
        expect(z.p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic across runs with the same seed", () => {
    expect(run(true).perception).toEqual(run(true).perception);
  });

  it("toPv6ReplayFormat folds perception into meta for fromSimEventLog", () => {
    const r = run(true);
    const log = toPv6ReplayFormat(r, { mapId: "ascent", seed: 5 });
    expect(log.meta.perception).toBeDefined();
    expect(log.meta.perception).toHaveLength(2);
    // without recordPerception, meta.perception stays absent
    const log2 = toPv6ReplayFormat(run(false), { mapId: "ascent", seed: 5 });
    expect(log2.meta.perception).toBeUndefined();
  });
});
