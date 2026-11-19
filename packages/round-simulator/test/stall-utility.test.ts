import { describe, it, expect } from "vitest";
import { RoundSimulator, type PolicyView } from "../src/index.js";
import { patchExposureMs, slowFieldDelayMs } from "../src/situational.js";
import { catalog, charges, player, scene, scripted, spatial, weapons, FIRE, SLOW } from "./fixtures/ability-scenes.js";

/**
 * Utility that stalls a push, as world rules. One scene, one condition changed at a time:
 *
 *   `mov` runs from A main onto A site (2.8 s). `thr`, standing on the site, can throw a ground
 *   patch at A main — from the neighbouring zone it lands on the doorway between the two.
 *   Both are on the same team on purpose: a patch does not ask whose it is, and with no enemy
 *   near there is no duel, so arrival time and health are the patch's doing alone. (The one
 *   defender stands in his spawn so the round stays open.)
 *
 * Fire: radius 4 m, 5 s. Crossing it is the chord 2r / v = 800 / 675 s ≈ 1.19 s → 12 ticks × 6 HP.
 */
interface Opts { patch?: "fire" | "slow" | null; clockMs?: number; seed?: number }

const CROSS_TICKS = Math.ceil(patchExposureMs(400, 675, true) / 100); // 12
const CROSS_DAMAGE = CROSS_TICKS * 6; // 72
/** A main → A site at run speed (centre to centre), on the 100 ms tick grid. */
const TRAVEL_MS = (() => {
  const a = spatial.getZone("a-main")!.position, b = spatial.getZone("a-site")!.position;
  return Math.ceil((Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 675) * 10) * 100 - 100;
})();

function run(o: Opts = {}) {
  const clockMs = o.clockMs ?? 30_000;
  const ability = o.patch === "fire" ? FIRE : o.patch === "slow" ? SLOW : null;
  const views: PolicyView[] = [];
  const attack = scripted((p, v) => {
    if (p.id === "thr") {
      // Thrown half a second in: the runner is already on its way to the door.
      return ability && charges(p, ability) > 0 && v.timeRemainingMs <= clockMs - 500
        ? { kind: "useAbility", abilityId: ability, targetZone: "a-main" } : { kind: "hold", aimZone: "a-rafters" };
    }
    return { kind: "move", targetZone: "a-site", moveMode: "run" };
  }, views);
  const state = scene([
    player("mov", "attack", "a-main"),
    player("thr", "attack", "a-site", [FIRE, SLOW]),
    player("far", "defense", "defender-spawn"),
  ], clockMs, "thr");
  const result = new RoundSimulator({
    spatial, weapons, abilities: catalog, policies: { attack, defense: scripted(() => undefined) },
    config: { seed: o.seed ?? 5, roundTimeMs: clockMs, traceCommands: true },
  }).runRound(state);
  const arrival = (result.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "move" && c.toZone === "a-site");
  const mov = state.players.find((p) => p.id === "mov")!;
  const transits = views.map((v) => v.teammates.find((t) => t.id === "mov")?.transit).filter((t) => t !== undefined);
  return { result, arrivedAtMs: arrival?.elapsedMs ?? null, health: mov.health, alive: mov.alive, views, transits };
}

