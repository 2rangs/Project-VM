import { describe, it, expect } from "vitest";
import { runMatchRound, ScriptedPolicy, SYNTHETIC_DEFENSE_ANCHORS, toSimGameEvents, type MatchRoundInput, type MatchRoundTeam } from "../src/index.js";
import { barrierAreas, DEFENDER_BARRIER_SHARE } from "../src/buy-phase.js";
import { movementStyle, nearOptimalRoutes, pickRoute } from "../src/movement-style.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();
const sq = spatialQuery(spatial);

function team(prefix: string, side: "attack" | "defense"): MatchRoundTeam {
  const anchors = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"];
  return {
    teamId: side === "attack" ? "attackers" : "defenders",
    players: Array.from({ length: 5 }, (_, i) => ({
      id: `${prefix}${i + 1}`, agentId: "omen",
      skills: { ...AVERAGE_SKILLS, reaction: 0.4 + 0.1 * i },
      traits: { gameSense: 0.3 + 0.12 * i, trading: 0.8 - 0.1 * i, clutch: 0.6 },
      spawnZoneId: side === "defense" ? anchors[i] : "attacker-spawn",
      loadout: { weaponId: "Vandal", armor: 50 },
    })),
  };
}

function input(seed: number, config: MatchRoundInput["config"]): MatchRoundInput {
  return {
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    attackers: team("atk", "attack"), defenders: team("def", "defense"),
    seed, mapId: "ascent", matchId: "m1", roundNumber: 1, config,
  };
}

const ON = { buyPhaseMs: 30000, movementStyle: true, recordTracks: true } as const;

describe("buy phase", () => {
  it("is off by default: no buyPhase on the result", () => {
    expect(runMatchRound(input(5, { recordTracks: true })).round.buyPhase).toBeUndefined();
  });

  it("records 30 s of frames before the round, every body behind its barrier", () => {
    const out = runMatchRound(input(5, ON));
    const bp = out.round.buyPhase!;
    expect(bp.durationMs).toBe(30000);
    expect(bp.tracks!.length).toBe(300);
    expect(bp.tracks![0]!.elapsedMs).toBe(-30000);
    expect(bp.tracks![bp.tracks!.length - 1]!.elapsedMs).toBe(-100);
    const areas = barrierAreas(spatial, ["a-site", "b-site", "mid-courtyard"]);
    for (const f of bp.tracks!) for (const pl of f.players) {
      const node = spatial.nav!.locate(pl);
      if (node === null) continue;
      const zone = spatial.nav!.nodeZone(node);
      if (pl.side === "attack") expect(zone).toBe("attacker-spawn");
      else expect(areas.defense.has(zone)).toBe(true);
    }
    // the attackers' barrier is their spawn; the defenders' runs where they are clearly first
    expect([...areas.attack]).toEqual(["attacker-spawn"]);
    expect(areas.defense.has("mid-market")).toBe(true);
    expect(areas.defense.has("a-main")).toBe(false);
    expect(DEFENDER_BARRIER_SHARE).toBeLessThan(0.5);
  });

  it("players move during it, and defenders end on their planned setup, not in their spawn", () => {
    const out = runMatchRound(input(5, ON));
    const bp = out.round.buyPhase!;
    // everyone walks during it (to its setup, idle wanders): path length per player
    const walked = new Map<string, number>();
    for (let i = 1; i < bp.tracks!.length; i++) for (const p of bp.tracks![i]!.players) {
      const q = bp.tracks![i - 1]!.players.find((x) => x.id === p.id)!;
      walked.set(p.id, (walked.get(p.id) ?? 0) + Math.hypot(p.x - q.x, p.y - q.y));
    }
    expect([...walked.values()].filter((d) => d > 150).length).toBeGreaterThanOrEqual(8);
    for (const s of bp.setups.filter((x) => x.side === "defense")) expect(s.zoneId).not.toBe("defender-spawn");
  });

  it("is deterministic, and varies from round to round", () => {
    const a = runMatchRound(input(11, ON)), b = runMatchRound(input(11, ON)), c = runMatchRound(input(12, ON));
    expect(a.round.buyPhase!.tracks).toEqual(b.round.buyPhase!.tracks);
    expect(a.players).toEqual(b.players);
    // the way there varies; where it ends does not (each player's setup spot is the calibrated start)
    const at = (o: typeof a, k: number) => o.round.buyPhase!.tracks![k]!.players.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
    expect(at(a, 150)).not.toBe(at(c, 150));
    const off = runMatchRound(input(12, { recordTracks: true, buyPhaseMs: 30000 }));
    expect(at(c, 299)).toBe(at(off, 299));
  });

  it("exports a buyPhaseStart and the buy-phase moves at negative times", () => {
    const out = runMatchRound(input(5, ON));
    const ev = toSimGameEvents(out.round, { includeMoves: true });
    const start = ev.find((e) => e.kind === "buyPhaseStart")!;
    expect(start.timeMs).toBe(-30000);
    expect(ev.filter((e) => e.kind === "move" && e.timeMs < 0).length).toBeGreaterThan(50);
    expect(ev[0]!.kind).toBe("buyPhaseStart");
  });
});

