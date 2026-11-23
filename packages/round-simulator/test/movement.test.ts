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

describe("a standing spot is chosen by what the stop is for", () => {
  const last = (r: RoundResult, id: string): P3 => { const t = track(r, id); return t[t.length - 1]!; };
  const run = (state: SimState, attack: Rule, defense: Rule, cfg: Record<string, unknown> = {}): RoundResult =>
    new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: scripted((p, v) => attack(p.id, v.timeRemainingMs)), defense: scripted((p, v) => defense(p.id, v.timeRemainingMs)) },
      config: { seed: 1, roundTimeMs: state.timeRemainingMs, traceCommands: true, recordTracks: true, ...cfg },
    }).runRound(state);
  const hold: Rule = () => undefined;

  it("the spike carrier stops on the plant area and plants there; a teammate on the same order stands by the callout", () => {
    const state = scene([player("car", "attack", "a-main"), player("mate", "attack", "a-main"), player("far", "defense", "b-site")], 30_000, "car");
    const inSite = (id: string): boolean => state.players.find((p) => p.id === id)!.zoneId === "a-site";
    const r = run(state, (id) => (id === "car" && inSite("car") ? { kind: "plant" } : { kind: "move", targetZone: "a-site", moveMode: "run" }), hold);
    const planted = r.events.find((e) => e.kind === "planted");
    expect(planted).toBeDefined();
    const car = track(r, "car")[Math.floor(planted!.elapsedMs / TICK_MS) - 1]!;
    expect(spatial.plantZoneAt(car)?.zoneId).toBe("a-site");
    expect(state.spike.position).toEqual({ x: car.x, y: car.y, z: car.z }); // the spike is where the carrier stood
    // among the plant area's standing points it took one that is well covered or near where it
    // came in (here: the least exposed of the thirty — it plants behind cover, not in the open)
    const entry = track(r, "car").find((q, i) => i > 0 && nav.zoneAt(q) === "a-site")!;
    const onArea = nav.zoneNodes("a-site").map((n) => nav.nodePosition(n)).filter((q) => spatial.plantZoneAt(q)?.zoneId === "a-site");
    const ds = onArea.map((q) => dist(q, entry)).sort((x, y) => x - y);
    const es = onArea.map((q) => nav.exposure(nav.locate(q)!)).sort((x, y) => x - y);
    const median = <T,>(v: T[]): T => v[v.length >> 1]!;
    expect(nav.exposure(nav.locate(car)!) <= median(es) || dist(car, entry) <= median(ds)).toBe(true);
    expect(nav.exposure(nav.locate(car)!)).toBeLessThan(nav.exposure(nav.anchorNode("a-site")!));
    // the teammate has no such business there
    expect(dist(last(r, "mate"), car)).toBeGreaterThan(70);
  });

  it("a defender sent onto the planted spike stops at the spike and defuses", () => {
    // the spike lies at the plant-area point farthest from the site's callout
    const A = spatial.standPosition("a-site");
    const onArea = nav.zoneNodes("a-site").map((n) => nav.nodePosition(n)).filter((q) => spatial.plantZoneAt(q)?.zoneId === "a-site" && Math.abs(q.z - A.z) < 100);
    const spike = onArea.reduce((best, q) => (dist(q, A) > dist(best, A) ? q : best));
    const base = scene([player("lone", "attack", "attacker-spawn"), player("d1", "defense", "a-garden")], 40_000, null);
    const state: SimState = { ...base, spike: { ...base.spike, phase: "planted", carrierId: null, zoneId: "a-site", position: { ...spike }, detonateAtElapsedMs: 40_000 } };
    const at = (): string => state.players.find((p) => p.id === "d1")!.zoneId;
    const r = run(state, hold, () => (at() === "a-site" ? { kind: "defuse" } : { kind: "move", targetZone: "a-site", moveMode: "run" }));
    expect(r.reason).toBe("spikeDefused");
    const stop = last(r, "d1");
    expect(dist(stop, spike)).toBeLessThan(1); // the spike's own standing point was free
    expect(dist(stop, A)).toBeGreaterThan(300); // and that is not where a player merely sent to A Site stands
  });

  it("with cover spots on, a mover told what to watch takes a spot that sees it and that the rest of the map sees less", () => {
    const go = (coverSpots: boolean): P3 => {
      const state = scene([player("h", "defense", "a-garden"), player("far", "attack", "attacker-spawn")], 20_000, null);
      return last(run(state, hold, (id) => (id === "h" ? { kind: "move", targetZone: "a-site", aimZone: "a-main", moveMode: "run" } : undefined), { coverSpots }), "h");
    };
    const plain = nav.locate(go(false))!, covered = nav.locate(go(true))!;
    expect(nav.nodeZone(covered)).toBe("a-site");
    expect(nav.sightInto(covered, "a-main")).toBeGreaterThan(0);
    expect(covered).not.toBe(plain);
    // judged as the rule judges it: nearer to where it came in, or less seen from the rest of the map
    expect(nav.exposure(covered, "a-main")).toBeLessThanOrEqual(Math.max(...nav.zoneNodes("a-site").map((n) => nav.exposure(n, "a-main"))));
    // off (the default): no cover scoring, but a defender told to watch the way in still stops
    // where it can see it — the first such spot on its own way in, not the middle of the site
    expect(nav.nodeZone(plain)).toBe("a-site");
    expect(nav.sightInto(plain, "a-main")).toBeGreaterThan(0);
  });

  it("a replan on the way keeps the spot the player was going to", () => {
    const wall: MovementBlocker = { id: "wall", zoneId: "mid-bottom", fromMs: 3000, untilMs: 60_000 };
    const { result } = walk({ mov: "a-site" }, () => ({ kind: "move", targetZone: "b-site", moveMode: "run" }), { blockers: [wall] });
    const plans = result.navTrace!.filter((e) => e.playerId === "mov" && (e.kind === "planned" || e.kind === "replanned"));
    expect(plans.length).toBeGreaterThan(1);
    const dest = plans.map((e) => e.waypoints![e.waypoints!.length - 1]!);
    for (const d of dest) expect(dist(d, dest[0]!)).toBeLessThan(40); // the same spot (lane offset aside)
  });
});

