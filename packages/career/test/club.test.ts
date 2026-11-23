// Club operations: contracts, finance over several seasons, transfer decisions (counterfactual),
// loans, renewals and expiry, training focus → development direction, map practice → mastery,
// and the club layer running inside real careers (career mode's calendar, inbox and season end).
import { describe, it, expect, beforeAll } from "vitest";
import { mapMastery } from "@pv/match-runner";
import { getTeamMapRecords } from "@pv/game-data";
import { worldFromGameData } from "../src/game-data.ts";
import {
  CLUB_MODEL, ABILITY_KEYS, MECHANICAL_KEYS, advanceSeason, answerCounter, askingPrice, clubAnswer, clubSalary, clubSeasonEnd,
  answerInbox, batchOf, continueCareer, newCareer, quickSeries, recordResult, seriesRequest, type CareerState,
  estimateAbility, focusFactors, initClub, makeOffer, marketWage, playerAnswer, playerUtility,
  practiceAdjustedRecords, releasePlayer, reputations, seasonFocus, serializeWorld, setIndividualFocus, setTrainingPlan, teamScout, teamStrength,
  trainingWeek, wageBill, weeklyVector, windowStatus, type World, type WorldPlayer, type RatedAttr, type OfferTerms,
} from "../src/index.ts";

const SEED = 4242;
const M = CLUB_MODEL;
let base: World;
let club: World;
let user: string;

const strongestTeams = (w: World): string[] => Object.keys(w.teams).sort((a, b) => teamStrength(w, b) - teamStrength(w, a) || a.localeCompare(b));

beforeAll(() => {
  base = worldFromGameData(SEED);
  // The user manages a mid-table team with a full roster.
  const ids = strongestTeams(base).filter((id) => base.teams[id]!.roster.length >= 5 && base.teams[id]!.roster.length < 8);
  user = ids[Math.floor(ids.length / 2)]!;
  club = initClub(base, { userTeamId: user, date: `${base.season}-01-05` });
});

describe("contracts", () => {
  it("every rostered player and employed staff member has a contract; free agents have none", () => {
    const c = club.club!.contracts;
    for (const t of Object.values(club.teams)) {
      for (const id of t.roster) expect(c[id]?.teamId, `player ${id}`).toBe(t.teamId);
      for (const id of t.academy) expect(c[id]?.squadRole).toBe("academy");
      for (const sid of Object.values(t.staff)) if (sid) expect(c[sid]?.kind).toBe("staff");
    }
    for (const p of Object.values(club.players)) if (p.status === "free") expect(c[p.playerId]).toBeUndefined();
  });

  it("real players' salaries follow the stated formula and sit in a plausible band", () => {
    const rep = reputations(club);
    const salaries: number[] = [];
    for (const ct of Object.values(club.club!.contracts)) {
      if (ct.kind !== "player" || ct.squadRole === "academy") continue;
      const p = club.players[ct.personId]!;
      const t = club.teams[ct.teamId]!;
      const est = estimateAbility(club, teamScout(club, t.teamId), p);
      expect(ct.salary).toBe(clubSalary(marketWage(club, p, t.region, est), rep[t.teamId]!));
      expect(ct.endSeason - ct.startSeason + 1).toBeGreaterThanOrEqual(1);
      expect(ct.endSeason - ct.startSeason + 1).toBeLessThanOrEqual(M.maxContractYears);
      expect(ct.buyout!).toBeGreaterThanOrEqual(ct.salary);
      salaries.push(ct.salary);
    }
    salaries.sort((a, b) => a - b);
    expect(salaries[0]!).toBeGreaterThanOrEqual(M.wageFloor * 0.8 * 0.85);
    expect(salaries[salaries.length - 1]!).toBeLessThan(600_000);
    const median = salaries[Math.floor(salaries.length / 2)]!;
    expect(median).toBeGreaterThan(50_000);
    expect(median).toBeLessThan(250_000);
  });

  it("a better player is paid more (same club)", () => {
    const t = club.teams[user]!;
    const [a, b] = [club.players[t.roster[0]!]!, club.players[t.roster[t.roster.length - 1]!]!];
    expect(marketWage(club, a, t.region)).toBeGreaterThanOrEqual(marketWage(club, b, t.region));
  });

  it("expired contracts leave at season end; a renewal keeps the player", () => {
    let w = club;
    const mine = w.teams[user]!.roster.map((id) => w.club!.contracts[id]!);
    const expiring = mine.filter((c) => c.endSeason === w.season);
    // Force two expiring contracts so the test does not depend on the draw.
    const [keep, go] = [mine[0]!, mine[1]!];
    w = structuredClone(w);
    w.club!.contracts[keep.personId]!.endSeason = w.season;
    w.club!.contracts[go.personId]!.endSeason = w.season;
    const terms: OfferTerms = { fee: 0, wage: Math.round(keep.salary * 1.5), years: 2 };
    const r = makeOffer(w, { playerId: keep.personId, toTeamId: user, kind: "renewal", terms });
    expect(r.offer?.status).toBe("completed");
    w = r.world;
    expect(w.club!.contracts[keep.personId]!.endSeason).toBe(w.season + 1);
    const next = clubSeasonEnd(w);
    expect(next.players[keep.personId]?.teamId ?? "retired").toMatch(new RegExp(`${user}|retired`));
    const gone = next.players[go.personId];
    if (gone) expect(gone.teamId === user && next.club!.contracts[go.personId]?.startSeason !== w.season).toBe(false);
    expect(next.club!.transfers.some((x) => x.playerId === go.personId && x.kind === "expiry")).toBe(true);
    void expiring;
  });
});