describe("a ground patch on the entry delays it or makes it pay — through pathing, damage and the clock", () => {
  it("control: with nothing on the door the runner arrives in the travel time, unhurt", () => {
    const r = run();
    expect(r.arrivedAtMs).toBe(TRAVEL_MS);
    expect(r.health).toBe(100);
  });

  it("counterfactual — fire on the door, clock to spare: the runner waits it out (later, unhurt, clock burned)", () => {
    const base = run();
    const fire = run({ patch: "fire" });
    expect(fire.health).toBe(100);
    // Thrown at 0.5 s for 5 s → the door is clear at 5.5 s; the runner has been standing at it.
    expect(fire.arrivedAtMs).toBeGreaterThanOrEqual(5500);
    expect(fire.arrivedAtMs).toBeLessThanOrEqual(5600);
    const burned = fire.arrivedAtMs! - base.arrivedAtMs!; // the round clock the stall cost
    expect(burned).toBeGreaterThanOrEqual(5500 - TRAVEL_MS);
    expect(fire.result.endedAtElapsedMs).toBeGreaterThanOrEqual(base.result.endedAtElapsedMs);
    // Its own team can see why and for how long: the runner is waiting at the edge, ETA = burn time left.
    const waiting = fire.transits.filter((t) => t!.waitingAtEdge);
    expect(waiting.length).toBeGreaterThan(0);
    for (const t of waiting) expect(t!.nextArrivalMs).toBeLessThanOrEqual(5500 - TRAVEL_MS);
    expect(base.transits.some((t) => t!.waitingAtEdge)).toBe(false);
  });

  it("counterfactual — the same fire, no clock to wait: the runner goes through and pays the chord", () => {
    // 9 s on the round clock: at the door the fire has ~2.5 s left, and waiting would leave less
    // than a plant (4 s) — so the wait is not an option.
    const waited = run({ patch: "fire", clockMs: 30_000 });
    const forced = run({ patch: "fire", clockMs: 9_000 });
    expect(forced.arrivedAtMs).toBe(TRAVEL_MS); // on time …
    expect(forced.health).toBe(100 - CROSS_DAMAGE); // … for the price of the chord (12 ticks × 6 HP)
    expect(forced.alive).toBe(true);
    expect(waited.health).toBe(100);
    expect(waited.arrivedAtMs!).toBeGreaterThan(forced.arrivedAtMs!);
  });

  it("the same tight clock with no fire costs nothing — the damage is the fire's, not the clock's", () => {
    const r = run({ clockMs: 9_000 });
    expect(r.arrivedAtMs).toBe(TRAVEL_MS);
    expect(r.health).toBe(100);
  });

  it("counterfactual — a slow field on the door: late by the chord at half speed, unhurt", () => {
    const base = run();
    const slow = run({ patch: "slow" });
    const delay = slowFieldDelayMs(400, 675, 0.5); // 2r/v · (1/0.5 − 1) ≈ 1185 ms
    expect(slow.health).toBe(100);
    expect(slow.arrivedAtMs! - base.arrivedAtMs!).toBeGreaterThanOrEqual(Math.floor(delay / 100) * 100);
    expect(slow.arrivedAtMs! - base.arrivedAtMs!).toBeLessThanOrEqual(Math.ceil(delay / 100) * 100 + 100);
  });

  it("the thrower's team knows its own patch (zone-level map change)", () => {
    const { views } = run({ patch: "fire" });
    const known = views.find((v) => (v.visibleEffects ?? []).length > 0)!;
    expect(known.visibleEffects).toEqual([expect.objectContaining({ zoneId: "a-main", effectType: "molly", own: true })]);
    expect(known.observation.knownMapChanges[0]!.note).toBe("molly:own:a-main");
    const z = spatial.getZone("a-main")!.position;
    expect(known.observation.knownMapChanges[0]!.approxPosition).toEqual({ x: z.x, y: z.y, z: z.z });
  });

  it("same seed and state → the identical round", () => {
    expect(run({ patch: "fire", seed: 9 }).result).toEqual(run({ patch: "fire", seed: 9 }).result);
  });
});

