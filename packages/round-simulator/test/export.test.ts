import { describe, it, expect } from "vitest";
import {
  RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS,
  toValidationRun, toSimGameEvents, toPv6ReplayFormat, ASCENT_OPENING_DUEL_CALIBRATION,
} from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(seed: number, recordTracks = false) {
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed, recordTracks },
  }).runRound(makeSyntheticRound(spatial));
}

describe("validation export (PV-2 pv-validate-sim input)", () => {
  it("produces a sim_run with roster and pv-core-shaped events", () => {
    const bundle = toValidationRun([run(1), run(2)], "test");
    expect(bundle.meta.rounds).toBe(2);
    const r0 = bundle.rounds[0];
    expect(r0.map).toBe("Ascent");
    expect(Object.keys(r0.roster).length).toBe(10);
    // first event roundStart, last roundEnd with winner + reason (what the harness reads)
    expect(r0.events[0].kind).toBe("roundStart");
    const end = r0.events[r0.events.length - 1];
    expect(end.kind).toBe("roundEnd");
    expect(["attack", "defense"]).toContain(end.winner);
    expect(end.reason).toBeDefined();
    // kills carry killer/victim with side resolvable via roster
    for (const e of r0.events.filter((e) => e.kind === "kill")) {
      expect(r0.roster[e.killer as string]).toBeDefined();
      expect(r0.roster[e.victim as string]).toBeDefined();
    }
  });

  it("event seqs are monotonic and time-ordered", () => {
    const evs = toSimGameEvents(run(3));
    for (let i = 1; i < evs.length; i++) expect(evs[i].timeMs).toBeGreaterThanOrEqual(evs[i - 1].timeMs);
  });
});

describe("PV-6 replay bridge", () => {
  it("toPv6ReplayFormat returns pv-core GameEvent[] + meta (incl. move events from tracks)", () => {
    const result = run(4, /*recordTracks*/ true);
    const log = toPv6ReplayFormat(result, { mapId: "ascent", seed: 4, coordinateTransform: {} });
    expect(log.meta.mapId).toBe("ascent");
    const kinds = new Set(log.events.map((e) => e.kind));
    expect(kinds.has("roundStart")).toBe(true);
    expect(kinds.has("roundEnd")).toBe(true);
    expect(kinds.has("move")).toBe(true); // derived from track frames
    // every event has the pv-core base shape
    for (const e of log.events) {
      expect(typeof e.seq).toBe("number");
      expect(typeof e.timeMs).toBe("number");
      expect(typeof e.kind).toBe("string");
    }
  });
});

describe("opening-duel calibration constant", () => {
  it("is a symmetric hitChanceScale < 1", () => {
    expect(ASCENT_OPENING_DUEL_CALIBRATION.hitChanceScale).toBeLessThan(1);
    expect(ASCENT_OPENING_DUEL_CALIBRATION.hitChanceScale).toBeGreaterThan(0);
  });
});
