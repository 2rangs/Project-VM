/**
 * Per-player economy (EC-01/02/03/05): rules, plans and counterfactuals that check direction AND size.
 */
import { describe, expect, it } from "vitest";
import { roundWinBelief } from "@pv/economy-engine";
import {
  decideTeamBuy,
  floorAfterRound,
  newTeamEconomy,
  postRoundPickups,
  saveWorth,
  settleRound,
  type BuyContext,
  type PlayerEconomy,
  type TeamEconomy,
} from "../src/economy.js";
import { runMatch, simulatableTeamRefs, type MatchConfig, type MatchResult } from "../src/index.js";
import { armorMatchedPrice } from "../src/weapon-worth.js";
import { loadUltOrbs, loadWeapons } from "../src/setup.js";

const AGENTS = ["omen", "sova", "kayo", "killjoy", "jett"];
const CTX = AGENTS.map((agent, i) => ({ agent, priority: 0.6 + 0.01 * i }));
const RIFLES = new Set(["Vandal", "Phantom", "Operator"]);

function eco(credits: readonly number[], extra: Partial<PlayerEconomy>[] = [], losses = 0): TeamEconomy {
  const players = credits.map((c, i) => ({ credits: c, weapon: null, armor: 0, ultPoints: 0, ...(extra[i] ?? {}) }));
  return { ...newTeamEconomy(), players, credits: credits.reduce((a, b) => a + b, 0), consecutiveLosses: losses, ultPoints: players.reduce((s, p) => s + p.ultPoints, 0) };
}
const five = (c: number) => [c, c, c, c, c];
const RICH = eco(five(6000));
const buy = (own: TeamEconomy, extra: Partial<BuyContext> = {}) =>
  decideTeamBuy({ roundNumber: 5, score: [2, 2], own, opp: RICH, ownPlayers: CTX, oppPlayers: CTX, pistol: false, ...extra });
const rifles = (b: ReturnType<typeof buy>) => b.players.filter((p) => RIFLES.has(p.weapon)).length;

describe("per-player economy rules", () => {
  it("survivors keep weapon and shield; the dead keep nothing; credits are capped per player", () => {
    const next = settleRound(eco(five(8_500)), {
      won: true, planted: false, attacking: false,
      players: [
        { alive: true, kills: 2, weaponAfter: "Vandal", armorRetained: 50, ultimatePointsEnd: 3 },
        { alive: false, kills: 0, weaponAfter: null, armorRetained: 0, ultimatePointsEnd: 1 },
        { alive: true, kills: 0, weaponAfter: "Classic", armorRetained: 25, ultimatePointsEnd: 0 },
        { alive: false, kills: 1, weaponAfter: null, armorRetained: 0, ultimatePointsEnd: 2 },
        { alive: true, kills: 0, weaponAfter: "Spectre", armorRetained: 0, ultimatePointsEnd: 0 },
      ],
    });
    expect(next.players.map((p) => p.weapon)).toEqual(["Vandal", null, null, null, "Spectre"]);
    expect(next.players.map((p) => p.armor)).toEqual([50, 0, 25, 0, 0]);
    expect(next.players.every((p) => p.credits === 9_000)).toBe(true); // 8500 + 3000 → cap
  });

  it("the loss bonus climbs the ladder per player (1900 → 2400 → 2900) and resets on a win", () => {
    const dead = { alive: false, kills: 0, weaponAfter: null, armorRetained: 0, ultimatePointsEnd: 0 };
    let e = eco(five(0));
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      e = { ...e, players: e.players.map((p) => ({ ...p, credits: 0 })) }; // spent everything
      const before = 0;
      e = settleRound(e, { won: false, planted: false, attacking: true, players: five(0).map(() => dead) });
      seen.push(e.players[0]!.credits - before);
    }
    expect(seen).toEqual([1900, 2400, 2900, 2900]);
    e = settleRound(e, { won: true, planted: false, attacking: true, players: five(0).map(() => dead) });
    expect(e.consecutiveLosses).toBe(0);
  });

  it("a survivor picks up a better gun off the player they killed", () => {
    const picks = postRoundPickups({
      kills: [{ killer: "atk1", victim: "def1", zoneId: "a-site" }, { killer: "def2", victim: "atk2", zoneId: "mid" }],
      startWeapon: new Map([["def1", "Vandal"], ["atk2", "Classic"]]),
      survivors: new Map([["atk1", "Classic"], ["def2", "Vandal"]]),
    });
    expect(picks).toEqual([{ playerId: "atk1", weapon: "Vandal", from: "def1" }]);
  });
});

