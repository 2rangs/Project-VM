// Phase 4, test M with REAL intents: the route preference and the zone costs come from the team
// policy's own annotation (team-engine `annotateRoutes`, reading the team's belief), and the
// simulator's movement executor walks the route that follows from them.
import { describe, it, expect } from "vitest";
import { RoundSimulator, type ActionCommand as SimCommand, type RoundResult, type SimState } from "@pv/round-simulator";
import { annotateRoutes } from "@pv/team-engine";
import type { ActionCommand, PolicyView } from "@pv/shared-types";
import { runMatch } from "../src/index.js";
import { NO_ABILITIES } from "../../round-simulator/test/fixtures/setup.js";
import { player, scene, scripted, spatial, weapons } from "../../round-simulator/test/fixtures/ability-scenes.js";

/** The part of a team's view the annotation reads: its belief and its own players. */
function teamView(threat: Record<string, number>, teammates: Array<{ id: string; weaponId?: string; path?: string[] }>): PolicyView {
  return {
    belief: { threatZones: Object.entries(threat).map(([zoneId, threatLevel]) => ({ zoneId, threatLevel })) },
    teammates: teammates.map((t) => ({ id: t.id, alive: true, weapon: { weaponId: t.weaponId ?? "Vandal" }, ...(t.path ? { transit: { path: t.path } } : {}) })),
  } as unknown as PolicyView;
}
const order = (id: string, sourceActionId: string, over: Partial<ActionCommand> = {}): ActionCommand =>
  ({ playerId: id, kind: "move", targetZone: "b-site", moveMode: "run", executeAtMs: 0, sourceActionId, ...over } as ActionCommand);

/** One attacker walks from A Site under the given (annotated) order; a defender far away so nobody meets. */
function walk(cmd: ActionCommand): RoundResult {
  const state: SimState = scene([player("mov", "attack", "a-site"), player("far", "defense", "defender-spawn")], 90_000, null);
  const { playerId: _id, ...rest } = cmd as unknown as SimCommand;
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: scripted((p) => (p.id === "mov" ? rest : undefined)), defense: scripted(() => undefined) },
    config: { seed: 1, roundTimeMs: 90_000, traceCommands: true, recordTracks: true },
  }).runRound(state);
}
const hops = (r: RoundResult): string[] => (r.commandTrace ?? []).filter((c) => c.playerId === "mov" && c.phase === "move" && c.toZone).map((c) => c.toZone!);
const arrived = (r: RoundResult): number | null => (r.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "arrived")?.elapsedMs ?? null;