describe("movers never wait on each other forever", () => {
  const TURN_MS = 4_200;
  it("two players who turn round on a narrow walkway both get back (no mutual queue)", () => {
    // both run from attacker spawn toward A; a few seconds in, both are called back — the one in
    // front is now behind, and each finds the other in its way
    const { result } = walk({ m1: "attacker-spawn", m2: "attacker-spawn" }, (_id, left) =>
      ({ kind: "move", targetZone: left > 60_000 - TURN_MS ? "a-site" : "attacker-spawn", moveMode: "run" }), { clockMs: 60_000 });
    for (const id of ["m1", "m2"]) {
      const back = (result.commandTrace ?? []).filter((c) => c.playerId === id && c.phase === "arrived" && c.elapsedMs > TURN_MS);
      expect(back.length, `${id} arrives back at attacker spawn`).toBeGreaterThan(0);
      expect(back[0]!.toZone).toBe("attacker-spawn");
      expect(back[0]!.elapsedMs).toBeLessThan(16_000);
      // and it never stood still for more than three seconds on the way
      const pts = track(result, id), until = Math.floor(back[0]!.elapsedMs / TICK_MS);
      let still = 0, worst = 0;
      for (let i = 1; i < Math.min(until, pts.length); i++) { still = dist(pts[i]!, pts[i - 1]!) < 1e-6 ? still + 1 : 0; worst = Math.max(worst, still); }
      expect(worst * TICK_MS, `${id} longest stand-still`).toBeLessThanOrEqual(3_500);
    }
  });

  it("two players meeting head-on in a corridor pass each other", () => {
    const { result } = walk({ m1: "a-main", m2: "a-lobby" }, (id) => ({ kind: "move", targetZone: id === "m1" ? "a-lobby" : "a-main", moveMode: "run" }), { clockMs: 40_000 });
    expect(arrivedAt(result, "m1")).not.toBeNull();
    expect(arrivedAt(result, "m2")).not.toBeNull();
    expect(offFloor([...track(result, "m1"), ...track(result, "m2")])).toBeLessThanOrEqual(1);
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

  it("L — a duel is fought between two players who really see each other, at the distance between where they really are", () => {
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
    // … and between two bodies that really have line of sight from where they stand
    for (const d of duels) {
      const f = out.round.tracks!.find((fr) => fr.elapsedMs === d.elapsedMs)!;
      const a = f.players.find((p) => p.id === d.attackerId)!, b = f.players.find((p) => p.id === d.defenderId)!;
      expect(nav.sees(a, d.attackerZone, b, d.defenderZone), `${d.attackerId} v ${d.defenderId} @${d.elapsedMs}`).toBe(true);
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