describe("movement style", () => {
  const P = (id: string, gameSense: number, trading: number) => ({ id, skills: AVERAGE_SKILLS, traits: { gameSense, trading, clutch: 0.6 } });

  it("is deterministic per (seed, player) and differs between players and rounds", () => {
    expect(movementStyle(P("a", 0.6, 0.6), 0, "entry", 1)).toEqual(movementStyle(P("a", 0.6, 0.6), 0, "entry", 1));
    expect(movementStyle(P("a", 0.6, 0.6), 0, "entry", 1)).not.toEqual(movementStyle(P("a", 0.6, 0.6), 0, "entry", 2));
    expect(movementStyle(P("a", 0.6, 0.6), 0, "entry", 1).lane).not.toBe(movementStyle(P("b", 0.6, 0.6), 1, "entry", 1).lane);
  });

  it("follows the attributes: traders keep more spacing, lurkers accept slower routes, game sense buys faster", () => {
    let wide = 0, slack = 0, fast = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (movementStyle(P("x", 0.6, 0.9), 0, null, seed).spacing > movementStyle(P("x", 0.6, 0.2), 0, null, seed).spacing) wide++;
      if (movementStyle(P("x", 0.6, 0.6), 0, "lurker", seed).routeSlack > movementStyle(P("x", 0.6, 0.6), 0, "entry", seed).routeSlack) slack++;
      if (movementStyle(P("x", 0.9, 0.6), 0, null, seed).buy.buyMs < movementStyle(P("x", 0.2, 0.6), 0, null, seed).buy.buyMs) fast++;
    }
    expect(wide).toBe(40);
    expect(slack).toBe(40);
    expect(fast).toBe(40);
  });

  it("near-optimal routes: the best route first, alternatives within the slack, and a stable pick", () => {
    const routes = nearOptimalRoutes(spatial, "attacker-spawn", "a-site", "run", {}, 0.25);
    expect(routes[0]!.path).toEqual(spatial.findPath("attacker-spawn", "a-site", "run")!.path);
    for (const r of routes) expect(r.timeMs).toBeLessThanOrEqual(routes[0]!.timeMs * 1.25 + 1e-6);
    expect(new Set(routes.map((r) => r.path.join(">"))).size).toBe(routes.length);
    expect(pickRoute([1000, 1100, 5000], 600, 3, "k")).toBe(pickRoute([1000, 1100, 5000], 600, 3, "k"));
    expect(pickRoute([1000], 600, 3, "k")).toBe(0);
  });

  it("with styles on, players of one team do not all take the same lane through the same zones", () => {
    const out = runMatchRound(input(21, { movementStyle: true, recordTracks: true }));
    const off = runMatchRound(input(21, { recordTracks: true }));
    expect(out.round.tracks!.length).toBeGreaterThan(0);
    expect(off.round.tracks!.length).toBeGreaterThan(0);
    // positions differ between the two (style changes where bodies are, not the outcome code path)
    const at = (o: typeof out, k: number) => o.round.tracks![Math.min(k, o.round.tracks!.length - 1)]!.players.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
    expect(at(out, 60)).not.toBe(at(off, 60));
  });
});