describe("transfer decisions follow the utilities (counterfactual)", () => {
  // A target: an AI club's starter in the user's region.
  let target: WorldPlayer;
  beforeAll(() => {
    const region = club.teams[user]!.region;
    const pool = Object.values(club.teams).filter((t) => t.teamId !== user && t.region === region && t.roster.length >= 6);
    target = club.players[pool[0]!.roster[1]!]!;
  });

  it("the window is open on the test date", () => {
    expect(windowStatus(club.club!.date).open).toBe(true);
    expect(windowStatus(`${club.season}-03-10`).open).toBe(false);
  });

  it("selling club: accept at the asking price, counter just below, reject far below, accept at the buyout", () => {
    const asking = askingPrice(club, target);
    const terms = (fee: number) => ({ kind: "transfer" as const, playerId: target.playerId, terms: { fee, wage: 100_000, years: 2 } });
    expect(clubAnswer(club, terms(asking)).decision).toBe("accept");
    const c = clubAnswer(club, terms(Math.round(asking * 0.8)));
    expect(c.decision).toBe("counter");
    expect(c.counter!.fee).toBe(asking);
    expect(clubAnswer(club, terms(Math.round(asking * (M.counterShare - 0.1)))).decision).toBe("reject");
    const buyout = club.club!.contracts[target.playerId]!.buyout!;
    if (buyout < asking * M.counterShare) expect(clubAnswer(club, terms(buyout)).decision).toBe("accept");
  });

  it("player: more wage raises the utility; a stronger club beats a weaker one at the same wage", () => {
    const t = { fee: 0, wage: 120_000, years: 2 };
    const lo = playerUtility(club, target, "transfer", user, t);
    const hi = playerUtility(club, target, "transfer", user, { ...t, wage: 240_000 });
    expect(hi.total - lo.total).toBeCloseTo(M.wWage * Math.log(2), 6);
    const ranked = strongestTeams(club).filter((id) => id !== target.teamId);
    const strong = playerUtility(club, target, "transfer", ranked[0]!, t);
    const weak = playerUtility(club, target, "transfer", ranked[ranked.length - 1]!, t);
    expect(strong.ambition).toBeGreaterThan(weak.ambition);
  });

  it("player: accepts when U ≥ 0, counters with the wage that makes U = margin, refuses beyond maxCounterRaise", () => {
    const ref = playerUtility(club, target, "transfer", user, { fee: 0, wage: 100_000, years: 2 });
    // The wage at which U = 0 for this move.
    const w0 = 100_000 * Math.exp(-ref.total / M.wWage);
    const offer = (wage: number) => ({ kind: "transfer" as const, playerId: target.playerId, toTeamId: user, terms: { fee: 0, wage: Math.round(wage), years: 2 } });
    expect(playerAnswer(club, offer(w0 * 1.05)).decision).toBe("accept");
    const c = playerAnswer(club, offer(w0 * 0.8));
    expect(c.decision).toBe("counter");
    expect(playerAnswer(club, { ...offer(w0 * 0.8), terms: c.counter! }).decision).toBe("accept");
    expect(playerAnswer(club, offer(w0 / (M.maxCounterRaise * 1.2))).decision).toBe("reject");
  });

  it("make an offer → club counter → accept the counter → the player joins the roster and the money moves", () => {
    let w = structuredClone(club);
    w.club!.finances[user]!.transferBudget = 50_000_000;
    if (w.teams[user]!.roster.length >= 8) w.teams[user]!.roster.pop();
    const asking = askingPrice(w, target);
    const from = target.teamId!;
    const r = makeOffer(w, { playerId: target.playerId, toTeamId: user, kind: "transfer", terms: { fee: Math.round(asking * 0.8), wage: 1_500_000, years: 2 } });
    expect(r.error).toBeNull();
    expect(r.offer!.status).toBe("countered");
    w = answerCounter(r.world, r.offer!.id, true);
    const o = w.club!.offers.find((x) => x.id === r.offer!.id)!;
    expect(o.status).toBe("completed");
    expect(w.players[target.playerId]!.teamId).toBe(user);
    expect(w.teams[user]!.roster).toContain(target.playerId);
    expect(w.teams[from]!.roster).not.toContain(target.playerId);
    expect(w.club!.contracts[target.playerId]!.teamId).toBe(user);
    expect(w.club!.contracts[target.playerId]!.salary).toBe(1_500_000);
    expect(w.club!.finances[user]!.balance).toBe(club.club!.finances[user]!.balance - asking);
    expect(w.club!.finances[from]!.balance).toBe(club.club!.finances[from]!.balance + asking);
  });

  it("offers are blocked outside the window, over budget, and when the squad is full", () => {
    const req = { playerId: target.playerId, toTeamId: user, kind: "transfer" as const, terms: { fee: 1, wage: 100_000, years: 2 } };
    expect(makeOffer(club, req, `${club.season}-03-10`).error).toBe("windowClosed");
    expect(makeOffer(club, { ...req, terms: { ...req.terms, fee: 1e12 } }).error).toBe("overBudget");
    const full = structuredClone(club);
    while (full.teams[user]!.roster.length < 8) full.teams[user]!.roster.push(`ghost-${full.teams[user]!.roster.length}`);
    expect(makeOffer(full, req).error).toBe("squadFull");
  });

  it("loans: a bench player joins for the season and returns at its end", () => {
    let w = structuredClone(club);
    const region = w.teams[user]!.region;
    const lender = Object.values(w.teams).find((t) => t.teamId !== user && t.region === region && t.roster.length >= 7)!;
    const benchId = lender.roster[lender.roster.length - 1]!;
    if (w.teams[user]!.roster.length >= 8) w.teams[user]!.roster.pop();
    const low = makeOffer(w, { playerId: benchId, toTeamId: user, kind: "loan", terms: { fee: 0, wage: 0, years: 1, wageShare: 0.2 } });
    expect(low.offer!.status).toBe("countered");
    const r = makeOffer(w, { playerId: benchId, toTeamId: user, kind: "loan", terms: { fee: 0, wage: 0, years: 1, wageShare: 0.8 } });
    if (r.offer!.status !== "completed") {
      // The player did not see more playing time with us: the utility says so.
      expect(r.offer!.utility!.total).toBeLessThan(0);
      return;
    }
    w = r.world;
    expect(w.players[benchId]!.teamId).toBe(user);
    expect(w.club!.contracts[benchId]!.teamId).toBe(lender.teamId);
    const next = clubSeasonEnd(w);
    const back = next.players[benchId];
    if (back && back.teamId) expect(back.teamId).not.toBe(user);
  });

  it("a released player cannot be re-signed by the same club in the same season", () => {
    const id = club.teams[user]!.roster[club.teams[user]!.roster.length - 1]!;
    const w = releasePlayer(club, id);
    expect(w.players[id]!.status).toBe("free");
    expect(w.club!.finances[user]!.balance).toBeLessThan(club.club!.finances[user]!.balance);
    expect(makeOffer(w, { playerId: id, toTeamId: user, kind: "free", terms: { fee: 0, wage: 1_000_000, years: 1 } }).error).toBe("releasedHere");
  });

  it("a starter is not loaned out", () => {
    const starterId = club.teams[target.teamId!]!.roster[0]!;
    expect(clubAnswer(club, { kind: "loan", playerId: starterId, terms: { fee: 0, wage: 0, years: 1, wageShare: 1 } }).decision).toBe("reject");
  });
});

