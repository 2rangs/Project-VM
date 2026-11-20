// Movement on the real map (Phase 6 tests at the simulator level: G–L, M, N, O; A–F live in
// packages/spatial-engine/test/navigation.test.ts, P in perf.test.ts).
//
// Players have continuous positions on the map's navigation roadmap. Nothing here may ever
// show a straight line through a wall, a jump, or a player moved by anything but the executor.
//
// "Local geometry only" checks need the walk grid, which is never committed:
//   PV_MAPS_DERIVED=<dir with ascent/walkable.json> npx vitest run
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RoundSimulator, runMatchRound, ScriptedPolicy, SYNTHETIC_DEFENSE_ANCHORS,
  type ActionCommand, type MatchRoundInput, type MatchRoundTeam, type MovementBlocker, type RoundResult, type SimState, type TrackFrame,
} from "../src/index.js";
import { NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";
import { player, scene, scripted, spatial, weapons } from "./fixtures/ability-scenes.js";

const nav = spatial.nav!;
const sq = spatialQuery(spatial);
const TICK_MS = 100;
const RUN_STEP = 675 * (TICK_MS / 1000);
type P3 = { x: number; y: number; z: number };
const dist = (a: P3, b: P3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

type Rule = (id: string, timeRemainingMs: number) => Omit<ActionCommand, "playerId"> | undefined;
/** One attacker (or several) acting on a rule; a defender far away at its spawn so nobody meets. */
function walk(starts: Record<string, string>, rule: Rule, opts: { clockMs?: number; blockers?: MovementBlocker[]; seed?: number; record?: boolean } = {}): { result: RoundResult; state: SimState } {
  const clockMs = opts.clockMs ?? 60_000;
  const base = scene([...Object.entries(starts).map(([id, zone]) => player(id, "attack", zone)), player("far", "defense", "defender-spawn")], clockMs, null);
  const state: SimState = opts.blockers ? { ...base, movementBlockers: opts.blockers } : base;
  const result = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: scripted((p, v) => rule(p.id, v.timeRemainingMs)), defense: scripted(() => undefined) },
    config: { seed: opts.seed ?? 1, roundTimeMs: clockMs, traceCommands: true, recordTracks: opts.record ?? true },
  }).runRound(state);
  return { result, state };
}
const track = (r: RoundResult, id: string): P3[] => r.tracks!.map((f) => f.players.find((p) => p.id === id)!);
const hops = (r: RoundResult, id: string): string[] => (r.commandTrace ?? []).filter((c) => c.playerId === id && c.phase === "move" && c.toZone).map((c) => c.toZone!);
const arrivedAt = (r: RoundResult, id: string): number | null => (r.commandTrace ?? []).find((c) => c.playerId === id && c.phase === "arrived")?.elapsedMs ?? null;
/** Every position is on walkable floor as the roadmap knows it (inside a node's clearance or an edge's corridor). */
const offFloor = (pts: readonly P3[]): number => pts.reduce((worst, p) => Math.max(worst, nav.distanceToWalkable(p)), 0);
const maxStep = (pts: readonly P3[]): number => pts.slice(1).reduce((m, p, i) => Math.max(m, dist(p, pts[i]!)), 0);

