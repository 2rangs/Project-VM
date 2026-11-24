import { describe, it, expect } from "vitest";
import { RoundSimulator, type EngagementRecord, type PolicyView } from "../src/index.js";
import { smokeExitDelayMs, angleAdvantageDelays, BODY_HALF_WIDTH } from "../src/situational.js";
import { catalog, charges, player, scene, scripted, spatial, weapons, FLASH, RECON, SMOKE } from "./fixtures/ability-scenes.js";

/**
 * Smoke is not a wall. One scene, one condition changed at a time:
 *
 *   `atk` stands on A main and walks onto A site, where `def` is holding. A sightline joins the
 *   two zones. `smk` (A main, never moves) can put a smoke on A main; `sup` (A main, never moves)
 *   can flash or recon the site, timed from `atk`'s own arrival (the view's `transit`).
 *
 * Conditions: smoke yes/no · the holder watches the smoke edge or looks away · a flash on the
 * holder · a fresh recon call on the holder. Nothing else differs (same seed, same players).
 */
interface Opts { smoke?: boolean; holderAim?: string; support?: "flash" | "recon"; seed?: number }

function run(o: Opts = {}) {
  const smoke = o.smoke ?? true;
  const views: PolicyView[] = [];
  const attack = scripted((p, v) => {
    if (p.id === "smk") return smoke && charges(p, SMOKE) > 0 ? { kind: "useAbility", abilityId: SMOKE, targetZone: "a-main", aimZone: "a-site" } : undefined;
    if (p.id === "sup") {
      const entry = v.teammates.find((t) => t.id === "atk")?.transit;
      const ability = o.support === "flash" ? FLASH : o.support === "recon" ? RECON : null;
      // Thrown when the entry is at most 1.5 s from stepping onto the site (and never before).
      if (ability && charges(p, ability) > 0 && entry && entry.nextZone === "a-site" && entry.nextArrivalMs <= 1500) {
        return { kind: "useAbility", abilityId: ability, targetZone: "a-site" };
      }
      return undefined;
    }
    // The entry waits one decision for the smoke, then goes.
    return v.timeRemainingMs > 9500 ? undefined : { kind: "move", targetZone: "a-site", moveMode: "run" };
  }, views);
  const defense = scripted(() => ({ kind: "hold", aimZone: o.holderAim ?? "a-main" }));
  // With no smoke the two would meet across the open sightline on tick 0; keep them apart until the
  // entry moves by starting `atk` one zone back in that case — the control is the ordinary fight.
  const state = scene([
    player("atk", "attack", "a-main"),
    player("smk", "attack", "a-lobby", [SMOKE]),
    player("sup", "attack", "a-main", [FLASH, RECON]),
    player("def", "defense", "a-site"),
  ], 10_000, "atk");
  const result = new RoundSimulator({
    spatial, weapons, abilities: catalog, policies: { attack, defense },
    config: { seed: o.seed ?? 3, roundTimeMs: 10_000, traceCommands: true },
  }).runRound(state);
  const duel = (result.engagementTrace ?? []).find((e) => e.attackerId === "atk" && e.defenderId === "def");
  return { result, duel, views };
}
const need = (d: EngagementRecord | undefined): EngagementRecord => { expect(d).toBeDefined(); return d!; };

