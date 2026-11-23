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
  // entering the zone (crossing its boundary) and arriving (reaching the standing spot) are two moments
  const entered = (result.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "move" && c.toZone === "a-site");
  const arrival = (result.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "arrived" && c.toZone === "a-site");
  const mov = state.players.find((p) => p.id === "mov")!;
  const transits = views.map((v) => v.teammates.find((t) => t.id === "mov")?.transit).filter((t) => t !== undefined);
  return { result, enteredAtMs: entered?.elapsedMs ?? null, arrivedAtMs: arrival?.elapsedMs ?? null, health: mov.health, alive: mov.alive, views, transits };
}

/** The undisturbed run: when the runner crosses onto A site, and when it reaches its spot there. */
const CONTROL = run();
const ENTER_MS = CONTROL.enteredAtMs!;
const TRAVEL_MS = CONTROL.arrivedAtMs!;

describe("a ground patch on the entry delays it or makes it pay — through pathing, damage and the clock", () => {
  it("control: with nothing on the door the runner arrives in the travel time, unhurt", () => {
    const r = run();
    expect(r.health).toBe(100);
    expect(ENTER_MS).toBeGreaterThan(0);
    expect(TRAVEL_MS).toBeGreaterThan(ENTER_MS);
    // the walk takes about what the map's measured A Main -> A Site route takes (spot to spot, not anchor to anchor)
    const route = spatial.edgeTraversal("a-main", "a-site")!.runTimeMs;
    expect(TRAVEL_MS).toBeGreaterThan(route * 0.5);
    expect(TRAVEL_MS).toBeLessThan(route * 1.8);
  });

  it("counterfactual — fire on the door, clock to spare: the runner waits it out (later, unhurt, clock burned)", () => {
    const base = run();
    const fire = run({ patch: "fire" });
    expect(fire.health).toBe(100);
    // Thrown at 0.5 s for 5 s → the door is clear at 5.5 s; the runner has been standing at it,
    // and crosses onto the site within a step or two of that.
    expect(fire.enteredAtMs).toBeGreaterThanOrEqual(5500);
    expect(fire.enteredAtMs).toBeLessThanOrEqual(5500 + 700);
    const burned = fire.arrivedAtMs! - base.arrivedAtMs!; // the round clock the stall cost
    expect(burned).toBeGreaterThanOrEqual(5500 - ENTER_MS - 100);
    expect(fire.result.endedAtElapsedMs).toBeGreaterThanOrEqual(base.result.endedAtElapsedMs);
    // Its own team can see why and for how long: the runner is waiting at the edge, ETA = burn time left.
    const waiting = fire.transits.filter((t) => t!.waitingAtEdge);
    expect(waiting.length).toBeGreaterThan(0);
    for (const t of waiting) expect(t!.nextArrivalMs).toBeLessThanOrEqual(5000); // never more than the burn time
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
      config: { seed: 5, roundTimeMs: 30_000, traceCommands: true, recordTracks: true },
    }).runRound(state);
    const hop = (zone: string) => (result.commandTrace ?? []).find((c) => c.playerId === "mov" && c.phase === "move" && c.toZone === zone)?.elapsedMs ?? null;
    // how far the runner is from the patch's centre (A main's standing point) at a given time
    const centre = spatial.standPosition("a-main");
    const distAt = (ms: number): number => {
      const f = result.tracks!.find((fr) => fr.elapsedMs === ms)!.players.find((q) => q.id === "mov")!;
      return Math.hypot(f.x - centre.x, f.y - centre.y);
    };
    const cast = result.events.find((e) => e.kind === "abilityUsed")?.elapsedMs ?? null;
    return { health: state.players.find((p) => p.id === "mov")!.health, thrower: state.players.find((p) => p.id === "thr")!.health, intoMain: hop("a-main"), ontoSite: hop("a-site"), distAt, cast };
  }

  it("standing on it when it lands costs the run to its edge (r / v), then nothing", () => {
    const r = midZone(1000);
    expect(r.thrower).toBe(100 - Math.ceil(patchExposureMs(400, 675, false) / 100) * 6); // 6 ticks → 64
  });

  it("counterfactual — when it lands: a runner on the patch is caught for the rest of the way out, one off it is not", () => {
    // The patch is a 4 m disc on A main's standing point. Throw it at every decision while the
    // runner crosses A main: it is burned exactly when it is on the disc at that moment.
    const none = midZone(null);
    let on = 0, off = 0;
    for (let at = Math.ceil(none.intoMain! / 500) * 500; at < none.ontoSite!; at += 500) {
      const r = midZone(at);
      if (r.cast === null) continue;
      const d = none.distAt(r.cast); // same walk up to the moment it lands
      if (d < 400 - 70) {
        on++;
        expect(r.health, `cast at ${r.cast} ms, runner ${d.toFixed(0)} uu from the centre`).toBeLessThan(100);
        // never more than the whole chord (2r / v)
        expect(r.health).toBeGreaterThanOrEqual(100 - Math.ceil(patchExposureMs(400, 675, true) / 100) * 6);
        expect(r.ontoSite).toBe(none.ontoSite); // it keeps running: the patch cost health, not time
      } else if (d > 400 + 70) {
        off++;
        expect(r.health, `cast at ${r.cast} ms, runner ${d.toFixed(0)} uu from the centre`).toBe(100);
      }
    }
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });

  it("counterfactual — it is already burning when the runner gets there: the runner waits at the patch's rim", () => {
    const none = midZone(null);
    const burning = midZone(1000); // burns 1.0–6.0 s; the runner reaches the patch before that
    expect(none.ontoSite!).toBeLessThan(6000);
    expect(burning.health).toBe(100);
    // while it burns the runner is never on the disc — it stands just outside it
    for (let ms = burning.cast! + 100; ms < burning.cast! + 5000; ms += 100) expect(burning.distAt(ms), `at ${ms} ms`).toBeGreaterThan(400);
    expect(burning.distAt(burning.cast! + 4900)).toBeLessThan(400 + 80);
    // and it goes on once the fire is out: the site is reached late by about the wait
    expect(burning.ontoSite!).toBeGreaterThan(6000);
    expect(burning.ontoSite! - none.ontoSite!).toBeGreaterThan(1000);
  });
});