describe("local movement execution", () => {
  it("a move is a continuous walk along the floor: no jump, no wall, and it ends on a standing spot", () => {
    const { result, state } = walk({ mov: "a-main" }, () => ({ kind: "move", targetZone: "a-site", moveMode: "run" }));
    const t = track(result, "mov");
    const end = state.players.find((p) => p.id === "mov")!;
    expect(maxStep(t)).toBeLessThanOrEqual(RUN_STEP + 0.5);
    expect(offFloor(t)).toBeLessThanOrEqual(1);
    expect(end.zoneId).toBe("a-site");
    expect(nav.locate(end.position)).not.toBeNull();
    expect(nav.nodeZone(nav.locate(end.position)!)).toBe("a-site");
    expect(arrivedAt(result, "mov")).not.toBeNull();
    // it really walked: many distinct positions, and it was never set down on the zone's callout
    expect(new Set(t.map((p) => `${p.x.toFixed(1)}|${p.y.toFixed(1)}`)).size).toBeGreaterThan(20);
  });

  it("walking is slower than running, along the same floor", () => {
    const run = walk({ mov: "a-main" }, () => ({ kind: "move", targetZone: "a-site", moveMode: "run" }));
    const slow = walk({ mov: "a-main" }, () => ({ kind: "move", targetZone: "a-site", moveMode: "walk" }));
    expect(arrivedAt(slow.result, "mov")! / arrivedAt(run.result, "mov")!).toBeGreaterThan(1.8);
    expect(maxStep(track(slow.result, "mov"))).toBeLessThanOrEqual(34 + 0.5);
  });

  it("K — a rotation takes the real path's time, not the straight line's", () => {
    const { result, state } = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }));
    const plan = result.navTrace!.find((e) => e.playerId === "mov" && e.kind === "planned")!;
    const t = arrivedAt(result, "mov")!;
    const start = track(result, "mov")[0]!, end = state.players.find((p) => p.id === "mov")!.position;
    expect(t).toBeGreaterThan((dist(start, end) / 675) * 1000 * 1.3); // the straight line would be far quicker
    expect(Math.abs(t - plan.estimatedTravelMs!)).toBeLessThanOrEqual(300); // it arrives when the plan said
    expect(t / nav.zoneTravelMs("a-site", "b-site")!).toBeGreaterThan(0.85);
    expect(t / nav.zoneTravelMs("a-site", "b-site")!).toBeLessThan(1.2);
  });

  it("teammates do not stack: own standing spots, own lanes, different tracks for the same order", () => {
    const five = { a1: "attacker-spawn", a2: "attacker-spawn", a3: "attacker-spawn", a4: "attacker-spawn", a5: "attacker-spawn" };
    const { result, state } = walk(five, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }));
    const ids = Object.keys(five);
    const first = result.tracks![0]!, last = result.tracks![result.tracks!.length - 1]!;
    for (const f of [first, last]) for (const a of ids) for (const b of ids) {
      if (a < b) expect(dist(f.players.find((p) => p.id === a)!, f.players.find((p) => p.id === b)!), `${a}/${b} @${f.elapsedMs}`).toBeGreaterThan(150);
    }
    for (const id of ids) expect(state.players.find((p) => p.id === id)!.zoneId).toBe("b-site");
    // same order, same start zone — but not the same line
    const key = (id: string): string => track(result, id).map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(";");
    expect(new Set(ids.map(key)).size).toBe(5);
    // nobody walks through the zone's callout point unless that is its own spot
    const callout = spatial.getZone("b-site")!.position;
    const through = ids.filter((id) => track(result, id).some((p) => Math.hypot(p.x - callout.x, p.y - callout.y) < 5));
    expect(through.length).toBeLessThanOrEqual(1);
  });

  it("a new order mid-path is taken from where the player is", () => {
    const { result, state } = walk({ mov: "attacker-spawn" }, (_, left) => ({ kind: "move", targetZone: left > 52_000 ? "a-site" : "b-site", moveMode: "run" }));
    const t = track(result, "mov");
    expect(maxStep(t)).toBeLessThanOrEqual(RUN_STEP + 0.5);
    expect(offFloor(t)).toBeLessThanOrEqual(1);
    expect(state.players.find((p) => p.id === "mov")!.zoneId).toBe("b-site");
    expect(result.navTrace!.filter((e) => e.playerId === "mov" && e.kind === "planned").map((e) => e.goalZone)).toEqual(["a-site", "b-site"]);
  });
});