describe("M — the same start and goal, routed by what the order is for", () => {
  // the team believes the enemy holds the middle of the map
  const MID = { "mid-bottom": 0.9, "mid-courtyard": 0.9, "mid-cubby": 0.9, "mid-catwalk": 0.9, "mid-market": 0.9 };

  /** How many zones the team believes are held this walk passes through. */
  const exposure = (r: RoundResult): number => hops(r).filter((z) => z in MID).length;

  it("an entry runs the fastest route through the believed danger; a saver with a rifle goes round it", () => {
    const view = teamView(MID, [{ id: "mov", weaponId: "Vandal" }]);
    const [entry] = annotateRoutes(view, "bExecute", new Map([["mov", "entry"]]), [order("mov", "plan:exec-move")]);
    const [saver] = annotateRoutes(view, "default", new Map(), [order("mov", "attack-save:move")]);
    expect(entry!.routePreference).toBe("FASTEST");
    expect(saver!.routePreference).toBe("SAFEST");

    const fast = walk(entry!), safe = walk(saver!);
    expect(fast.navTrace![0]!.preference).toBe("FASTEST");
    expect(safe.navTrace![0]!.preference).toBe("SAFEST");
    expect(arrived(fast)).not.toBeNull();
    expect(arrived(safe)).not.toBeNull();
    // the short way is straight through the believed enemy (cubby, bottom mid, market); the saver
    // goes back out through A Main and round — it still has to cross one believed zone, because
    // every way from A to B crosses the middle or a spawn
    expect(hops(safe)).not.toEqual(hops(fast));
    expect(exposure(fast)).toBeGreaterThanOrEqual(3);
    expect(exposure(safe)).toBeLessThan(exposure(fast));
    expect(exposure(safe)).toBeLessThanOrEqual(1);
    expect(arrived(safe)!).toBeGreaterThan(arrived(fast)!);       // and pays for it in time
    expect(safe.navTrace![0]!.estimatedTravelMs!).toBeGreaterThan(fast.navTrace![0]!.estimatedTravelMs!);
  });

  it("the saver's detour follows the belief: with nothing believed it takes the short way too", () => {
    const calm = annotateRoutes(teamView({}, [{ id: "mov" }]), "default", new Map(), [order("mov", "attack-save:move")])[0]!;
    const entry = annotateRoutes(teamView({}, [{ id: "mov" }]), "bExecute", new Map(), [order("mov", "plan:exec-move")])[0]!;
    expect(calm.routePreference).toBe("SAFEST");
    expect(hops(walk(calm))).toEqual(hops(walk(entry)));
  });

  it("a saver with only a pistol does not take the long way round", () => {
    const cheap = annotateRoutes(teamView(MID, [{ id: "mov", weaponId: "Classic" }]), "default", new Map(), [order("mov", "attack-save:move")])[0]!;
    const rifle = annotateRoutes(teamView(MID, [{ id: "mov", weaponId: "Vandal" }]), "default", new Map(), [order("mov", "attack-save:move")])[0]!;
    expect(cheap.routePreference).toBe("TACTICAL");
    expect(arrived(walk(cheap))!).toBeLessThanOrEqual(arrived(walk(rifle))!);
  });

  it("a lurker takes a lane the rest of the team is not on", () => {
    const entry = annotateRoutes(teamView({}, [{ id: "mov" }]), "bExecute", new Map(), [order("mov", "plan:exec-move")])[0]!;
    const teamLane = ["a-site", ...hops(walk(entry))];
    const view = teamView({}, [{ id: "mov" }, { id: "mate", path: teamLane }]);
    const lurk = annotateRoutes(view, "bExecute", new Map([["mov", "lurker"]]), [order("mov", "plan:lurk-move")])[0]!;
    expect(lurk.routePreference).toBe("SAFEST");
    const mine = hops(walk(lurk));
    expect(mine).not.toEqual(teamLane.slice(1));
    expect(mine[mine.length - 1]).toBe("b-site");
    // it leaves the team's lane for at least part of the way
    expect(mine.some((z) => !teamLane.includes(z))).toBe(true);
  });

  it("a walked approach is planned as a stealth route", () => {
    const quiet = annotateRoutes(teamView(MID, [{ id: "mov" }]), "default", new Map(), [order("mov", "plan:slow-move", { moveMode: "walk" })])[0]!;
    expect(quiet.routePreference).toBe("STEALTH");
    const r = walk(quiet);
    expect(r.navTrace![0]!.preference).toBe("STEALTH");
    const loud = walk(annotateRoutes(teamView(MID, [{ id: "mov" }]), "bExecute", new Map(), [order("mov", "plan:exec-move")])[0]!);
    expect(exposure(r)).toBeLessThan(exposure(loud));
  });
});

describe("route intents in a real match", () => {
  it("the navigation trace of a match shows fastest, safest and stealth routes, each a real planned path", () => {
    const r = runMatch({ teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, map: "ascent", seed: 3, recordTracks: true });
    const planned = r.rounds.flatMap((x) => x.navTrace ?? []).filter((e) => e.kind === "planned");
    const byPref = new Map<string, number>();
    for (const e of planned) byPref.set(e.preference ?? "?", (byPref.get(e.preference ?? "?") ?? 0) + 1);
    expect(byPref.get("FASTEST") ?? 0).toBeGreaterThan(0);
    expect(byPref.get("SAFEST") ?? 0).toBeGreaterThan(0);
    expect(byPref.get("STEALTH") ?? 0).toBeGreaterThan(0);
    for (const e of planned) { expect(e.pathLength).toBeGreaterThanOrEqual(0); expect(e.estimatedTravelMs).toBeGreaterThanOrEqual(0); }
    // nothing in the match asks for a goal the floor does not reach
    expect(r.rounds.flatMap((x) => x.navTrace ?? []).filter((e) => e.kind === "unreachable")).toEqual([]);
  }, 120_000);
});
