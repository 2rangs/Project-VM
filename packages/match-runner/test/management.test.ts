import { describe, it, expect } from "vitest";
import {
  MORALE_MODEL,
  aiManagerDecision,
  aiTeamTalk,
  alertsAfterRound,
  buildOpponentReport,
  createManagedSession,
  mindRoundInputs,
  moodAfterRound,
  moodAfterTimeout,
  planTeamInputs,
  scoutingFilm,
  shoutStrategy,
  summarizeMind,
  talkEffect,
  teamGameLog,
  withMood,
  type ManagedSession,
  type MatchConfig,
  type PlayerMind,
  type TeamMind,
} from "../src/index.js";

const A = { id: "624", name: "Paper Rex" };
const B = { id: "7386", name: "MIBR" };
const base: MatchConfig = { teamA: A, teamB: B, map: "Ascent", seed: 9 };
const LONG = 180_000;

const player = (composure: number, drive: number, mood = 0, index = 0): PlayerMind =>
  withMood({ index, playerId: null, handle: null, personality: { composure, drive }, key: false }, mood);
const team = (moods: number[], composure = 0.6, drive = 0.5): TeamMind => summarizeMind(moods.map((m, i) => player(composure, drive, m, i)));
const signature = (s: ManagedSession) => s.result().rounds.map((r) => `${r.winner}${r.reason[0]}:${r.decisions.plans.A?.opening}/${r.decisions.plans.B?.opening}`).join(",");

describe("state of mind: documented formulas over composure", () => {
  it("a lost round hurts a fragile player more than a composed one; a win lifts both; old mood fades", () => {
    const fragile = moodAfterRound(0, 0.2, false, 0, true);
    const composed = moodAfterRound(0, 0.9, false, 0, true);
    expect(fragile).toBeCloseTo(-(0.8) * (MORALE_MODEL.lossImpulse + MORALE_MODEL.deathNoKillImpulse), 12);
    expect(composed).toBeGreaterThan(fragile);
    expect(moodAfterRound(0, 0.5, true, 2, false)).toBeCloseTo(MORALE_MODEL.winImpulse + MORALE_MODEL.multiKillImpulse, 12);
    expect(moodAfterRound(-0.8, 0.5, true, 0, false)).toBeCloseTo(MORALE_MODEL.decay * -0.8 + MORALE_MODEL.winImpulse, 12);
    // A long losing run saturates, never below −1.
    let m = 0;
    for (let i = 0; i < 40; i++) m = moodAfterRound(m, 0, false, 0, true);
    expect(m).toBeGreaterThan(-1.01);
    expect(m).toBeLessThan(-0.9);
  });

  it("acts only through existing formulas: tilt → form σ, throw hazard, trading/gameSense; calm and neutral → nothing", () => {
    expect(mindRoundInputs(team([0, 0, 0, 0, 0]), "normal")).toBeNull();
    const tilted = mindRoundInputs(team([-0.5, -0.5, -0.5, -0.5, -0.5]), "normal")!;
    expect(tilted.formSigmaScale).toBeCloseTo(1 + MORALE_MODEL.formPerTilt * 0.5, 12);
    expect(tilted.throwRateScale).toBeCloseTo(Math.exp(MORALE_MODEL.throwPerTilt * 0.5), 12);
    expect(tilted.traitDelta!.trading!).toBeLessThan(0);
    const confident = mindRoundInputs(team([0.5, 0.5, 0.5, 0.5, 0.5]), "normal")!;
    expect(confident.throwRateScale!).toBeLessThan(1);
    expect(confident.formSigmaScale).toBe(1);
    expect(confident.tuning).toBeUndefined();
  });

  it("a risk shout moves the retake / save / hero thresholds, nothing else", () => {
    const more = mindRoundInputs(team([0, 0, 0, 0, 0]), "more")!;
    const less = mindRoundInputs(team([0, 0, 0, 0, 0]), "less")!;
    expect(more.tuning!.retakeMinWinChance!).toBeLessThan(0.15);
    expect(less.tuning!.retakeMinWinChance!).toBeGreaterThan(0.15);
    expect(more.tuning!.attackSaveMinWinChance!).toBeLessThan(less.tuning!.attackSaveMinWinChance!);
  });
});

