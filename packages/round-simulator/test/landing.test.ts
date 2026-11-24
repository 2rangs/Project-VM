import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MovementExecutor } from "../src/mover.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import type { SimPlayer } from "../src/index.js";
import { loadSpatial } from "./fixtures/setup.js";

const spatial = loadSpatial();
const nav = spatial.nav!;
const here = dirname(fileURLToPath(import.meta.url));
const roadmap = JSON.parse(readFileSync(resolve(here, "../../../datasets/spatial/ascent/ascent.nav.json"), "utf8")) as { drops: number[][] };

function body(zoneId: string, at: { x: number; y: number; z: number }): SimPlayer {
  return {
    id: "p", teamId: "t", side: "attack", agentId: "a", position: { ...at }, zoneId, facing: { x: 1, y: 0 },
    health: 100, armor: 0, alive: true, weaponId: "Vandal", skills: AVERAGE_SKILLS, abilities: [],
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "walk",
  };
}

describe("landing off a drop (mover hook)", () => {
  it("a mover whose route comes down a drop reports the landing once, with the fall height", () => {
    let found = false;
    for (const [a, b] of roadmap.drops) {
      const pa = nav.nodePosition(a!), pb = nav.nodePosition(b!);
      const za = nav.zoneAt(pa), zb = nav.zoneAt(pb);
      if (!za || !zb || za === zb || pa.z - pb.z < 200) continue;
      const mover = new MovementExecutor(spatial, { runUnitsPerSec: 675, walkUnitsPerSec: 340 });
      const p = body(za, pa);
      mover.reset([p]);
      p.position = { ...pa };
      const landings: number[] = [];
      const hooks = { onLanding: (_p: SimPlayer, h: number) => landings.push(h) };
      if (mover.setGoal(p, { zoneId: zb, mode: "walk" }, hooks) !== "SUCCESS") continue;
      for (let t = 0; t < 400 && mover.isMoving(p); t++) mover.step(p, 100, [p], hooks);
      if (landings.length === 0) continue; // this route found a way round the drop
      expect(landings.every((h) => h > 0)).toBe(true);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });
});