describe("buy decisions — counterfactuals (direction and size)", () => {
  it("more credits buy a better loadout: 1000 → 6000 each takes the team from a save to five rifles", () => {
    const values = [1000, 2000, 3000, 4000, 5000, 6000].map((c) => buy(eco(five(c), [], 1)));
    for (let i = 1; i < values.length; i++) expect(values[i]!.loadoutValue).toBeGreaterThanOrEqual(values[i - 1]!.loadoutValue);
    expect(values[0]!.loadoutValue).toBeLessThan(5_000); // VCT eco
    expect(rifles(values[5]!)).toBe(5);
    expect(values[5]!.tier).toBe("full");
    expect(values[5]!.loadoutValue).toBeGreaterThanOrEqual(20_000); // VCT full
  });

  it("a drop rifles a poor player: +1 rifle, paid by the richest teammate, and a higher round-win belief", () => {
    const withDonors = buy(eco([9_000, 9_000, 9_000, 9_000, 800]));
    const noDonors = buy(eco([4_000, 4_000, 4_000, 4_000, 800]));
    const poor = withDonors.players[4]!;
    expect(poor.weapon).toBe("Vandal");
    expect(poor.weaponSource).toBe("dropped");
    expect(withDonors.drops).toBe(1);
    expect(withDonors.players[poor.droppedBy!]!.spent).toBeGreaterThanOrEqual(2_900);
    expect(RIFLES.has(noDonors.players[4]!.weapon)).toBe(false);
    expect(rifles(withDonors) - rifles(noDonors)).toBeGreaterThanOrEqual(1);
    const gain = roundWinBelief(withDonors.loadoutValue, 22_800) - roundWinBelief(noDonors.loadoutValue, 22_800);
    expect(gain).toBeGreaterThan(0.02);
  });

  it("a bonus round keeps the won guns and buys no new weapons", () => {
    const own = eco(five(1_500), AGENTS.map(() => ({ weapon: "Spectre", armor: 25 })));
    const opp = eco(five(2_400), [], 2);
    const b = decideTeamBuy({ roundNumber: 3, score: [2, 0], own, opp, ownPlayers: CTX, oppPlayers: CTX, pistol: false, wonLastRound: true });
    expect(b.tier).toBe("bonus");
    expect(b.players.every((p) => p.weapon === "Spectre" && p.weaponSource === "kept")).toBe(true);
    expect(b.players.every((p) => p.spent <= 1_000)).toBe(true); // shields at most
    // Without the kept guns the same credits field far less.
    const bare = decideTeamBuy({ roundNumber: 3, score: [2, 0], own: eco(five(1_500)), opp, ownPlayers: CTX, oppPlayers: CTX, pistol: false, wonLastRound: true });
    expect(b.loadoutValue - bare.loadoutValue).toBeGreaterThan(4_000);
  });

  it("ultimate readiness changes buy timing: a team on 3000 each saves without ults and buys with five ready", () => {
    const noUlt = buy(eco(five(3_000), [], 1), { abilities: true });
    const ults = buy(eco(five(3_000), AGENTS.map(() => ({ ultPoints: 9 })), 1), { abilities: true });
    expect(noUlt.tier).toBe("eco"); // a save: the sidearms eco (ecoSidearms default on)
    expect(ults.tier).not.toBe("eco");
    expect(ults.cost).toBeGreaterThan(noUlt.cost);
    // With abilities off an ultimate does nothing in the sim, so it does not move the buy.
    const off = buy(eco(five(3_000), AGENTS.map(() => ({ ultPoints: 9 })), 1));
    expect(off.plan).toBe(noUlt.plan);
  });

  it("an undisciplined team weighs the next round less (team trait as belief)", () => {
    const at = (discipline: number) => buy(eco(five(2_000), [], 1), { ownTraits: { discipline, gameSense: 0.6 } });
    const ev = (b: ReturnType<typeof buy>, plan: string) => b.evaluation.find((e) => e.plan === plan && !e.ultHold)!.value;
    // The gap between buying now and saving grows as discipline falls.
    expect(ev(at(0.2), "max") - ev(at(0.2), "sidearms")).toBeGreaterThan(ev(at(1.0), "max") - ev(at(1.0), "sidearms"));
  });
});