describe("training", () => {
  it("balanced training under the fatigue threshold leaves development exactly as it was", () => {
    const x = { mechanics: weeklyVector("balanced", "balanced").mechanics, utility: weeklyVector("balanced", "balanced").utility, teamplay: weeklyVector("balanced", "balanced").teamplay };
    for (const v of Object.values(focusFactors(x)!)) expect(v).toBeCloseTo(1, 12);
    // No plan → no focus → advanceSeason is unchanged.
    expect(seasonFocus(club)).toEqual({});
    const a = advanceSeason(club);
    const b = advanceSeason(club, { focus: {} });
    expect(serializeWorld(a)).toBe(serializeWorld(b));
  });

  it("focus moves development toward the focused group (same world, same seed)", () => {
    // A young player of the user's team with room to grow in every group.
    const young = club.teams[user]!.roster.map((id) => club.players[id]!).sort((a, b) => a.age - b.age)[0]!;
    const run = (focus: "mechanics" | "teamplay") => {
      let w = setTrainingPlan(club, user, { teamFocus: focus });
      w = setIndividualFocus(w, user, young.playerId, focus);
      w = structuredClone(w);
      for (let i = 0; i < 40; i++) {
        trainingWeek(w, `${w.season}-02-01`);
        // A rest week every 6 weeks keeps fatigue under the threshold.
        if (i % 6 === 5) { w.club!.training.plans[user]!.teamFocus = "rest"; trainingWeek(w, "x"); w.club!.training.plans[user]!.teamFocus = focus; }
      }
      return advanceSeason(w, { focus: seasonFocus(w) }).players[young.playerId]!;
    };
    const mech = run("mechanics");
    const team = run("teamplay");
    const before = club.players[young.playerId]!;
    const gain = (p: WorldPlayer, keys: readonly string[]) => keys.reduce((s, k) => s + (p.attributes![k] as RatedAttr).value - (before.attributes![k] as RatedAttr).value, 0);
    const mechKeys = MECHANICAL_KEYS;
    const teamKeys = ["trading", "consistency"];
    expect(gain(mech, mechKeys)).toBeGreaterThan(gain(team, mechKeys));
    expect(gain(team, teamKeys)).toBeGreaterThan(gain(mech, teamKeys));
    expect(ABILITY_KEYS.length).toBe(8);
  });

  it("fatigue: training without rest lowers the exposure a week yields", () => {
    const w = structuredClone(setTrainingPlan(club, user, { teamFocus: "mechanics" }));
    for (let i = 0; i < 30; i++) trainingWeek(w, "x");
    const id = club.teams[user]!.roster[0]!;
    const e = w.club!.training.exposure[id]!;
    expect(e.fatigue).toBeGreaterThan(M.fatigueFree);
    expect(e.mechanics / e.weeks).toBeLessThan(weeklyVector("mechanics", "balanced").mechanics);
  });

  it("tactics weeks on a map raise the continuity input of map mastery", () => {
    const map = "Ascent";
    let w = setTrainingPlan(club, user, { teamFocus: "tactics", map });
    w = structuredClone(w);
    for (let i = 0; i < 4; i++) trainingWeek(w, "x");
    const lineup = w.teams[user]!.roster.slice(0, 5);
    const baseRecords = getTeamMapRecords(user);
    const adj = practiceAdjustedRecords(w, user, baseRecords);
    const before = mapMastery({ teamId: user, map, lineup, records: baseRecords });
    const after = mapMastery({ teamId: user, map, lineup, records: adj as typeof baseRecords });
    expect(after.continuity.value).toBeGreaterThanOrEqual(before.continuity.value);
    expect(after.history.value).toBe(before.history.value);
    expect(after.compFit.value).toBe(before.compFit.value);
    const pg = w.club!.training.mapPractice[user]![map]!;
    for (const id of lineup) expect(pg[id]).toBeCloseTo(4 * M.scrimMapsPerWeek * M.scrimWeight, 6);
  });
});

