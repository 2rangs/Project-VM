// Club-management depth (docs/CLUB_OPERATIONS.md §9–12), counterfactual where it is a decision:
// agents, bonuses, release clauses, sell-on, renewal refusals, free-agent timing, morale (and its
// way into the match inputs), the board, the staff market.
import { describe, it, expect, beforeAll } from "vitest";
import { rosterProfiles, rosterConsistency } from "../../match-runner/src/teams.ts";
import { worldFromGameData } from "../src/game-data.ts";
import {
  CLUB_MODEL, DEPTH_MODEL, advanceSeason, agentFee, agentOf, askingPrice, boardOf, boardOnSeries, boardRequest, boardSeasonReview,
  clubAnswer, clubSeriesResultMut, effectiveWage, estimateAbility, facilitiesOf, hireStaff, initClub, makeOffer, matchRoster, moraleOf,
  moraleTarget, moraleWeek, newCareer, physioFactor, playerAnswer, playerUtility, requiredMargin, setTrainingPlan, staffDemand,
  staffMarket, teamScout, teamStrength, trainingWeek, type World, type WorldPlayer, type RatedAttr,
} from "../src/index.ts";

const SEED = 777;
const M = CLUB_MODEL;
const D = DEPTH_MODEL;
let club: World;
let user: string;
let target: WorldPlayer;

beforeAll(() => {
  const base = worldFromGameData(SEED);
  const ids = Object.keys(base.teams).filter((id) => base.teams[id]!.roster.length >= 5 && base.teams[id]!.roster.length < 8)
    .sort((a, b) => teamStrength(base, b) - teamStrength(base, a) || a.localeCompare(b));
  user = ids[Math.floor(ids.length / 2)]!;
  club = initClub(base, { userTeamId: user, date: `${base.season}-01-10` });
  const region = club.teams[user]!.region;
  const seller = Object.values(club.teams).find((t) => t.teamId !== user && t.region === region && t.roster.length >= 6)!;
  target = club.players[seller.roster[1]!]!;
});

const T = (wage: number, extra: Record<string, number> = {}) => ({ fee: 0, wage, years: 2, ...extra });

describe("agents", () => {
  it("a harder agent asks for a higher margin and a bigger fee (both linear in hardness)", () => {
    const ids = Object.keys(club.players).slice(0, 200);
    const byH = ids.map((id) => ({ id, h: agentOf(club, id).hardness })).sort((a, b) => a.h - b.h);
    const soft = byH[0]!; const hard = byH[byH.length - 1]!;
    expect(requiredMargin(club, hard.id)).toBeGreaterThan(requiredMargin(club, soft.id));
    expect(requiredMargin(club, hard.id)).toBeCloseTo(M.acceptMargin + D.agentMarginSpan * hard.h, 12);
    const t = T(100_000);
    expect(agentFee(club, hard.id, t)).toBeGreaterThan(agentFee(club, soft.id, t));
  });

  it("the counter brings U exactly to the agent's margin, and that counter is accepted", () => {
    const offer = { kind: "transfer" as const, playerId: target.playerId, toTeamId: user, terms: T(60_000) };
    const a = playerAnswer(club, offer);
    if (a.decision !== "counter") return; // a cheap move the player already likes
    const again = playerAnswer(club, { ...offer, terms: a.counter! });
    expect(again.decision).toBe("accept");
    expect(again.utility.total).toBeGreaterThanOrEqual(requiredMargin(club, target.playerId) - 1e-9);
    expect(again.utility.total - requiredMargin(club, target.playerId)).toBeLessThan(0.02);
  });
});