describe("failure is reported, never papered over", () => {
  const sealB: MovementBlocker[] = ["b-main", "mid-market", "mid-link", "defender-spawn", "b-boathouse"].map((z) => ({ id: `seal:${z}`, zoneId: z, fromMs: 0, untilMs: 1e9 }));

  it("J — an unreachable goal leaves the player where it is: no teleport, no straight line", () => {
    const { result, state } = walk({ mov: "attacker-spawn" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }), { clockMs: 15_000, blockers: sealB });
    const t = track(result, "mov");
    expect(maxStep(t)).toBe(0);
    expect(state.players.find((p) => p.id === "mov")!.zoneId).toBe("attacker-spawn");
    const failed = result.navTrace!.filter((e) => e.playerId === "mov" && (e.kind === "blocked" || e.kind === "unreachable"));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.reason).toMatch(/UNREACHABLE/);
    expect(result.commandTrace!.some((c) => c.playerId === "mov" && c.result === "blocked")).toBe(true);
    expect(arrivedAt(result, "mov")).toBeNull();
  });

  it("G — a blocker that appears mid-move makes the mover revalidate and re-plan around it", () => {
    const free = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }));
    expect(hops(free.result, "mov")).toContain("mid-bottom");
    // 3 s in, a wall seals Mid Bottom for the rest of the round
    const wall: MovementBlocker[] = [{ id: "wall", zoneId: "mid-bottom", fromMs: 3000, untilMs: 1e9 }];
    const { result, state } = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }), { blockers: wall });
    const t = track(result, "mov");
    expect(result.navTrace!.some((e) => e.playerId === "mov" && e.kind === "replanned" && e.elapsedMs >= 3000)).toBe(true);
    expect(hops(result, "mov").slice(hops(result, "mov").length - 6)).not.toContain("mid-bottom");
    expect(state.players.find((p) => p.id === "mov")!.zoneId).toBe("b-site");
    expect(arrivedAt(result, "mov")!).toBeGreaterThan(arrivedAt(free.result, "mov")!);
    expect(maxStep(t)).toBeLessThanOrEqual(RUN_STEP + 0.5);
    expect(offFloor(t)).toBeLessThanOrEqual(1);
    // after the wall is up nobody stands on Mid Bottom's floor
    for (const f of result.tracks!) if (f.elapsedMs > 3500) expect(nav.zoneAt(f.players.find((p) => p.id === "mov")!)).not.toBe("mid-bottom");
  });

  it("G / H — every way sealed: the mover stops and reports; when the blockers go, the route is usable again", () => {
    const timed = sealB.map((b) => ({ ...b, fromMs: 2000, untilMs: 12_000 }));
    const { result, state } = walk({ mov: "attacker-spawn" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }), { clockMs: 60_000, blockers: timed });
    const t = track(result, "mov");
    const events = result.navTrace!.filter((e) => e.playerId === "mov");
    expect(events.some((e) => e.kind === "blocked" && e.elapsedMs >= 2000 && e.elapsedMs < 12_000)).toBe(true);
    // stopped while sealed (it does not push on, and it does not jump)
    const during = result.tracks!.filter((f) => f.elapsedMs >= 4000 && f.elapsedMs < 12_000).map((f) => f.players.find((p) => p.id === "mov")!);
    expect(maxStep(during)).toBe(0);
    // re-planned once the way is open, and gets there
    expect(events.some((e) => e.kind === "replanned" && e.elapsedMs >= 12_000)).toBe(true);
    expect(state.players.find((p) => p.id === "mov")!.zoneId).toBe("b-site");
    expect(maxStep(t)).toBeLessThanOrEqual(RUN_STEP + 0.5);
    expect(offFloor(t)).toBeLessThanOrEqual(1);
  });
});

describe("route choice follows purpose and information", () => {
  it("M — same start and goal, a different danger picture: a different route", () => {
    const fast = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }));
    const hot = { "mid-bottom": 5, "mid-courtyard": 5, "mid-cubby": 5, "mid-catwalk": 5, "mid-market": 5 };
    const safe = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run", routePreference: "SAFEST", zoneCosts: hot }));
    expect(hops(safe.result, "mov")).not.toEqual(hops(fast.result, "mov"));
    expect(arrivedAt(safe.result, "mov")!).toBeGreaterThan(arrivedAt(fast.result, "mov")!);
    // the same costs under FASTEST change nothing
    const ignored = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run", zoneCosts: hot }));
    expect(hops(ignored.result, "mov")).toEqual(hops(fast.result, "mov"));
    expect(fast.result.navTrace![0]!.preference).toBe("FASTEST");
    expect(safe.result.navTrace![0]!.preference).toBe("SAFEST");
  });
});

// ---- a full Ascent match of ten players ----

function team(prefix: string, side: "attack" | "defense"): MatchRoundTeam {
  const anchors = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"];
  return {
    teamId: side === "attack" ? "attackers" : "defenders",
    players: Array.from({ length: 5 }, (_, i) => ({
      id: `${prefix}${i + 1}`, agentId: "omen", spawnZoneId: side === "defense" ? anchors[i]! : "attacker-spawn",
      loadout: { weaponId: "Vandal", armor: 50, ultimatePoints: 0, ultimateCost: 7, abilities: [] },
    })),
    economy: { teamId: side === "attack" ? "attackers" : "defenders", side, credits: 3900, lossBonusTier: 0, consecutiveLosses: 0 },
  };
}
function round(seed: number, roundNumber: number, record: boolean): MatchRoundInput {
  return {
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: roundNumber % 2 === 0 ? "b-site" : "a-site" }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    attackers: team("atk", "attack"), defenders: team("def", "defense"),
    seed, mapId: "ascent", matchId: "movement", roundNumber, config: { recordTracks: record },
  };
}
const match = (seed: number, record = true) => Array.from({ length: 24 }, (_, i) => runMatchRound(round(seed * 1000 + i, i + 1, record)));