describe("economy over three seasons (seeded, inside a career)", () => {
  const snapshots: World[] = [];
  let career: CareerState;
  const sim = batchOf(quickSeries);
  /** Play a career on (board: playoffs; bids for our players: rejected; our matches: quick estimate). */
  async function playSeasons(c: CareerState, seasons: number, onSeason?: (w: World) => void, maxDays = Infinity): Promise<void> {
    const start = c.date;
    const target = c.season.season + seasons;
    while (c.season.season < target) {
      const r = await continueCareer(c, sim);
      if (r.stop === "message") for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? "reject" : m.options![0]!.id);
      else if (r.stop === "matchDay") {
        const q = seriesRequest(c, r.fixture!);
        recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: "user", lineups: { home: q.home.lineup, away: q.away.lineup } });
      } else if (r.stop === "seasonEnd") { await continueCareer(c, sim); onSeason?.(c.world); }
      if (r.date > start && (new Date(r.date).getTime() - new Date(start).getTime()) / 864e5 > maxDays) return;
    }
  }
  beforeAll(async () => {
    career = newCareer(structuredClone(base), { seed: SEED, manager: { name: "T", nationality: "kr" }, userTeamId: user });
    snapshots.push(structuredClone(career.world));
    await playSeasons(career, 3, (w) => snapshots.push(structuredClone(w)));
  }, 600_000);

  it("is deterministic", async () => {
    const a = newCareer(structuredClone(base), { seed: SEED, manager: { name: "T", nationality: "kr" }, userTeamId: user });
    const b = newCareer(structuredClone(base), { seed: SEED, manager: { name: "T", nationality: "kr" }, userTeamId: user });
    await playSeasons(a, 1, undefined, 60);
    await playSeasons(b, 1, undefined, 60);
    expect(serializeWorld(a.world)).toBe(serializeWorld(b.world));
  }, 120_000);

  it("no club goes infinitely rich or broke, and budgets stay in plausible bands", () => {
    for (const w of snapshots) {
      const fs = Object.entries(w.club!.finances);
      const balances = fs.map(([, f]) => f.balance).sort((a, b) => a - b);
      for (const [id, f] of fs) {
        expect(f.balance, `${w.teams[id]!.name} ${w.season}`).toBeGreaterThan(-M.debtLimitShare * f.expectedIncome - 400_000);
        expect(f.balance, `${w.teams[id]!.name} ${w.season}`).toBeLessThan(8_000_000);
        expect(f.expectedIncome).toBeGreaterThan(500_000);
        expect(f.expectedIncome).toBeLessThan(6_000_000);
        if (w.season > snapshots[0]!.season) expect(f.wageBudget).toBeCloseTo(M.wageShare * f.expectedIncome, -4);
        else expect(f.wageBudget).toBeGreaterThanOrEqual(Math.round(M.wageShare * f.expectedIncome / 1000) * 1000 - 1000);
        expect(f.fanbase).toBeGreaterThanOrEqual(0);
        expect(f.fanbase).toBeLessThanOrEqual(1);
      }
      const median = balances[Math.floor(balances.length / 2)]!;
      expect(median).toBeGreaterThan(200_000);
      expect(median).toBeLessThan(4_000_000);
    }
    // Growth slows: the richest club's balance does not keep compounding.
    const top = snapshots.map((w) => Math.max(...Object.values(w.club!.finances).map((f) => f.balance)));
    expect(top[3]! - top[2]!).toBeLessThan(Math.max(1_500_000, top[1]! - top[0]! + 500_000));
  });

  it("the world moves: AI clubs buy and sign, every squad stays legal and contracted", () => {
    const final = snapshots[3]!;
    const moves = final.club!.transfers.filter((r) => r.kind === "transfer" && r.toTeamId !== user);
    expect(moves.length).toBeGreaterThan(5);
    for (const t of Object.values(final.teams)) {
      expect(t.roster.length).toBeLessThanOrEqual(8);
      for (const id of [...t.roster, ...t.academy]) expect(final.club!.contracts[id], `${t.name} ${id}`).toBeDefined();
    }
    for (const f of Object.values(final.club!.finances)) expect(f.monthly.length).toBeGreaterThan(0);
  });

  it("the user's ledger records the months, prize money and board messages reach the career inbox", () => {
    const f = snapshots[3]!.club!.finances[user]!;
    const kinds = new Set(f.ledger.map((e) => e.kind));
    for (const k of ["stipend", "sponsorship", "wages", "staffWages", "operations", "prize"]) expect(kinds.has(k as never), k).toBe(true);
    const club = career.inbox.filter((m) => m.source === "club");
    const titles = club.map((m) => m.text!.en.title);
    expect(titles.some((t) => t.includes("budget set"))).toBe(true);
    expect(titles.some((t) => t.includes("Transfer window open"))).toBe(true);
    expect(titles.some((t) => t.includes("prize money"))).toBe(true);
    for (const m of club) { expect(m.text!.ko.title.length).toBeGreaterThan(0); expect(m.text!.en.body!.length).toBeGreaterThan(0); }
    expect(career.world.club!.outbox).toHaveLength(0); // everything reached the career inbox
  });

  it("the wage bill is a sensible share of income", () => {
    const w = snapshots[3]!;
    const ratios = Object.keys(w.teams).map((id) => wageBill(w, id).total / w.club!.finances[id]!.expectedIncome).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)]!;
    expect(median).toBeGreaterThan(0.3);
    expect(median).toBeLessThan(0.9);
  });
});