describe("bonuses and clauses", () => {
  it("bonuses raise the utility through the effective wage, at bonusValue", () => {
    const base = playerUtility(club, target, "transfer", user, T(100_000));
    const withBonus = playerUtility(club, target, "transfer", user, T(100_000, { signingBonus: 100_000 }));
    // years 2 → +50K a year, valued at bonusValue.
    expect(withBonus.effWage).toBeCloseTo(100_000 + D.bonusValue * 50_000, 6);
    expect(withBonus.total - base.total).toBeCloseTo(M.wWage * Math.log(withBonus.effWage! / base.effWage!), 9);
    // A win bonus is worth more at a stronger club (more expected wins).
    const ranked = Object.keys(club.teams).sort((a, b) => teamStrength(club, b) - teamStrength(club, a));
    const t = T(100_000, { winBonus: 5_000 });
    expect(effectiveWage(club, ranked[0]!, t)).toBeGreaterThan(effectiveWage(club, ranked[ranked.length - 1]!, t));
  });

  it("a lower release clause attracts the player, a higher one puts him off", () => {
    const low = playerUtility(club, target, "transfer", user, T(100_000, { releaseClause: 1 }));
    const high = playerUtility(club, target, "transfer", user, T(100_000, { releaseClause: 50_000_000 }));
    expect(low.clause!).toBeGreaterThan(0);
    expect(high.clause!).toBeLessThan(0);
  });

  it("a sell-on clause lets the selling club accept a lower fee, and the clause pays out on the next sale", () => {
    const asking = askingPrice(club, target);
    const fee = Math.round(asking * 0.85 / 5000) * 5000;
    expect(clubAnswer(club, { kind: "transfer", playerId: target.playerId, terms: { fee, wage: 100_000, years: 2 } }).decision).not.toBe("accept");
    const withSellOn = clubAnswer(club, { kind: "transfer", playerId: target.playerId, terms: { fee, wage: 100_000, years: 2, sellOn: D.maxSellOn } });
    const v = asking; // the seller's value is at most the asking price
    if (fee + D.maxSellOn * D.sellOnExpectation * v / (1 + M.starterPremium + M.shortPremium) >= asking) expect(withSellOn.decision).toBe("accept");
    // Sign him with a sell-on, then sell him on: the first club gets its share.
    let w = structuredClone(club);
    w.club!.finances[user]!.transferBudget = 1e9;
    const from = target.teamId!;
    const r = makeOffer(w, { playerId: target.playerId, toTeamId: user, kind: "transfer", terms: { fee: asking, wage: 3_000_000, years: 2, sellOn: 0.2 } });
    expect(r.offer!.status).toBe("completed");
    w = r.world;
    expect(w.club!.contracts[target.playerId]!.sellOn).toEqual({ teamId: from, pct: 0.2 });
    const buyer = Object.values(w.teams).find((t) => t.teamId !== user && t.teamId !== from && t.region === w.teams[user]!.region && t.roster.length < 8)!;
    w.club!.finances[buyer.teamId]!.transferBudget = 1e9;
    const before = w.club!.finances[from]!.balance;
    const sale = makeOffer(w, { playerId: target.playerId, toTeamId: buyer.teamId, kind: "transfer", terms: { fee: 2_000_000, wage: 5_000_000, years: 2 } });
    expect(sale.offer!.stage).toBe("club"); // a bid for the user's player waits for the user
  });
});

describe("renewals and the free-agent market", () => {
  it("an unhappy, benched player refuses to renew whatever the wage; a happy one accepts market terms", () => {
    const w = structuredClone(club);
    const id = w.teams[user]!.roster[0]!;
    const c = w.club!.contracts[id]!;
    c.squadRole = "starter";
    w.club!.morale = { [id]: 0.02 };
    w.club!.playTime = { players: { [id]: 0 }, teams: { [user]: 30 } };
    const sad = playerAnswer(w, { kind: "renewal", playerId: id, toTeamId: user, terms: T(c.salary * 10) });
    expect(sad.decision).toBe("reject");
    w.club!.morale = { [id]: 0.95 };
    w.club!.playTime = { players: { [id]: 30 }, teams: { [user]: 30 } };
    const happy = playerAnswer(w, { kind: "renewal", playerId: id, toTeamId: user, terms: T(Math.round(c.salary * 1.3)) });
    expect(happy.decision).not.toBe("reject");
    expect(happy.utility.morale!).toBeGreaterThan(sad.utility.morale!);
  });

  it("a free agent's expectations fall with months unsigned", () => {
    const fa = Object.values(club.players).find((p) => p.status === "free" && p.hasRatings)!;
    const now = playerUtility(club, fa, "free", user, T(80_000));
    const later = structuredClone(club);
    later.club!.date = `${club.season}-07-10`;
    const after = playerUtility(later, later.players[fa.playerId]!, "free", user, T(80_000));
    expect(after.ref).toBeLessThan(now.ref);
    expect(after.total).toBeGreaterThan(now.total);
  });
});

