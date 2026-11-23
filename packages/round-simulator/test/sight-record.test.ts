import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, toSimGameEvents } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(seed: number, recordTracks: boolean) {
  const s = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed, recordTracks },
  });
  return s.runRound(makeSyntheticRound(spatial));
}

describe("per-tick perception record (TrackFrame.sees, replay `sight` events)", () => {
  it("every duel starts on a tick where the record shows one of the two seeing the other", () => {
    let duels = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = run(seed, true);
      const byTick = new Map(r.tracks!.map((f) => [f.tick, f]));
      for (const e of r.events.filter((x) => x.kind === "engage")) {
        const f = byTick.get(e.tick)!;
        const a = f.players.find((p) => p.id === e.actor)!, b = f.players.find((p) => p.id === e.target)!;
        expect(a.sees!.includes(b.id) || b.sees!.includes(a.id)).toBe(true);
        duels++;
      }
      // only enemies are ever listed
      for (const f of r.tracks!) for (const p of f.players) for (const id of p.sees ?? []) expect(id.slice(0, 3)).not.toBe(p.id.slice(0, 3));
    }
    expect(duels).toBeGreaterThan(0);
  });

  it("is passive, and the replay's sight events rebuild the per-tick record", () => {
    const off = run(9, false);
    const on = run(9, true);
    expect(on.events).toEqual(off.events);
    const sight = toSimGameEvents(on, { includeMoves: true }).filter((e) => e.kind === "sight");
    expect(sight.length).toBeGreaterThan(0);
    const latest = new Map<string, string[]>();
    let i = 0;
    for (const f of on.tracks!) {
      while (i < sight.length && sight[i]!.timeMs <= f.elapsedMs) { latest.set(sight[i]!.playerId as string, sight[i]!.sees as string[]); i++; }
      for (const p of f.players) if (p.sees) expect(latest.get(p.id)).toEqual(p.sees);
    }
  });
});