describe("manager levers depend on personalities and attributes", () => {
  const avg = { tactical: 0.6, motivating: 0.6 };

  it("a timeout recovers more tilt with a composed player and a motivating manager; it never makes things worse", () => {
    expect(moodAfterTimeout(-0.6, 0.9, avg)).toBeGreaterThan(moodAfterTimeout(-0.6, 0.2, avg));
    expect(moodAfterTimeout(-0.6, 0.6, { tactical: 0.6, motivating: 1 })).toBeGreaterThan(moodAfterTimeout(-0.6, 0.6, { tactical: 0.6, motivating: 0 }));
    expect(moodAfterTimeout(0.3, 0.6, avg)).toBe(0.3);
    expect(moodAfterTimeout(-0.6, 0.6, avg)).toBeLessThan(0); // a reset, not a miracle
  });

  it("team talks: demanding lifts a driven player and breaks a tilted fragile one; calm only treats tilt", () => {
    const driven = player(0.7, 0.9, 0);
    const fragileTilted = player(0.2, 0.4, -0.6);
    expect(talkEffect("demand", "trailing", driven, avg)).toBeGreaterThan(0);
    expect(talkEffect("demand", "trailing", fragileTilted, avg)).toBeLessThan(0);
    expect(talkEffect("calm", "level", fragileTilted, avg)).toBeGreaterThan(0);
    expect(talkEffect("calm", "level", driven, avg)).toBe(0);
    expect(talkEffect("praise", "trailing", driven, avg)).toBeLessThan(0);
    expect(talkEffect("praise", "leading", driven, avg)).toBeGreaterThan(talkEffect("praise", "leading", player(0.2, 0.5), avg));
    // The manager's motivating scales every talk.
    expect(talkEffect("encourage", "level", driven, { tactical: 0.6, motivating: 1 })).toBeGreaterThan(talkEffect("encourage", "level", driven, { tactical: 0.6, motivating: 0.1 }));
  });

  it("the AI manager reads the room with its attributes", () => {
    const tilted = team([-0.6, -0.6, -0.5, -0.1, 0]);
    expect(aiTeamTalk({ tactical: 0.6, motivating: 0.9 }, "trailing", tilted)).toBe("calm");
    expect(aiTeamTalk({ tactical: 0.6, motivating: 0.3 }, "trailing", tilted)).toBe("encourage");
    const sit = (lossStreak: number, tilt: TeamMind) => ({
      slot: "A" as const, round: 8, score: { A: 2, B: 5 }, lossStreak, mind: tilt, read: null,
      timeoutsLeftThisHalf: 1, creditsPerPlayer: 3000, opponentMatchPoint: false,
    });
    const calm = team([0, 0, 0, 0, 0]);
    expect(aiManagerDecision({ tactical: 0.8, motivating: 0.6 }, sit(3, calm)).timeout).toBe(true);
    expect(aiManagerDecision({ tactical: 0.3, motivating: 0.6 }, sit(3, calm)).timeout).toBe(false); // needs a 4th loss
    expect(aiManagerDecision({ tactical: 0.3, motivating: 0.6 }, sit(4, calm)).timeout).toBe(true);
    expect(aiManagerDecision({ tactical: 0.8, motivating: 0.6 }, { ...sit(0, calm), timeoutsLeftThisHalf: 0, opponentMatchPoint: true }).timeout).toBe(false);
    expect(aiManagerDecision({ tactical: 0.8, motivating: 0.6 }, sit(1, team([-0.5, -0.5, -0.5, -0.5, -0.5]))).reason).toBe("tilt");
    expect(aiManagerDecision({ tactical: 0.8, motivating: 0.6 }, { ...sit(1, calm), score: { A: 2, B: 7 } }).shouts.risk).toBe("more");
  });

  it("shouts resolve to calls from the team's own read; deterministic per round", () => {
    const read = (defA: number, atkA: number) => ({
      attackSite: { probability: { A: atkA, B: 1 - atkA }, confidence: 0.8, samples: 6 },
      defenseSite: { probability: { A: defA, B: 1 - defA }, confidence: 0.8, samples: 6 },
    });
    const fast = { tempo: "fast" as const, risk: "normal" as const, defense: "normal" as const };
    expect(shoutStrategy({ ...fast, tempo: "slow" }, "attack", null, 1, 3, "A")).toBe("default");
    expect(shoutStrategy({ ...fast, tempo: "normal" }, "attack", null, 1, 3, "A")).toBeUndefined();
    // They defend A heavily → a fast attack mostly hits B.
    let b = 0;
    for (let r = 1; r <= 200; r++) if (shoutStrategy(fast, "attack", read(0.9, 0.5), 1, r, "A") === "bExecute") b++;
    expect(b).toBeGreaterThan(130);
    expect(shoutStrategy(fast, "attack", read(0.9, 0.5), 1, 7, "A")).toBe(shoutStrategy(fast, "attack", read(0.9, 0.5), 1, 7, "A"));
    expect(shoutStrategy({ ...fast, defense: "stack" }, "defense", read(0.5, 0.2), 1, 3, "A")).toBe("stackB");
    expect(shoutStrategy({ ...fast, defense: "spread" }, "defense", read(0.5, 0.2), 1, 3, "A")).toBe("defaultHold");
  });

  it("alerts: a 0-4 run, a broken economy (on the transition), a player tipping into tilt, half-time", () => {
    const before = team([0, -0.3, 0, 0, 0]);
    const after = team([0, -0.5, 0, 0, 0]);
    const alerts = alertsAfterRound({ team: "A", nextRound: 9, lost: true, streak: 4, creditsPerPlayer: 1800, creditsPerPlayerBefore: 3100, nextIsPistol: false, halfTimeNext: false, before, after });
    expect(alerts.map((a) => a.kind).sort()).toEqual(["economyBroken", "lossRun", "playerTilt"]);
    expect(alerts.find((a) => a.kind === "playerTilt")!.player!.index).toBe(1);
    expect(alertsAfterRound({ team: "A", nextRound: 10, lost: true, streak: 5, creditsPerPlayer: 1500, creditsPerPlayerBefore: 1800, nextIsPistol: false, halfTimeNext: false, before: after, after })).toEqual([]);
    expect(alertsAfterRound({ team: "A", nextRound: 13, lost: false, streak: 0, creditsPerPlayer: 4000, creditsPerPlayerBefore: 4000, nextIsPistol: true, halfTimeNext: true, before, after: before })[0]!.kind).toBe("halfTime");
  });
});

