import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld } from "./fixture.js";

const spatial = loadSpatial();

describe("team communication", () => {
  it("a teammate's sighting reaches the team only after the comms delay", () => {
    const seerPos = zonePos(spatial, "a-main");
    const enemyPos = zonePos(spatial, "a-site");
    const seer = mkPlayer({ id: "seer", teamId: "attackers", position: seerPos, facing: facingToward(seerPos, enemyPos) });
    // teammate who sees nothing (faces a wall, far from the enemy)
    const mate = mkPlayer({ id: "mate", teamId: "attackers", position: zonePos(spatial, "b-lobby"), facing: { x: 1, y: 0 } });
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
    const engine = new PerceptionEngine(spatial);

    // t0: report just made; comms delay (600ms default) not elapsed → mate has no report yet
    const r0 = engine.perceive(mkWorld([seer, mate, enemy], { timeRemainingMs: 60000 }));
    expect(r0.players.get("mate")!.teammateReports.length).toBe(0);

    // t1: 1000ms later (> 600ms delay) → the report has propagated to the mate
    const r1 = engine.perceive(mkWorld([seer, mate, enemy], { timeRemainingMs: 59000 }));
    const reports = r1.players.get("mate")!.teammateReports;
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0].fromPlayerId).toBe("seer");
    expect(reports[0].aboutEnemy).toBe("enemy");
  });

  it("builds a de-duplicated team enemy picture", () => {
    const seerPos = zonePos(spatial, "a-main");
    const enemyPos = zonePos(spatial, "a-site");
    const seer = mkPlayer({ id: "seer", teamId: "attackers", position: seerPos, facing: facingToward(seerPos, enemyPos) });
    const mate = mkPlayer({ id: "mate", teamId: "attackers", position: seerPos, facing: facingToward(seerPos, enemyPos) });
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
    const r = new PerceptionEngine(spatial).perceive(mkWorld([seer, mate, enemy]));
    const picture = r.teams.get("attackers")!.teamEnemyPicture;
    // both teammates see the same enemy → one de-duplicated entry
    expect(picture.filter((e) => e.playerId === "enemy").length).toBe(1);
  });
});
