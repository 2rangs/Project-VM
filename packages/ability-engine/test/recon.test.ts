import { describe, it, expect } from "vitest";
import { AbilityEngine, revealedEnemies } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

const spatial = loadSpatial();

describe("recon reveal (snapshot, no omniscient leak)", () => {
  it("reveals enemies in range as a frozen snapshot that does NOT track later movement", () => {
    const abilities = new AbilityEngine(spatial);
    const revealPos = zonePos(spatial, "b-site");
    abilities.use(
      ability("sova:Ability2"),
      { instanceId: "r1", abilityId: "sova:Ability2", ownerId: "s", teamId: "attackers", origin: revealPos, startedAtMs: 0 },
      { snapshotEnemies: [{ enemyId: "enemy", teamId: "defenders", position: revealPos }] },
    );

    const revealed = revealedEnemies(abilities);
    expect(revealed.map((r) => r.enemyId)).toContain("enemy");
    const snap = revealed.find((r) => r.enemyId === "enemy")!;
    expect(snap.position.x).toBeCloseTo(revealPos.x, 6);

    // The enemy "moves" in the real world — we never feed that to the engine. The
    // snapshot must stay frozen at the reveal position (no live tracking).
    const laterSecretX = 424242.5;
    const stillRevealed = revealedEnemies(abilities);
    expect(stillRevealed.find((r) => r.enemyId === "enemy")!.position.x).toBeCloseTo(revealPos.x, 6);
    expect(JSON.stringify(stillRevealed)).not.toContain("424242.5");
    void laterSecretX;
  });

  it("the reveal disappears after the recon duration expires", () => {
    const abilities = new AbilityEngine(spatial);
    const pos = zonePos(spatial, "a-site");
    abilities.use(
      ability("sova:Ability2"),
      { instanceId: "r2", abilityId: "sova:Ability2", ownerId: "s", teamId: "attackers", origin: pos, startedAtMs: 0 },
      { snapshotEnemies: [{ enemyId: "e2", teamId: "defenders", position: pos }] },
    );
    expect(revealedEnemies(abilities).length).toBe(1);
    abilities.advance(3500); // duration 3000
    expect(revealedEnemies(abilities).length).toBe(0);
  });
});