describe("round 2 after a pistol win (armor-matched gun worth)", () => {
  it("a gun is worth its price against heavy shields; against an eco's light shield an SMG is worth more", () => {
    expect(armorMatchedPrice("Vandal", 2900, 50)).toBeCloseTo(2900, 6);
    expect(armorMatchedPrice("Spectre", 1600, 50)).toBeCloseTo(1600, 6);
    expect(armorMatchedPrice("Vandal", 2900, 25)).toBeCloseTo(2900, 6); // the reference
    const light = armorMatchedPrice("Spectre", 1600, 25);
    expect(light).toBeGreaterThan(1800); // ≈ 1950: the Spectre's kill time falls ~20% from heavy to light
    expect(light).toBeLessThan(2400);
  });

  it("pistol winners buy SMGs with heavy shields instead of rifles with light ones", () => {
    const at = (credits: number, armorMatchedValue: boolean) => {
      const own = eco(five(credits), AGENTS.map(() => ({ armor: 25 })));
      const opp = eco([2_000, 2_000, 2_000, 2_100, 2_200], [], 1);
      return decideTeamBuy({ roundNumber: 2, score: [1, 0], own, opp, ownPlayers: CTX, oppPlayers: CTX, pistol: false, wonLastRound: true, options: { armorMatchedValue } });
    };
    const credits = [3_400, 3_600, 3_800]; // a pistol winner's credits (at 4000 a rifle + heavy is affordable and is bought)
    const rifleCount = (on: boolean) => credits.reduce((n, c) => n + rifles(at(c, on)), 0);
    // Shop prices: rifles with light shields (15 of 15). Armor-matched: SMG + heavy + kit at every level.
    expect(rifleCount(false)).toBe(15);
    expect(rifleCount(true)).toBe(0);
    expect(credits.every((c) => at(c, true).plan === "smg")).toBe(true);
    const smg = at(3_400, true);
    expect(smg.plan).toBe("smg");
    expect(smg.players.every((p) => p.weapon === "Spectre" && p.armor === 50)).toBe(true);
  });
});

describe("eco: spend what next round does not need (sidearms)", () => {
  const ecoBuy = (credits: number, losses: number, side: "attack" | "defense", ecoSidearms = true) => // the option is off by default
    decideTeamBuy({ roundNumber: 6, score: [2, 3], own: eco(five(credits), [], losses), opp: RICH, ownPlayers: CTX, oppPlayers: CTX, pistol: false, side, options: { ecoSidearms } });

  it("keeps the team's next rifle + heavy buy and spends the rest on sidearms and light shields, star first", () => {
    // 3000 each after two losses: reserve 4000 − 2900 = 1100 each; loadout capped under 5000.
    const b = ecoBuy(3_000, 2, "attack");
    expect(b.tier).toBe("eco");
    expect(b.plan).toBe("sidearms");
    const left = b.players.reduce((s, p) => s + p.creditsAfter, 0);
    expect(left).toBeGreaterThanOrEqual(5_500);
    expect(b.players[4]!.weapon).toBe("Sheriff"); // the star (highest priority in CTX) first
    expect(b.players.filter((p) => p.armor === 25).length).toBeGreaterThanOrEqual(4);
    expect(b.loadoutValue).toBeGreaterThan(3_000);
    expect(b.loadoutValue).toBeLessThan(5_000);
    // The old eco (ecoSidearms false) buys nothing.
    const old = ecoBuy(3_000, 2, "attack", false);
    expect(old.tier).toBe("eco");
    expect(old.players.every((p) => p.weapon === "Classic")).toBe(true);
  });

  it("on defence one player takes a shotgun for a close angle", () => {
    const b = ecoBuy(3_000, 2, "defense");
    const attack = ecoBuy(3_000, 2, "attack");
    const shotguns = (x: typeof b) => x.players.filter((p) => p.weapon === "Bucky" || p.weapon === "Shorty").length;
    expect(b.plan).toBe("sidearms");
    expect(shotguns(b)).toBe(1);
    expect(shotguns(attack)).toBe(0);
  });

  it("a team below its reserve spends nothing", () => {
    // 1500 each after one loss: reserve 4000 − 2400 = 1600 each > 1500 = all of it.
    const b = ecoBuy(1_500, 1, "attack");
    expect(b.tier).toBe("eco");
    expect(b.cost).toBe(0);
  });
});

