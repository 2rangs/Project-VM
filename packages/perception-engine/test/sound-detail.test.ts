import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, hearSounds, isMasked, landingSound, type SoundSource } from "../src/index.js";
import { loadSpatial, zonePos } from "./fixture.js";

const spatial = loadSpatial();
const P = DEFAULT_PARAMS;
const H0 = P.hearing.landing.silentBelowUnits;

describe("landing off a drop", () => {
  it("is silent below the threshold; above it the reach grows as √(h/h₀) and the level by 10·log10(h/h₀)", () => {
    expect(landingSound(H0 - 1, P)).toBeNull();
    const at = landingSound(H0, P)!, four = landingSound(4 * H0, P)!;
    expect(at.radiusUnits).toBeCloseTo(P.hearing.footstepRadiusUnits, 6);
    expect(four.radiusUnits).toBeCloseTo(2 * P.hearing.footstepRadiusUnits, 6);
    expect(four.levelDb - at.levelDb).toBeCloseTo(10 * Math.log10(4), 6);
  });

  it("an unmasked landing inside its reach is heard by the enemy (kind 'landing'), not by its own team", () => {
    const pos = zonePos(spatial, "a-main");
    const listener = { ...pos, x: pos.x + 800 };
    const snd = landingSound(2 * H0, P)!;
    const src: SoundSource = { kind: "landing", position: pos, loudness: 0.8, teamId: "attackers", radiusUnits: snd.radiusUnits, levelDb: snd.levelDb };
    expect(hearSounds(listener, [src], spatial, P, 0, "defenders").map((o) => o.kind)).toEqual(["landing"]);
    expect(hearSounds(listener, [src], spatial, P, 0, "attackers")).toHaveLength(0);
  });
});

describe("masking (signal detection, inverse-square levels)", () => {
  const listener = { x: 0, y: 0, z: 0 };
  const step = { position: { x: 1000, y: 0, z: 0 }, levelDb: P.hearing.masking.footstepDb };
  it("a footstep is masked by a rifle shot near the listener, not by one far beyond the step", () => {
    expect(isMasked(listener, step, [{ position: { x: 500, y: 0, z: 0 }, levelDb: P.hearing.masking.gunfireDb }], P)).toBe(true);
    expect(isMasked(listener, step, [{ position: { x: 100000, y: 0, z: 0 }, levelDb: P.hearing.masking.gunfireDb }], P)).toBe(false);
    expect(isMasked(listener, step, [], P)).toBe(false);
  });

  it("a masked footstep is not heard; the same footstep with no gunfire is", () => {
    const src: SoundSource = { kind: "footstep", position: step.position, loudness: 0.8, teamId: "attackers" };
    expect(hearSounds(listener, [src], spatial, P, 0, "defenders")).toHaveLength(1);
    expect(hearSounds(listener, [src], spatial, P, 0, "defenders", [{ position: { x: 300, y: 0, z: 0 }, levelDb: P.hearing.masking.gunfireDb }])).toHaveLength(0);
  });

  it("a louder landing survives a masker that hides a plain step at the same spot", () => {
    const masker = [{ position: { x: 3000, y: 0, z: 0 }, levelDb: P.hearing.masking.gunfireDb }];
    const loud = landingSound(16 * H0, P)!;
    expect(isMasked(listener, step, masker, P)).toBe(true);
    expect(isMasked(listener, { position: step.position, levelDb: loud.levelDb }, masker, P)).toBe(false);
  });
});
