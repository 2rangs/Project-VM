/**
 * The information layer (MatchConfig.informationLayer) at match level:
 *  - OFF (the default) is the calibrated engine, byte for byte: the round records hash to the same
 *    values the layer-off engine gives (re-recorded 2026-11-25 for the spike-drop fix and weaponModes default on);
 *  - ON, a round carries each team's information trace (per-player knowledge, every callout, minimap
 *    spots, trust, where the IGL placed each enemy) for Match Day, and the IGL decides on it.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { runMatch, type MatchConfig } from "../src/index.js";

const base: MatchConfig = { teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, map: "Ascent", seed: 5, maxRounds: 8 };
const hash = (c: MatchConfig): string => createHash("sha256").update(JSON.stringify(runMatch(c).rounds)).digest("hex");

/** sha256 of JSON.stringify(rounds) with the layer off (sen vs lev, Ascent, 8 rounds), after the spike-drop fix and weaponModes default on. */
const MAIN_SIGNATURE: Readonly<Record<number, string>> = {
  5: "1a72e1c5a0c7b4871e0a59fc0cfec5d5d9f5742ddc5a4c59702ed2fc3b92fc10",
  11: "af333b256bf9710029ce38eed3dbf746057f145175c9efadbd0658426d2eac61",
};

describe("information layer at match level", () => {
  it("off by default: the match is byte-identical to main (signature), and false is the default", () => {
    for (const [seed, sig] of Object.entries(MAIN_SIGNATURE)) {
      expect(hash({ ...base, seed: Number(seed) }), `seed ${seed}`).toBe(sig);
    }
    expect(hash({ ...base, informationLayer: false })).toBe(MAIN_SIGNATURE[5]);
    expect(runMatch({ ...base, maxRounds: 1 }).rounds[0]!.information).toBeUndefined();
  });

  it("one round, flag on vs off: on carries both teams' knowledge and callouts, and plays out on them", () => {
    const one = { ...base, maxRounds: 1 };
    const off = runMatch(one).rounds[0]!;
    const on = runMatch({ ...one, informationLayer: true }).rounds[0]!;
    expect(off.information).toBeUndefined();
    const info = on.information!;
    for (const slot of ["A", "B"] as const) {
      const t = info[slot]!;
      expect(t, slot).not.toBeNull();
      expect(t.igl.length).toBeGreaterThan(0);
      expect(Object.keys(t.knowledge).length).toBeGreaterThan(0);
      expect(t.comms.length).toBeGreaterThan(0);
      for (const c of t.comms) {
        expect(c.deliveredAtMs).toBeGreaterThanOrEqual(c.startedAtMs);
        expect(["exact", "wrongZone", "wrongCount", "partial"]).toContain(c.accuracy);
      }
      expect(t.placements).toBeDefined();
    }
    // the same seed is a different round once the team decides on what was called
    expect(JSON.stringify(on.events)).not.toBe(JSON.stringify(off.events));
    // deterministic with the layer on, too
    expect(JSON.stringify(runMatch({ ...one, informationLayer: true }).rounds[0]!.information)).toBe(JSON.stringify(info));
  });
});