describe("a patch in the middle of a zone: who is on it, and for how long, is geometry", () => {
  /** `mov` runs A lobby → A main → A site; `thr` stands on A main and drops fire on its own zone at `castAtMs`. */
  function midZone(castAtMs: number | null) {
    const attack = scripted((p, v) => {
      if (p.id === "thr") {
        return castAtMs !== null && charges(p, FIRE) > 0 && v.timeRemainingMs <= 30_000 - castAtMs
          ? { kind: "useAbility", abilityId: FIRE, targetZone: "a-main" } : undefined;
      }
      return { kind: "move", targetZone: "a-site", moveMode: "run" };
    });
    const state = scene([player("mov", "attack", "a-lobby"), player("thr", "attack", "a-main", [FIRE]), player("far", "defense", "defender-spawn")], 30_000, "thr");
    const result = new RoundSimulator({
      spatial, weapons, abilities: catalog, policies: { attack, defense: scripted(() => undefined) },
      config: { seed: 5, roundTimeMs: 30_000, traceCommands: true },
    }).runRound(state);
    const hop = (zone: string) => (result.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "move" && c.toZone === zone)?.elapsedMs ?? null;
    return { health: state.players.find((p) => p.id === "mov")!.health, thrower: state.players.find((p) => p.id === "thr")!.health, intoMain: hop("a-main"), ontoSite: hop("a-site") };
  }

  it("standing on it when it lands costs the run to its edge (r / v), then nothing", () => {
    const r = midZone(1000);
    expect(r.thrower).toBe(100 - Math.ceil(patchExposureMs(400, 675, false) / 100) * 6); // 6 ticks → 64
  });

  it("counterfactual — when it lands: a runner just inside the zone is caught for the rest of the radius, one already past it is not", () => {
    const none = midZone(null);
    const hop = none.intoMain!; // when the runner enters A main
    const nextDecision = Math.ceil((hop + 1) / 500) * 500;
    const justInside = midZone(nextDecision); // under half a second past the centre: still on the patch
    const longPast = midZone(nextDecision + 1000); // over a second past it: 7 m on, off the 4 m patch
    expect(justInside.health).toBeLessThan(100);
    expect(justInside.health).toBeGreaterThan(100 - Math.ceil(patchExposureMs(400, 675, false) / 100) * 6); // less than a full radius
    expect(longPast.health).toBe(100);
    expect(justInside.ontoSite).toBe(none.ontoSite); // it keeps running: the patch cost health, not time
  });

  it("counterfactual — it is already burning when the runner gets there: the runner waits at the zone's edge", () => {
    const none = midZone(null);
    const burning = midZone(1000); // burns 1.0–6.0 s; the runner reaches A main's edge before that
    expect(none.intoMain!).toBeLessThan(6000);
    expect(burning.health).toBe(100);
    expect(burning.intoMain).toBeGreaterThanOrEqual(6000);
    expect(burning.intoMain).toBeLessThanOrEqual(6100);
  });
});

describe("the route planner prices fire: wait, cross or go round, whichever is cheapest", () => {
  /** `mov` goes mid courtyard → mid bottom; the short way is the catwalk (6.7 s), the long way the cubby (9.4 s). */
  function route(fire: boolean) {
    const attack = scripted((p, v) => {
      if (p.id === "thr") return fire && charges(p, FIRE) > 0 ? { kind: "useAbility", abilityId: FIRE, targetZone: "mid-catwalk" } : undefined;
      return v.timeRemainingMs > 29_500 ? undefined : { kind: "move", targetZone: "mid-bottom", moveMode: "run" }; // plans after the fire is down
    });
    const state = scene([player("mov", "attack", "mid-courtyard"), player("thr", "attack", "mid-catwalk", [FIRE]), player("far", "defense", "defender-spawn")], 30_000, "thr");
    const result = new RoundSimulator({
      spatial, weapons, abilities: catalog, policies: { attack, defense: scripted(() => undefined) },
      config: { seed: 5, roundTimeMs: 30_000, traceCommands: true },
    }).runRound(state);
    return { hops: (result.commandTrace ?? []).filter((c) => c.playerId === "mov" && c.phase === "move").map((c) => c.toZone), health: state.players.find((p) => p.id === "mov")!.health };
  }

  it("no fire: the short way", () => {
    expect(route(false).hops).toEqual(["mid-catwalk", "mid-bottom"]);
  });

  it("counterfactual — fresh fire on the short way: the detour is shorter than the wait, so the runner goes round", () => {
    const r = route(true);
    expect(r.hops).toEqual(["mid-cubby", "mid-bottom"]);
    expect(r.health).toBe(100);
  });
});