describe("ten players, a full match", () => {
  const rounds = match(1);
  const tracks: ReadonlyArray<readonly TrackFrame[]> = rounds.map((r) => r.round.tracks!);

  it("I — every position of every player is on walkable floor, and nobody jumps", () => {
    let frames = 0, worstOff = 0, worstStep = 0;
    for (const t of tracks) for (let i = 0; i < t.length; i++) {
      for (const p of t[i]!.players) {
        worstOff = Math.max(worstOff, nav.distanceToWalkable(p));
        if (i > 0) {
          const q = t[i - 1]!.players.find((o) => o.id === p.id)!;
          if (p.alive && q.alive) worstStep = Math.max(worstStep, dist(p, q));
        }
      }
      frames++;
    }
    expect(frames).toBeGreaterThan(5000);
    expect(worstOff).toBeLessThanOrEqual(1);
    expect(worstStep).toBeLessThanOrEqual(RUN_STEP + 0.5);
  });

  it("I — bodies do not pile up: living players are almost never inside each other", () => {
    let pairs = 0, overlapping = 0;
    for (const t of tracks) for (const f of t) {
      const alive = f.players.filter((p) => p.alive);
      for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) {
        pairs++;
        if (dist(alive[a]!, alive[b]!) < 35) overlapping++; // closer than one body radius
      }
    }
    expect(pairs).toBeGreaterThan(50_000);
    expect(overlapping / pairs).toBeLessThan(0.002);
  });

  it("L — a duel is fought at the distance between where the two players really are", () => {
    const r = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
      config: { seed: 3, traceCommands: true, recordTracks: true },
    });
    const input = round(3, 1, true);
    const out = runMatchRound({ ...input, config: { recordTracks: true, traceCommands: true } });
    void r;
    const duels = out.round.engagementTrace ?? [];
    expect(duels.length).toBeGreaterThan(0);
    for (const d of duels) {
      const f = out.round.tracks!.find((fr) => fr.elapsedMs === d.elapsedMs)!;
      const a = f.players.find((p) => p.id === d.attackerId)!, b = f.players.find((p) => p.id === d.defenderId)!;
      expect(Math.abs(d.distanceMeters - dist(a, b) / 100), `${d.attackerId} v ${d.defenderId}`).toBeLessThan(0.6);
    }
    // and at least one duel is NOT at the distance between the two zones' callouts
    const callouts = duels.some((d) => {
      const za = spatial.getZone(d.attackerZone)!.position, zb = spatial.getZone(d.defenderZone)!.position;
      return Math.abs(d.distanceMeters - dist(za, zb) / 100) > 1.5;
    });
    expect(callouts).toBe(true);
  });

  it("N — the same seed gives the same match, tick for tick", () => {
    expect(match(1).map((r) => r.round.tracks)).toEqual(tracks);
    expect(match(2).map((r) => r.round.tracks)).not.toEqual(tracks);
  });

  it("O — watching a match does not change it: recording tracks leaves every event identical", () => {
    const unwatched = match(1, false);
    expect(unwatched.map((r) => r.round.events)).toEqual(rounds.map((r) => r.round.events));
    expect(unwatched.map((r) => r.winner)).toEqual(rounds.map((r) => r.winner));
    expect(unwatched[0]!.round.tracks).toBeUndefined();
  });

  const derived = process.env.PV_MAPS_DERIVED;
  const gridPath = derived ? resolve(derived, "ascent", "walkable.json") : "";
  it.skipIf(!gridPath || !existsSync(gridPath))("I — every position stands on a walkable grid cell (local geometry only)", () => {
    const g = JSON.parse(readFileSync(gridPath, "utf8")) as { originGameMeters: [number, number]; cellMeters: number; nx: number; ny: number; bitsBase64: string };
    const bits = Buffer.from(g.bitsBase64, "base64");
    const walkable = (ix: number, iy: number): boolean => {
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return false;
      const k = ix * g.ny + iy;
      return ((bits[k >> 3]! >> (7 - (k & 7))) & 1) === 1;
    };
    let off = 0, total = 0;
    const seen = new Set<string>();
    for (const t of tracks) for (const f of t) for (const p of f.players) {
      const key = `${p.x.toFixed(0)}|${p.y.toFixed(0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      const ix = Math.floor((p.x / 100 - g.originGameMeters[0]) / g.cellMeters);
      const iy = Math.floor((p.y / 100 - g.originGameMeters[1]) / g.cellMeters);
      if (!walkable(ix, iy)) off++;
    }
    expect(total).toBeGreaterThan(2000);
    expect(off).toBe(0);
  });
});