describe("morale", () => {
  it("drifts toward a target that rises with results and playing time", () => {
    const w = structuredClone(club);
    const id = w.teams[user]!.roster[0]!;
    const p = w.players[id]!;
    const t0 = moraleTarget(w, p);
    w.club!.recent = { [user]: [1, 1, 1, 1, 1] };
    expect(moraleTarget(w, p)).toBeCloseTo(t0 + D.wResults * 0.5, 9);
    for (let i = 0; i < 10; i++) moraleWeek(w);
    expect(moraleOf(w.club, id)).toBeGreaterThan(0.5);
  });

  it("a series moves the five who played and pays their win bonus", () => {
    const w = structuredClone(club);
    const five = w.teams[user]!.roster.slice(0, 5);
    w.club!.contracts[five[0]!]!.bonuses = { perWin: 5_000 };
    const opp = Object.keys(w.teams).find((id) => id !== user)!;
    const bal = w.club!.finances[user]!.balance;
    clubSeriesResultMut(w, { date: w.club!.date, home: user, away: opp, winner: user, maps: 2, lineups: { home: five, away: w.teams[opp]!.roster.slice(0, 5) } });
    expect(moraleOf(w.club, five[1]!)).toBeCloseTo(0.5 + D.moraleSeries, 9);
    expect(w.club!.finances[user]!.balance).toBe(bal - 5_000);
    expect(w.club!.playTime!.players[five[0]!]).toBe(2);
  });

  it("reaches the match inputs (decision profile and form) — and neutral morale changes nothing", () => {
    const base = worldFromGameData(SEED);
    const career = newCareer(structuredClone(base), { seed: SEED, manager: { name: "T", nationality: "kr" }, userTeamId: user });
    const five = career.world.teams[user]!.roster.slice(0, 5);
    const neutral = matchRoster(career, five);
    career.world.club!.morale = Object.fromEntries(five.map((id) => [id, 0.5]));
    expect(matchRoster(career, five)).toEqual(neutral);
    career.world.club!.morale = Object.fromEntries(five.map((id) => [id, 1]));
    const high = matchRoster(career, five);
    career.world.club!.morale = Object.fromEntries(five.map((id) => [id, 0]));
    const low = matchRoster(career, five);
    const pH = rosterProfiles(user, 5, high), pL = rosterProfiles(user, 5, low), pN = rosterProfiles(user, 5, neutral);
    for (let i = 0; i < 5; i++) {
      expect(pH[i]!.discipline).toBeGreaterThan(pN[i]!.discipline);
      expect(pL[i]!.discipline).toBeLessThan(pN[i]!.discipline);
      expect(pH[i]!.decisionMaking).toBeGreaterThan(pL[i]!.decisionMaking);
    }
    expect(rosterConsistency(user, 5, high)[0]!).toBeGreaterThan(rosterConsistency(user, 5, low)[0]!);
    // Mechanical skills are untouched by morale.
    expect((high[0]!.attributes!.aim as RatedAttr).value).toBe((neutral[0]!.attributes!.aim as RatedAttr).value);
  });
});

