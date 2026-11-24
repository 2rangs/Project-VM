// MS-09: an authored link (Bind teleporter) is heard at both ends — entering, then leaving.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine } from "@pv/spatial-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { DEFAULT_PARAMS as PERCEPTION, traversalSound } from "@pv/perception-engine";
import { MovementExecutor } from "../src/mover.js";
import type { SimPlayer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../../datasets/spatial/bind");
const j = (f: string) => JSON.parse(readFileSync(resolve(dir, f), "utf8"));
const cs = JSON.parse(readFileSync(resolve(here, "../../../datasets/spatial/ascent/coordinate-system.json"), "utf8"));
const roadmap = j("bind.nav.json") as { links: Array<{ from: number; to: number; kind: string; travelTimeMs: number }> };
const spatial = createEngine(j("bind.navgraph.json"), (j("coordinate-system.json") ?? cs).transform, roadmap, j("bind.vis.json"));
const objects = j("bind.objects.json") as { traversals: Array<{ fromNode: number; toNode: number; soundSource: { x: number; y: number; z: number }; soundSourceExit: { x: number; y: number; z: number } }> };

describe("teleporter sounds (mover hook, sound detail)", () => {
  it("a Bind teleporter traversal reports two sounds, at the entry and at the exit, one link time apart", () => {
    const nav = spatial.nav!;
    const link = roadmap.links.find((l) => l.kind === "teleporter")!;
    const pa = nav.nodePosition(link.from), pb = nav.nodePosition(link.to);
    const za = nav.zoneAt(pa)!, zb = nav.zoneAt(pb)!;
    const p: SimPlayer = {
      id: "p", teamId: "t", side: "attack", agentId: "a", position: { ...pa }, zoneId: za, facing: { x: 1, y: 0 },
      health: 100, armor: 0, alive: true, weaponId: "Vandal", skills: AVERAGE_SKILLS, abilities: [],
      ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
    };
    const mover = new MovementExecutor(spatial, { runUnitsPerSec: 675, walkUnitsPerSec: 340 });
    mover.reset([p]);
    p.position = { ...pa };
    const heard: Array<{ end: string; via: string; at: { x: number; y: number; z: number }; t: number }> = [];
    let t = 0;
    const hooks = { onTraverse: (_p: SimPlayer, via: string, end: "enter" | "exit", at: { x: number; y: number; z: number }) => heard.push({ via, end, at, t }) };
    expect(mover.setGoal(p, { zoneId: zb, mode: "run" }, hooks)).toBe("SUCCESS");
    for (; t < 20000 && mover.isMoving(p); t += 100) mover.step(p, 100, [p], hooks);
    expect(heard.map((h) => `${h.via}:${h.end}`)).toEqual(["teleporter:enter", "teleporter:exit"]);
    // the two ends match the map data's sound sources (objects.json) within a few metres
    const obj = objects.traversals.find((o) => o.fromNode === link.from && o.toNode === link.to)!;
    const d = (u: { x: number; y: number }, v: { x: number; y: number }) => Math.hypot(u.x - v.x, u.y - v.y);
    expect(d(heard[0]!.at, obj.soundSource)).toBeLessThan(300);
    expect(d(heard[1]!.at, obj.soundSourceExit)).toBeLessThan(300);
    expect(heard[1]!.t - heard[0]!.t).toBeGreaterThanOrEqual(link.travelTimeMs - 100);
    // and it is louder than a step: it carries further
    expect(traversalSound("teleporter", PERCEPTION).radiusUnits).toBeGreaterThan(PERCEPTION.hearing.footstepRadiusUnits);
  });
});
