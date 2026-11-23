/**
 * Per-player economy (EC-01/02/03/05): rules, plans and counterfactuals that check direction AND size.
 */
import { describe, expect, it } from "vitest";
import { roundWinBelief } from "@pv/economy-engine";
import {
  decideTeamBuy,
  newTeamEconomy,
  postRoundPickups,
  settleRound,
  type BuyContext,
  type PlayerEconomy,
  type TeamEconomy,
} from "../src/economy.js";
import { runMatch, simulatableTeamRefs, type MatchConfig, type MatchResult } from "../src/index.js";

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

  it("ultimate readiness changes buy timing: a team on 2000 each saves without ults and buys with five ready", () => {
    const noUlt = buy(eco(five(2_000), [], 1), { abilities: true });
    const ults = buy(eco(five(2_000), AGENTS.map(() => ({ ultPoints: 9 })), 1), { abilities: true });
    expect(noUlt.plan).toBe("eco");
    expect(ults.plan).not.toBe("eco");
    expect(ults.cost).toBeGreaterThan(noUlt.cost);
    // With abilities off an ultimate does nothing in the sim, so it does not move the buy.
    const off = buy(eco(five(2_000), AGENTS.map(() => ({ ultPoints: 9 })), 1));
    expect(off.plan).toBe(noUlt.plan);
  });

  it("an undisciplined team weighs the next round less (team trait as belief)", () => {
    const at = (discipline: number) => buy(eco(five(2_000), [], 1), { ownTraits: { discipline, gameSense: 0.6 } });
    const ev = (b: ReturnType<typeof buy>, plan: string) => b.evaluation.find((e) => e.plan === plan && !e.ultHold)!.value;
    // The gap between buying now and saving grows as discipline falls.
    expect(ev(at(0.2), "max") - ev(at(0.2), "eco")).toBeGreaterThan(ev(at(1.0), "max") - ev(at(1.0), "eco"));
  });
});

describe("saving players (match level)", () => {
  const teams = simulatableTeamRefs();
  const run = (seed: number, tuning?: MatchConfig["tuning"]): MatchResult =>
    runMatch({ teamA: teams[2 * seed]!, teamB: teams[2 * seed + 1]!, map: "Ascent", seed, ...(tuning ? { tuning } : {}) });

  it("a saving attack survives lost rounds more often and carries its guns into the next buy", () => {
    const tally = (ms: MatchResult[]) => {
      let lost = 0, survivors = 0, keptNext = 0;
      for (const m of ms) {
        m.rounds.forEach((r, k) => {
          const atk = r.attacker;
          if (r.winner === atk) return;
          lost++;
          survivors += r.economy[atk].players.filter((p) => p.weapon !== null).length; // armed survivors
          const next = m.rounds[k + 1];
          if (next && next.phase === "regulation" && next.roundNumber !== 13) keptNext += next.buys[atk].players.filter((p) => p.weaponSource === "kept").length;
        });
      }
      return { lost, perLost: survivors / lost, keptPerLost: keptNext / lost };
    };
    const seeds = [1, 2, 3];
    const saving = tally(seeds.map((s) => run(s)));
    const never = tally(seeds.map((s) => run(s, { attackSaveMinWinChance: 0 })));
    expect(saving.perLost).toBeGreaterThan(never.perLost);
    expect(saving.keptPerLost).toBeGreaterThan(never.keptPerLost);
    // Size (seeds 1–3, 2026-11-23): armed survivors per lost round 0.095 vs 0, guns kept into the
    // next buy 0.071 vs 0 (42 and 46 lost rounds).
    expect(saving.keptPerLost).toBeGreaterThan(0.04);
  }, 120_000);
});