describe("floor items", () => {
  it("a gun taken off a body mid-round leaves the taker's old gun there; the taker dies with the new one", () => {
    const start = new Map([["atk1", "Vandal"], ["def1", "Spectre"], ["def2", "Classic"]]);
    const floor = floorAfterRound(start, [
      { kind: "kill", actor: "def1", target: "atk1" },
      { kind: "weaponPickup", actor: "def1", target: "atk1", detail: "Vandal|Spectre" },
      { kind: "kill", actor: "atk2", target: "def1" },
    ]);
    expect(floor.get("atk1")).toBe("Spectre"); // what lies on atk1's body now
    expect(floor.get("def1")).toBe("Vandal"); // def1 died holding the Vandal
    expect(floor.get("def2")).toBe("Classic");
  });

  it("weapon modes (Classic burst, run-and-gun accuracy) are off unless MatchConfig.weaponModes", () => {
    expect(loadWeapons().Classic!.altFire).toBeUndefined();
    expect(loadWeapons().Classic!.movingAccuracy).toBeUndefined();
    expect(loadWeapons({ modes: true }).Classic!.altFire?.useWithinMeters).toBe(3);
    expect(loadWeapons().Bucky!.pellets).toBe(15); // a shotgun keeps its pellets
  });

  it("orb points come from the map's objects file (zone-level, unverified): two on Ascent, four on Fracture, empty for an unknown map", () => {
    const ascent = loadUltOrbs("ascent");
    expect(ascent).toHaveLength(2);
    for (const o of ascent) for (const v of [o.position.x, o.position.y, o.position.z]) expect(Number.isFinite(v)).toBe(true);
    expect(loadUltOrbs("abyss")).toHaveLength(2); // filled from ULT_ORBS.md §1 (wiki markers + guides)
    expect(loadUltOrbs("fracture")).toHaveLength(4); // the only four-orb map
    expect(loadUltOrbs("no-such-map")).toEqual([]);
  });

  it("ultimate-orb pickup is off by default and opt-in via MatchConfig.ultOrbs (guns stay picked up either way)", () => {
    const teams = simulatableTeamRefs();
    const cfg = (extra: Partial<MatchConfig>): MatchConfig => ({ teamA: teams[0]!, teamB: teams[1]!, map: "Ascent", seed: 1, ...extra });
    const orbEvents = (r: MatchResult) => r.rounds.reduce((n, x) => n + x.events.filter((e) => (e.kind as string) === "orbPickup").length, 0);
    const gunEvents = (r: MatchResult) => r.rounds.reduce((n, x) => n + x.events.filter((e) => (e.kind as string) === "weaponPickup").length, 0);
    const def = runMatch(cfg({}));
    const on = runMatch(cfg({ ultOrbs: true }));
    expect(orbEvents(def)).toBe(0); // default: no orb pickups, even though Ascent has orb points
    expect(orbEvents(on)).toBeGreaterThan(0); // opt-in: orbs are taken
    expect(gunEvents(def)).toBeGreaterThan(0); // guns are still picked up with orbs off
  });
});

describe("save worth (per-player credits)", () => {
  it("a gun is worth a save only to a player who could not buy it back next round", () => {
    // Next loss bonus 1900; a rifle + heavy shield costs 3900.
    // Size: a player left with 2000+ after a rifle buy plays the round out; one left with ~0 saves.
    const rich = saveWorth(eco(five(9_000), [], 0), buy(eco(five(9_000), [], 0)));
    const poor = saveWorth(eco(five(3_900), [], 0), buy(eco(five(3_900), [], 0)));
    expect(rich.every((w) => !w)).toBe(true);
    expect(poor.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});

describe("saving players (match level)", () => {
  const teams = simulatableTeamRefs();
  const run = (seed: number, tuning?: MatchConfig["tuning"]): MatchResult =>
    runMatch({ teamA: teams[2 * seed]!, teamB: teams[2 * seed + 1]!, map: "Ascent", seed, ...(tuning ? { tuning } : {}) });

  it("a saving attack gives lost rounds up and carries its guns into the next buy", () => {
    const tally = (ms: MatchResult[]) => {
      let lost = 0, saves = 0, keptNext = 0;
      for (const m of ms) {
        m.rounds.forEach((r, k) => {
          const atk = r.attacker;
          if (r.winner === atk) return;
          lost++;
          if (r.decisions.plans[atk]?.revisions.some((v) => v.to === "save")) saves++;
          const next = m.rounds[k + 1];
          if (next && next.phase === "regulation" && next.roundNumber !== 13) keptNext += next.buys[atk].players.filter((p) => p.weaponSource === "kept").length;
        });
      }
      return { lost, saves, keptPerLost: keptNext / lost };
    };
    const seeds = [1, 2, 3, 4, 5, 6];
    const saving = tally(seeds.map((s) => run(s)));
    const never = tally(seeds.map((s) => run(s, { attackSaveMinWinChance: 0 })));
    expect(saving.saves).toBeGreaterThan(0);
    expect(never.saves).toBe(0);
    expect(saving.keptPerLost).toBeGreaterThanOrEqual(never.keptPerLost);
    // Size (seeds 1–6, round-2 SMG buys and mid-round pickups, 2026-11-24): 2 saves in 60 lost rounds;
    // guns kept into the next buy 0.133 vs 0.131 per lost round (60 and 61 lost rounds). Saves are
    // rare: a Spectre (1600) is below saveMinWeaponValue and a gun its holder can rebuy is not worth
    // saving (saveWorth); kept guns now also come from mid-round pickups by survivors. History:
    // seeds 1–3 on 1ed75c7: 2 saves in 36, 0.083 vs 0.048.
  }, 240_000);
});