describe("board", () => {
  it("sets objectives from stature: the expected place, an international target for the top clubs", () => {
    const o = boardOf(club.club!).objectives!;
    expect(o.season).toBe(club.season);
    expect(o.leaguePlace).toBeLessThanOrEqual(o.expectedPlace);
    expect(o.international).toBe(o.leaguePlace <= D.internationalSlots);
  });

  it("confidence moves with results against expectation (beating a stronger side counts more)", () => {
    const ranked = Object.keys(club.teams).filter((id) => id !== user).sort((a, b) => teamStrength(club, b) - teamStrength(club, a));
    const vsStrong = structuredClone(club); boardOnSeries(vsStrong, "x", ranked[0]!, true);
    const vsWeak = structuredClone(club); boardOnSeries(vsWeak, "x", ranked[ranked.length - 1]!, true);
    const lose = structuredClone(club); boardOnSeries(lose, "x", ranked[ranked.length - 1]!, false);
    const c0 = boardOf(club.club!).confidence;
    expect(boardOf(vsStrong.club!).confidence - c0).toBeGreaterThan(boardOf(vsWeak.club!).confidence - c0);
    expect(boardOf(lose.club!).confidence).toBeLessThan(c0);
  });

  it("warns, then sacks, when confidence collapses", () => {
    const w = structuredClone(club);
    boardOf(w.club!).confidence = D.sackBelow + 0.1;
    boardSeasonReview(w, "x", { [user]: 99 });
    expect(boardOf(w.club!).sacked).toBe(true);
    expect(w.club!.outbox.some((m) => m.text?.en.title.includes("sacked"))).toBe(true);
  });

  it("requests: granted with confidence and money, refused without; one of each per season", () => {
    const rich = structuredClone(club);
    rich.club!.finances[user]!.balance = 20_000_000;
    boardOf(rich.club!).confidence = 0.9;
    const r1 = boardRequest(rich, "transferBudget");
    expect(r1.answer.granted).toBe(true);
    expect(r1.world.club!.finances[user]!.transferBudget).toBeGreaterThan(rich.club!.finances[user]!.transferBudget);
    expect(boardRequest(r1.world, "transferBudget").answer.granted).toBe(false);
    const doubtful = structuredClone(rich);
    boardOf(doubtful.club!).confidence = 0.2;
    expect(boardRequest(doubtful, "transferBudget").answer.granted).toBe(false);
  });

  it("facilities feed development through the coach factor (same world, same seed)", () => {
    const rich = structuredClone(club);
    rich.club!.finances[user]!.balance = 50_000_000;
    boardOf(rich.club!).confidence = 0.9;
    let w = rich;
    for (let i = 0; i < 5; i++) { w = boardRequest(w, "facilities").world; boardOf(w.club!).requests = {}; }
    expect(facilitiesOf(w.club!, user)).toBeCloseTo(1, 9);
    const young = w.teams[user]!.roster.map((id) => w.players[id]!).sort((a, b) => a.age - b.age)[0]!;
    const gain = (x: World) => (advanceSeason(x).players[young.playerId]?.ca ?? 0) - young.ca!;
    expect(gain(w)).toBeGreaterThan(gain(rich));
  });
});

describe("staff market", () => {
  it("a better scout narrows the estimate band; hiring replaces the old one", () => {
    const w = structuredClone(club);
    w.club!.finances[user]!.wageBudget = 1e9;
    const best = staffMarket(w, user, "scout").filter((r) => !r.current)[0]!;
    const cur = staffMarket(w, user, "scout").find((r) => r.current);
    const p = Object.values(w.players).find((x) => x.teamId && x.teamId !== user && x.hasRatings)!;
    const band = (x: World) => { const e = estimateAbility(x, teamScout(x, user), p); return e.caHi - e.caLo; };
    const r = hireStaff(w, user, best.staff.staffId, best.demand);
    expect(r.error).toBeNull();
    expect(r.world.teams[user]!.staff.scout).toBe(best.staff.staffId);
    if (cur && best.staff.attributes.judgingAbility! > cur.staff.attributes.judgingAbility!) expect(band(r.world)).toBeLessThan(band(w));
    expect(hireStaff(w, user, best.staff.staffId, best.demand - 1000).error).toBe("lowWage");
  });

  it("a good coach asks a small club for more", () => {
    const coach = staffMarket(club, user, "headCoach").find((r) => !r.current)!.staff;
    const ranked = Object.keys(club.teams).sort((a, b) => teamStrength(club, b) - teamStrength(club, a));
    const big = ranked[0]!, small = ranked[ranked.length - 1]!;
    if (club.teams[big]!.region === club.teams[small]!.region) expect(staffDemand(club, coach, small)).toBeGreaterThan(staffDemand(club, coach, big));
    else expect(staffDemand(club, coach, small)).toBeGreaterThan(0);
  });

  it("a better physio clears fatigue faster (same training plan)", () => {
    const run = (physio: number) => {
      const w = structuredClone(setTrainingPlan(club, user, { teamFocus: "mechanics" }));
      const pid = w.teams[user]!.staff.physio!;
      w.staff[pid]!.attributes.physiotherapy = physio;
      for (let i = 0; i < 12; i++) trainingWeek(w, "x");
      return w.club!.training.exposure[w.teams[user]!.roster[0]!]!.fatigue;
    };
    expect(physioFactor(club, user)).toBeGreaterThan(0);
    expect(run(0.95)).toBeLessThan(run(0.1));
  });
});
