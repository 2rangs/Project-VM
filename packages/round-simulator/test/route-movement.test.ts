// Movement follows the map: recorded track positions lie on the edges' measured walkable
// polylines (or a zone's walkable anchor), move continuously, and are deterministic.
//
// The walkable grid itself is never committed (it reproduces map geometry). When it is
// available locally — PV_MAPS_DERIVED=<dir with ascent/walkable.json, written by
// tools/map-mesh/pipeline/route_map.py> — every track position is ALSO checked against it.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMatchRound, ScriptedPolicy, SYNTHETIC_DEFENSE_ANCHORS, type MatchRoundInput, type MatchRoundTeam, type TrackFrame } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();
const sq = spatialQuery(spatial);
const TICK_MS = 100;
const RUN_UNITS_PER_TICK = 675 * (TICK_MS / 1000);
/** Positions are compared to polylines in game uu (1 uu = 1 cm). */
const ON_ROUTE_TOLERANCE_UU = 1;

type P3 = { x: number; y: number; z: number };

function team(prefix: string, side: "attack" | "defense"): MatchRoundTeam {
  const anchors = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"];
  return {
    teamId: side === "attack" ? "attackers" : "defenders",
    players: Array.from({ length: 5 }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      agentId: "omen",
      spawnZoneId: side === "defense" ? anchors[i]! : "attacker-spawn",
      loadout: { weaponId: "Vandal", armor: 50, ultimatePoints: 0, ultimateCost: 7, abilities: [] },
    })),
    economy: { teamId: side === "attack" ? "attackers" : "defenders", side, credits: 3900, lossBonusTier: 0, consecutiveLosses: 0 },
  };
}

function round(seed: number, roundNumber: number): MatchRoundInput {
  return {
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: roundNumber % 2 === 0 ? "b-site" : "a-site" }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    attackers: team("atk", "attack"),
    defenders: team("def", "defense"),
    seed, mapId: "ascent", matchId: "routes", roundNumber,
    config: { recordTracks: true },
  };
}

/** A full regulation-length Ascent match: 24 rounds, attackers alternating A and B. */
function match(seed: number): ReadonlyArray<readonly TrackFrame[]> {
  return Array.from({ length: 24 }, (_, i) => runMatchRound(round(seed * 1000 + i, i + 1)).round.tracks!);
}

// every directed edge polyline of the map, as segments
const ids = spatial.zones.map((z) => z.id);
const segments: Array<[P3, P3]> = [];
for (const a of ids) for (const b of ids) {
  const t = a === b ? null : spatial.edgeTraversal(a, b);
  if (!t) continue;
  for (let i = 1; i < t.waypoints.length; i++) segments.push([t.waypoints[i - 1]!, t.waypoints[i]!]);
}
const stands = ids.map((id) => spatial.standPosition(id));

function distToSegment(p: P3, a: P3, b: P3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t), p.z - (a.z + ab.z * t));
}
const distToRoutes = (p: P3): number => {
  let best = Infinity;
  for (const s of stands) best = Math.min(best, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
  for (const [a, b] of segments) {
    if (best <= ON_ROUTE_TOLERANCE_UU) break;
    best = Math.min(best, distToSegment(p, a, b));
  }
  return best;
};

const tracks = match(1);
const frames = tracks.flat();

describe("movement follows the map's walkable routes (full Ascent match)", () => {
  it("every Ascent edge has a measured walkable route", () => {
    for (const a of ids) for (const b of ids) {
      const t = a === b ? null : spatial.edgeTraversal(a, b);
      if (t) expect(t.walkable, `${a} -> ${b}`).toBe(true);
    }
  });

  it("every recorded track position lies on an edge polyline or a zone's walkable anchor", () => {
    let checked = 0, worst = 0;
    const seen = new Set<string>();
    for (const f of frames) for (const p of f.players) {
      const key = `${p.x}|${p.y}|${p.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      worst = Math.max(worst, distToRoutes(p));
      checked++;
    }
    expect(worst).toBeLessThanOrEqual(ON_ROUTE_TOLERANCE_UU);
    expect(checked).toBeGreaterThan(500); // distinct points: players really are between zones, not only at centres
  });

  it("players move continuously: never further in one tick than a run step", () => {
    let moving = 0;
    for (const t of tracks) for (let i = 1; i < t.length; i++) {
      const prev = new Map(t[i - 1]!.players.map((p) => [p.id, p]));
      for (const p of t[i]!.players) {
        const q = prev.get(p.id)!;
        if (!p.alive || !q.alive) continue;
        const step = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        expect(step, `${p.id} @${t[i]!.elapsedMs}ms`).toBeLessThanOrEqual(RUN_UNITS_PER_TICK * 1.01 + 1);
        if (step > 0) moving++;
      }
    }
    expect(moving).toBeGreaterThan(2000);
  });

  it("routes bend around the geometry: tracks leave the straight line between zone centres", () => {
    // furthest any track point gets from EVERY straight centre-to-centre segment of the graph
    const straight: Array<[P3, P3]> = [];
    for (const a of ids) for (const b of ids) if (a < b && (spatial.edgeTraversal(a, b) || spatial.edgeTraversal(b, a))) {
      straight.push([spatial.getZone(a)!.position, spatial.getZone(b)!.position]);
    }
    let far = 0;
    for (const f of frames) for (const p of f.players) {
      let d = Infinity;
      for (const [a, b] of straight) d = Math.min(d, Math.hypot(...((): [number, number] => {
        const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
        const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        return [p.x - (a.x + abx * u), p.y - (a.y + aby * u)];
      })()));
      far = Math.max(far, d);
    }
    expect(far).toBeGreaterThan(300); // > 3 m off any straight edge: the old model could not do this
  });

  it("is deterministic: the same seed gives the same match, tick for tick", () => {
    expect(match(1)).toEqual(tracks);
    expect(match(2)).not.toEqual(tracks);
  });

  it("an edge takes its route's time, not the straight line's", () => {
    const t = spatial.edgeTraversal("a-site", "a-garden")!;
    const a = spatial.getZone("a-site")!.position, b = spatial.getZone("a-garden")!.position;
    const straightMs = (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 675) * 1000;
    expect(t.runTimeMs).toBeGreaterThan(straightMs * 1.2);
    expect(t.runTimeMs).toBeCloseTo((t.lengthUnits / 675) * 1000, -2);
  });

  const derived = process.env.PV_MAPS_DERIVED;
  const gridPath = derived ? resolve(derived, "ascent", "walkable.json") : "";
  it.skipIf(!gridPath || !existsSync(gridPath))("every track position stands on a walkable grid cell (local geometry only)", () => {
    const g = JSON.parse(readFileSync(gridPath, "utf8")) as { originGameMeters: [number, number]; cellMeters: number; nx: number; ny: number; bitsBase64: string };
    const bits = Buffer.from(g.bitsBase64, "base64");
    const walkable = (ix: number, iy: number): boolean => {
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return false;
      const k = ix * g.ny + iy;
      return ((bits[k >> 3]! >> (7 - (k & 7))) & 1) === 1;
    };
    let off = 0, total = 0;
    const seen = new Set<string>();
    for (const f of frames) for (const p of f.players) {
      const key = `${p.x}|${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      const ix = Math.floor((p.x / 100 - g.originGameMeters[0]) / g.cellMeters);
      const iy = Math.floor((p.y / 100 - g.originGameMeters[1]) / g.cellMeters);
      if (!walkable(ix, iy)) off++;
    }
    expect(off).toBe(0);
    expect(total).toBeGreaterThan(500);
  });
});