describe("the route planner prices fire: wait, cross or go round, whichever is cheapest", () => {
  /** `mov` goes A main → A garden; the short way is past A tree, the other way is over A site. */
  function route(fire: boolean) {
    const attack = scripted((p, v) => {
      if (p.id === "thr") return fire && charges(p, FIRE) > 0 ? { kind: "useAbility", abilityId: FIRE, targetZone: "a-tree" } : undefined;
      return v.timeRemainingMs > 29_500 ? undefined : { kind: "move", targetZone: "a-garden", moveMode: "run" }; // plans after the fire is down
    });
    const state = scene([player("mov", "attack", "a-main"), player("thr", "attack", "a-tree", [FIRE]), player("far", "defense", "defender-spawn")], 30_000, "thr");
    const result = new RoundSimulator({
      spatial, weapons, abilities: catalog, policies: { attack, defense: scripted(() => undefined) },
      config: { seed: 5, roundTimeMs: 30_000, traceCommands: true, recordTracks: true },
    }).runRound(state);
    const trace = (result.commandTrace ?? []).filter((c) => c.playerId === "mov");
    const centre = spatial.standPosition("a-tree");
    const cast = result.events.find((e) => e.kind === "abilityUsed")?.elapsedMs ?? null;
    // closest the runner comes to the patch's centre while it burns (5 s from the cast)
    let nearestWhileBurning = Infinity;
    if (cast !== null) for (const f of result.tracks!) {
      if (f.elapsedMs <= cast || f.elapsedMs >= cast + 5000) continue;
      const q = f.players.find((pl) => pl.id === "mov")!;
      nearestWhileBurning = Math.min(nearestWhileBurning, Math.hypot(q.x - centre.x, q.y - centre.y));
    }
    return {
      hops: trace.filter((c) => c.phase === "move").map((c) => c.toZone),
      arrivedAtMs: trace.find((c) => c.phase === "arrived")?.elapsedMs ?? null,
      health: state.players.find((p) => p.id === "mov")!.health,
      nearestWhileBurning,
    };
  }

  it("no fire: the short way", () => {
    const r = route(false);
    expect(r.hops).toContain("a-tree");
    expect(r.hops[r.hops.length - 1]).toBe("a-garden");
  });

  it("counterfactual — fresh fire on the short way: the detour is shorter than the wait, so the runner goes round", () => {
    const short = route(false);
    const r = route(true);
    expect(r.hops[r.hops.length - 1]).toBe("a-garden");
    expect(r.health).toBe(100);
    expect(r.nearestWhileBurning).toBeGreaterThan(400); // it never sets foot on the burning disc
    expect(short.nearestWhileBurning).toBe(Infinity); // (no fire in the control)
    // going round the disc costs at most a little time — far less than standing out the 5 s burn
    expect(r.arrivedAtMs!).toBeGreaterThanOrEqual(short.arrivedAtMs!);
    expect(r.arrivedAtMs!).toBeLessThan(short.arrivedAtMs! + 4500);
  });
});
