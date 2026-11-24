// A1 / A7 counterfactuals at the duel level, with the simulator's own peek formulas (peek.ts) and
// the gaze duel model (combat-engine aimOffsetDeg, tracking, exposure window, physical stop time).
// Scene: a rifle attacker takes an angle on one rifle holder at 15 m whose crosshair is on the peek
// point. Nothing here is a bonus: each arm changes only lateral speed, offsets, pace and exposure.
import { describe, it, expect } from "vitest";
import { resolveDuel, AVERAGE_SKILLS, type Combatant, OPEN_POSTURE } from "@pv/combat-engine";
import { choosePeek, jiggleExposureMs, lateralSpeed } from "../src/peek.js";
import { loadWeapons } from "./fixtures/setup.js";

const weapons = loadWeapons();
const RUN = 675, WALK = 340, D = 15;
const N = 2000;

function fighter(id: string, posture: Partial<Combatant["posture"]>, reaction = 0.6): Combatant {
  return { id, teamId: id, health: 100, armor: 50, weapon: weapons["Vandal"]!, skills: { ...AVERAGE_SKILLS, reaction }, posture: { ...OPEN_POSTURE, ...posture } };
}

/** Dry swing: unknown spot, crosshair 20° off it; strafing at run speed across the holder's line. */
function drySwing(seed: number, holderReaction: number): boolean {
  const atk = fighter("atk", { moving: true, pace: "run", aimOffsetDeg: 20, lateralSpeedMps: RUN / 100 });
  const def = fighter("def", { aimOffsetDeg: 0 }, holderReaction);
  return resolveDuel({ a: atk, b: def, distanceMeters: D }, seed).winner === "atk";
}

/** Jiggle, then (if it got out) a pre-aimed swing: the holder's crosshair is on the spot too. */
function jiggleThenSwing(seed: number, holderReaction: number): { win: boolean; holderShotFirst: boolean } {
  const exp = jiggleExposureMs(RUN);
  const j = resolveDuel({
    a: fighter("atk", { moving: true, pace: "run", aimOffsetDeg: 20, lateralSpeedMps: RUN / 100, exposedUntilMs: exp }),
    b: fighter("def", { aimOffsetDeg: 0 }, holderReaction), distanceMeters: D,
  }, seed);
  const holderShotFirst = j.events.find((e) => e.kind === "shot")?.actor === "def";
  if (j.winner) return { win: j.winner === "atk", holderShotFirst };
  const o = j.outcomes;
  const r = resolveDuel({
    a: { ...fighter("atk", { moving: true, pace: "run", aimOffsetDeg: 0, lateralSpeedMps: RUN / 100 }), health: o["atk"]!.health, armor: o["atk"]!.armor },
    b: { ...fighter("def", { aimOffsetDeg: 0 }, holderReaction), health: o["def"]!.health, armor: o["def"]!.armor }, distanceMeters: D,
  }, seed + 7919);
  return { win: r.winner === "atk", holderShotFirst };
}

const rate = (f: (s: number) => boolean) => { let k = 0; for (let s = 1; s <= N; s++) if (f(s)) k++; return k / N; };

describe("jiggle vs dry swing (A1 PK-03 counterfactual)", () => {
  it("the jiggle arm wins more, and the gap shrinks as the holder's reaction rises", () => {
    const gap = (rx: number) => {
      const dry = rate((s) => drySwing(s, rx));
      const jig = rate((s) => jiggleThenSwing(s, rx).win);
      // eslint-disable-next-line no-console
      console.log(`holder reaction ${rx}: dry swing ${dry.toFixed(3)}, jiggle→swing ${jig.toFixed(3)}`);
      return jig - dry;
    };
    const slow = gap(0.2), fast = gap(1.0);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeLessThan(slow);
  });

  it("a jiggle exposure is two body widths of strafe, out and back: ~207 ms at run speed", () => {
    expect(jiggleExposureMs(RUN)).toBeCloseTo((2 * 70 / RUN) * 1000, 6);
    expect(jiggleExposureMs(WALK)).toBeGreaterThan(jiggleExposureMs(RUN));
  });
});

describe("slicing vs a straight run-in (A7 PK-09 counterfactual)", () => {
  it("slicing (walk, crosshair on the sliver) wins more duels than running in with the crosshair elsewhere; it takes longer", () => {
    const run = rate((s) => resolveDuel({ a: fighter("atk", { moving: true, pace: "run", aimOffsetDeg: 20, lateralSpeedMps: RUN / 100 }), b: fighter("def", { aimOffsetDeg: 0 }), distanceMeters: D }, s).winner === "atk");
    const slice = rate((s) => resolveDuel({ a: fighter("atk", { moving: true, pace: "walk", aimOffsetDeg: 0, lateralSpeedMps: WALK / 100 }), b: fighter("def", { aimOffsetDeg: 0 }), distanceMeters: D }, s).winner === "atk");
    // eslint-disable-next-line no-console
    console.log(`run-in ${run.toFixed(3)}, slice ${slice.toFixed(3)}; time to cover 5 m: run ${(500 / RUN).toFixed(2)} s, walk ${(500 / WALK).toFixed(2)} s`);
    expect(slice).toBeGreaterThan(run);
  });
});

describe("peek decision (peek.ts)", () => {
  const base = { knows: false, expected: true, walking: false, slackMs: 60000, jiggleCostMs: 400, gameSense: 0.6, u: 0.5 };
  it("knows → swing; not expected → walk-in; expected, unknown: jiggle by gameSense if the clock allows, else slice (walking) / swing", () => {
    expect(choosePeek({ ...base, knows: true })).toBe("swing");
    expect(choosePeek({ ...base, expected: false })).toBe("walkIn");
    expect(choosePeek({ ...base, u: 0.1 })).toBe("jiggle");
    expect(choosePeek({ ...base, u: 0.9, walking: true })).toBe("slice");
    expect(choosePeek({ ...base, u: 0.9 })).toBe("swing");
    expect(choosePeek({ ...base, u: 0.1, slackMs: 100 })).toBe("swing");
  });
  it("lateral speed is the component across the line of sight", () => {
    expect(lateralSpeed({ x: 0, y: 0 }, { x: 0, y: 67.5 }, { x: 1000, y: 67.5 }, 100)).toBeCloseTo(675, 6);
    expect(lateralSpeed({ x: 0, y: 0 }, { x: 67.5, y: 0 }, { x: 1000, y: 0 }, 100)).toBeCloseTo(0, 6);
  });
});
