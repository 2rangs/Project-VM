import { describe, it, expect } from "vitest";
import { AbilityEngine } from "../src/index.js";
import { abilitySpecFromCatalog } from "../src/catalog-adapter.js";
import { loadSpatial, zonePos } from "./fixtures/abilities.js";

const spatial = loadSpatial();

// KAY/O-style suppress (NULL/cmd): silences enemy abilities for a duration.
const suppressSpec = abilitySpecFromCatalog(
  { abilityId: "kayo:Ultimate", slot: "Ultimate", name: "NULL/cmd", effectTypes: ["suppress"], params: { radiusMeters: 20, durationMs: 8000, makesSound: true } },
  { cost: null, charges: 1, ultPoints: 8 },
);

describe("suppress (ability-silence)", () => {
  it("derives suppressDurationMs from the catalog duration", () => {
    expect(suppressSpec.suppressDurationMs).toBe(8000);
  });

  it("silences affected enemies for the duration, then clears on advance", () => {
    const eng = new AbilityEngine(spatial);
    const origin = zonePos(spatial, "a-site");
    eng.use(suppressSpec, { instanceId: "s1", abilityId: "kayo:Ultimate", ownerId: "atk", teamId: "attackers", origin, startedAtMs: 1000 },
      { affectedPlayerIds: ["def1", "def2"] });

    // suppressed during the window
    expect(eng.suppressRemainingMs("def1", 1000)).toBe(8000);
    expect(eng.suppressRemainingMs("def2", 5000)).toBe(4000);
    // an unaffected player is never suppressed
    expect(eng.suppressRemainingMs("atk", 1000)).toBe(0);

    // a suppressApplied event is emitted per affected player
    expect(eng.events.filter((e) => e.kind === "suppressApplied").map((e) => e.targetId).sort()).toEqual(["def1", "def2"]);

    // expires
    eng.advance(9000);
    expect(eng.suppressRemainingMs("def1", 9000)).toBe(0);
  });

  it("a non-suppress ability leaves suppressRemainingMs at 0", () => {
    const eng = new AbilityEngine(spatial);
    const smoke = abilitySpecFromCatalog(
      { abilityId: "omen:Ability2", slot: "Ability2", name: "Dark Cover", effectTypes: ["smoke"], params: { radiusMeters: 5, durationMs: 15000, blocksVision: true } },
      { charges: 1 },
    );
    expect(smoke.suppressDurationMs).toBeNull();
    eng.use(smoke, { instanceId: "k1", abilityId: "omen:Ability2", ownerId: "atk", teamId: "attackers", origin: zonePos(spatial, "a-site"), startedAtMs: 0 }, { affectedPlayerIds: ["def1"] });
    expect(eng.suppressRemainingMs("def1", 0)).toBe(0);
  });
});
