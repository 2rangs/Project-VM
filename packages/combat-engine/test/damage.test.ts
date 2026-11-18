import { describe, it, expect } from "vitest";
import { damageForRange, applyDamage } from "../src/index.js";
import { weapon } from "./fixtures/weapons.js";

describe("damage model", () => {
  it("Operator body shot one-shots through every shield state", () => {
    const body = damageForRange(weapon("Operator"), 20, "body"); // 150
    expect(body).toBe(150);
    for (const [hp, armor] of [[100, 50], [100, 25], [100, 0]] as const) {
      const after = applyDamage({ health: hp, armor }, body);
      expect(after.health, `hp=${hp} armor=${armor}`).toBe(0);
    }
  });

  it("armor absorbs 1:1 then overflow hits health", () => {
    const after = applyDamage({ health: 100, armor: 25 }, 40);
    expect(after.armor).toBe(0);
    expect(after.health).toBe(85); // 40 - 25 absorbed = 15 to health
  });

  it("a rifle out-damages an SMG at long range (falloff)", () => {
    const vandal = damageForRange(weapon("Vandal"), 40, "body");
    const spectre = damageForRange(weapon("Spectre"), 40, "body");
    expect(vandal).toBeGreaterThan(spectre);
  });

  it("uses the last band beyond max range", () => {
    expect(damageForRange(weapon("Spectre"), 999, "body")).toBe(20);
  });
});