describe("managed session: levers reach the match", () => {
  it("counterfactual: a strategy change sends the attack where it says (the order is the opening call)", () => {
    const plantsOn = (attack: "aExecute" | "bExecute") => {
      const s = createManagedSession(base, { aiTeams: ["B"] });
      s.setStrategy("A", { attack, rounds: 40 });
      while (!s.isFinished()) s.playNextRound();
      const log = teamGameLog(s.result(), "A");
      const plants = log.rounds.filter((r) => r.side === "attack" && r.plantSite);
      return plants.filter((r) => r.plantSite === "A").length / Math.max(1, plants.length);
    };
    expect(plantsOn("aExecute")).toBeGreaterThan(0.8);
    expect(plantsOn("bExecute")).toBeLessThan(0.2);
  }, LONG);

  it("timeouts: one per half, two per map; a timeout recovers tilt and is logged with what followed", () => {
    const s = createManagedSession(base, { aiTeams: ["B"] });
    for (let i = 0; i < 4; i++) s.playNextRound();
    const tiltBefore = s.state().manager.minds.A.tilt;
    expect(s.state().manager.timeoutsLeftThisHalf.A).toBe(1);
    s.callTimeout("A");
    s.setOrders("A", { strategy: "default" });
    expect(s.state().manager.minds.A.tilt).toBeLessThanOrEqual(tiltBefore);
    s.playNextRound();
    expect(s.state().manager.timeoutsLeftThisHalf.A).toBe(0);
    expect(() => s.callTimeout("A")).toThrow(/this half/);
    while (s.state().roundNumber <= 12) s.playNextRound();
    expect(s.state().manager.timeoutsLeftThisHalf.A).toBe(1);
    while (!s.isFinished()) s.playNextRound();
    const r = s.result();
    const to = r.decisions.find((d) => d.kind === "timeout" && d.team === "A" && d.by === "human")!;
    expect(to.round).toBe(5);
    expect(to.roundsBefore.played).toBe(3);
    expect(to.roundsAfter.played).toBe(3);
    expect(r.timeoutLog.some((e) => e.team === "A" && e.by === "human" && e.round === 5)).toBe(true);
  }, LONG);

  it("half-time: a talk only then, once; the AI gives its own; effects differ by player", () => {
    const s = createManagedSession(base, { aiTeams: ["B"] });
    expect(() => s.teamTalk("A", "encourage")).toThrow(/half-time/);
    while (s.state().roundNumber <= 12) s.playNextRound();
    const ht = s.state().manager.halfTime!;
    expect(ht.pending).toEqual({ A: true, B: true });
    expect(s.state().manager.alerts.some((a) => a.kind === "halfTime" && a.team === "A")).toBe(true);
    const fx = s.teamTalk("A", "demand");
    expect(fx).toHaveLength(5);
    expect(new Set(fx.map((p) => p.delta.toFixed(4))).size).toBeGreaterThan(1);
    expect(() => s.teamTalk("A", "calm")).toThrow();
    s.playNextRound();
    expect(s.state().manager.halfTime).toBeNull();
    const talks = s.result().decisions.filter((d) => d.kind === "talk");
    expect(talks.map((d) => `${d.team}:${d.by}`).sort()).toEqual(["A:human", "B:ai"]);
  }, LONG);

  it("the pre-match plan: pistol call opens round 1, the after-pistol-loss call buys round 2, leans become standing priors", () => {
    const plan = { pistol: { attack: "bExecute" as const }, afterPistolLoss: "save" as const, attackLean: { site: "B" as const, strength: 6 } };
    expect(planTeamInputs(plan).standingPrior).toEqual({ defenseSite: { A: 6 } });
    const s = createManagedSession(base, { aiTeams: ["B"], plans: { A: plan } });
    const r1 = s.playNextRound();
    expect(r1.attacker).toBe("A");
    expect(r1.decisions.plans.A?.opening).toBe("bExecute");
    const r2 = s.playNextRound();
    if (r1.winner === "B") expect(r2.buys.A.tier).toBe("eco");
    // Pending engine options are carried and reported, not applied.
    const p = createManagedSession(base, { aiTeams: ["B"], plans: { A: { pending: { plantPreference: { A: "safe" }, midControl: "contest" } } } });
    expect(p.state().manager.pendingPlanOptions.A).toEqual(["plantPreference", "midControl"]);
  }, LONG);

  it("deterministic: same seed, plans and actions → the same match; the AI manager differs by attributes", () => {
    const play = (tactical: number) => {
      const s = createManagedSession(base, { aiTeams: ["A", "B"], managers: { B: { tactical, motivating: tactical } } });
      while (!s.isFinished()) s.playNextRound();
      return s;
    };
    const one = play(0.9);
    expect(signature(play(0.9))).toBe(signature(one));
    const decisionsOf = (s: ManagedSession) => s.result().decisions.filter((d) => d.team === "B").map((d) => `${d.round}${d.kind}`).join(",");
    expect(decisionsOf(play(0.1))).not.toBe(decisionsOf(one));
  }, LONG);
});

describe("pre-match opponent report", () => {
  it("reads sites, pistol and eco habits, players and map pool from observable film; suggests a plan", () => {
    const film = scoutingFilm(B, [A.id], 2, 3);
    expect(film).toHaveLength(2);
    const report = buildOpponentReport({ us: A, them: B, map: "Ascent", logs: film, analyst: 1, seed: 1 });
    expect(report.gamesReviewed).toBe(2);
    expect(report.pistol.won.n).toBe(4);
    expect(report.sites.all.attack.rounds).toBeGreaterThan(0);
    expect(report.eco.forceAfterLoss.n).toBeGreaterThan(0);
    expect(report.players).toHaveLength(5);
    expect(report.maps).toHaveLength(7);
    expect(report.suggestedPlan.useScouting).toBe(true);
    // No analysts → no film reviewed, no scouting prior suggested.
    const blind = buildOpponentReport({ us: A, them: B, map: "Ascent", logs: film, analyst: 0, seed: 1 });
    expect(blind.gamesReviewed).toBe(0);
    expect(blind.suggestedPlan.useScouting).toBe(false);
  }, LONG);
});
