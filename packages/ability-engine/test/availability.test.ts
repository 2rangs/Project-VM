import { describe, it, expect } from "vitest";
import { buildAbilityCatalog, checkAvailability, type AbilitySpec } from "../src/index.js";
import { ability } from "./fixtures/abilities.js";

const base = ability("omen:Ability2");
const withCooldown: AbilitySpec = { ...base, abilityId: "cd:Ability1", cooldownMs: 5000 };
const catalog = buildAbilityCatalog([ability("omen:Ability2"), ability("sova:Ultimate"), withCooldown]);

describe("availability (Constraint Validation for PV-3)", () => {
  it("ok when charges remain and no cooldown", () => {
    expect(checkAvailability(catalog, { abilityId: "omen:Ability2", chargesRemaining: 1, lastUsedAtMs: null }, 0)).toEqual({ usable: true, reason: "ok" });
  });

  it("no-charges when depleted", () => {
    const r = checkAvailability(catalog, { abilityId: "omen:Ability2", chargesRemaining: 0, lastUsedAtMs: null }, 0);
    expect(r.usable).toBe(false);
    expect(r.reason).toBe("no-charges");
  });

  it("on-cooldown within the cooldown window, usable after it", () => {
    const during = checkAvailability(catalog, { abilityId: "cd:Ability1", chargesRemaining: 1, lastUsedAtMs: 1000 }, 3000);
    expect(during.reason).toBe("on-cooldown");
    expect(during.cooldownRemainingMs).toBe(3000); // 5000 - (3000-1000)
    const after = checkAvailability(catalog, { abilityId: "cd:Ability1", chargesRemaining: 1, lastUsedAtMs: 1000 }, 6500);
    expect(after.usable).toBe(true);
  });

  it("ultimate requires enough points", () => {
    const notReady = checkAvailability(catalog, { abilityId: "sova:Ultimate", chargesRemaining: 0, lastUsedAtMs: null }, 0, { points: 5, required: 7 });
    expect(notReady.reason).toBe("ult-not-ready");
    const ready = checkAvailability(catalog, { abilityId: "sova:Ultimate", chargesRemaining: 0, lastUsedAtMs: null }, 0, { points: 7, required: 7 });
    expect(ready.usable).toBe(true);
  });

  it("unknown ability is rejected", () => {
    expect(checkAvailability(catalog, { abilityId: "nope:Ability1", chargesRemaining: 9, lastUsedAtMs: null }, 0).reason).toBe("unknown-ability");
  });
});