describe("smoke is passable — and what happens on the far side follows from who can see", () => {
  it("the pusher walks THROUGH the smoked zone and reaches the holder's zone", () => {
    const { duel } = run();
    const d = need(duel);
    expect(d.attackerZone).toBe("a-site"); // contact is on the site, not across the (cut) sightline
    expect(d.smokeExit).toEqual({ attacker: true, defender: false, watched: true });
  });

  it("counterfactual — smoke: without it the same two meet across the open sightline instead", () => {
    const withSmoke = need(run({ smoke: true }).duel);
    const noSmoke = need(run({ smoke: false }).duel);
    expect(noSmoke.attackerZone).toBe("a-main"); // seen as soon as the sightline is open
    expect(noSmoke.smokeExit).toBeUndefined();
    expect(noSmoke.elapsedMs).toBeLessThan(withSmoke.elapsedMs); // the smoke bought the approach
    expect(withSmoke.distanceMeters).toBeLessThan(noSmoke.distanceMeters);
  });

  it("an unassisted exit is a gamble: the holder watching the edge sees first and is pre-aimed", () => {
    const d = need(run().duel);
    expect(d.firstSight).toBe("defender");
    expect(d.attackerSawDefender).toBe(false);
    expect(d.defenderPreAim).toBe(true);
    expect(d.info?.attacker).toBe(false); // no call on the holder → the full surprise delay
    // The pusher's sight delay is the corner geometry with the occluder at its own body
    // (run speed × the rifle's movement multiplier).
    const speed = 675 * (weapons["Vandal"]!.runSpeedMultiplier ?? 1);
    expect(d.angleDelayMs).toEqual({ attacker: smokeExitDelayMs(speed), defender: 0 });
  });

  it("counterfactual — the holder looks away: nobody was holding the edge, so nobody saw first", () => {
    const d = need(run({ holderAim: "a-rafters" }).duel);
    expect(d.smokeExit).toEqual({ attacker: true, defender: false, watched: false });
    // With real positions a holder facing A Rafters has the entry outside its field of view: it is
    // not the one who sees first (zone-centre positions used to make this exactly "mutual").
    expect(["mutual", "attacker"]).toContain(d.firstSight);
    expect(d.defenderPreAim).toBe(false);
  });

  it("counterfactual — a flash on the holder: a blinded holder is not watching, the pusher sees first", () => {
    const plain = need(run().duel);
    const flashed = need(run({ support: "flash" }).duel);
    expect(plain.defenderFlashedMs).toBe(0);
    expect(flashed.defenderFlashedMs).toBeGreaterThan(0); // still blind when the entry appears
    expect(flashed.firstSight).toBe("attacker");
    expect(flashed.defenderPreAim).toBe(false);
    expect(flashed.smokeExit?.watched).toBe(false);
    // Same walk, same tick: only the flash differs.
    expect(flashed.elapsedMs).toBe(plain.elapsedMs);
  });

  it("counterfactual — a fresh recon call: the pusher still does not see first, but comes out pre-aimed", () => {
    const plain = need(run().duel);
    const called = need(run({ support: "recon" }).duel);
    expect(called.firstSight).toBe("defender"); // sight is unchanged …
    expect(plain.info?.attacker).toBe(false);
    expect(called.info?.attacker).toBe(true); // … the information is not: the surprise delay is
    // discounted by the call's freshness and the holder loses its free pre-aim (see the outcome test).
    expect(called.elapsedMs).toBe(plain.elapsedMs);
  });

  it("the outcome follows the information: over many seeds the gamble loses, the flashed exit wins", () => {
    const wins = (o: Opts): number => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) if (need(run({ ...o, seed }).duel).winnerSide === "attack") n++;
      return n / 40;
    };
    const gamble = wins({});
    const called = wins({ support: "recon" });
    const flashed = wins({ support: "flash" });
    console.log(`[smoke exit] attacker wins the exit duel: unassisted ${gamble}, recon call ${called}, flash ${flashed}`);
    expect(gamble).toBeLessThan(0.35); // a gamble, not a wall and not a fair fight
    expect(gamble).toBeGreaterThan(0); // … and not a guaranteed loss either
    expect(called).toBeGreaterThan(gamble); // information alone already shifts it
    expect(flashed).toBeGreaterThan(0.85); // the flash is what makes it a play
  });

  it("the timing input is the team's own movement: the view carries the entry's route and ETA", () => {
    const { views } = run();
    const moving = views.filter((v) => v.side === "attack").map((v) => v.teammates.find((t) => t.id === "atk")?.transit).filter((t) => t !== undefined);
    expect(moving.length).toBeGreaterThan(2);
    expect(moving[0]!.nextZone).toBe("a-site");
    expect(moving[0]!.path).toEqual(["a-site"]);
    // The ETA counts down as the entry crosses.
    for (let i = 1; i < moving.length; i++) expect(moving[i]!.nextArrivalMs).toBeLessThan(moving[i - 1]!.nextArrivalMs);
  });

  it("same seed and state → the identical round", () => {
    expect(run({ support: "flash", seed: 11 }).result).toEqual(run({ support: "flash", seed: 11 }).result);
    expect(run({ seed: 11 }).result).toEqual(run({ seed: 11 }).result);
  });
});

describe("smoke-exit delay is the corner geometry's limit, not a new constant", () => {
  it("equals angleAdvantageDelays as the peeker's corner distance goes to zero", () => {
    const limit = angleAdvantageDelays(1e-6, 1500, 675).peekerMs;
    expect(smokeExitDelayMs(675)).toBeCloseTo(limit, 3);
    expect(smokeExitDelayMs(675)).toBeCloseTo((BODY_HALF_WIDTH / 675) * 1000, 6);
    expect(smokeExitDelayMs(340)).toBeGreaterThan(smokeExitDelayMs(675)); // walking out is slower to clear
  });
});
