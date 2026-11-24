/**
 * Match preparation (docs/MATCH_MANAGEMENT.md §4): the pre-match opponent report and the match
 * plan it feeds.
 *
 * The REPORT is read from what can be observed of the opponent — their game logs (TeamGameLog:
 * plants, first contacts, where their defenders fell, buy tiers, who got the kills) through the
 * scouting model (scouting.ts) and their public map record (mastery.ts). Nothing hidden is read.
 *
 * The PLAN is the manager's pre-match choice. It becomes engine inputs only through existing paths:
 *   attack / defense lean      → TeamMatchInputs.standingPrior (GamePlan, team-inputs.ts)
 *   use the scouting report    → TeamMatchInputs.opponentPrior (opponentPriorFromLogs)
 *   tempo / risk / defense     → standing shouts (manager.ts), resolved into orders / round inputs
 *   pistol plan                → the strategy order on rounds 1 and 13
 *   after a lost pistol        → the economy order on rounds 2 and 14
 * Plant-spot, post-plant, retake (engine-truth) and mid-control (maps-data) options are carried
 * in `pending` with the shapes those sessions published, and are NOT applied until their engine
 * support lands (planPending lists them).
 */
import { listSimulatableTeams } from "@pv/game-data";
import type { OpponentPrior, SiteKey } from "@pv/team-engine";
import { runMatch, type TeamRef } from "./match.js";
import type { EconomyCall } from "./economy.js";
import type { AttackStrategyOrder, DefenseStrategyOrder } from "./orders.js";
import { leagueMasteryReference, mapMastery, type MapMastery } from "./mastery.js";
import { buildScoutingReport, opponentPriorFromLogs, siteEvidence, teamGameLog, type ScoutingReport, type SiteEvidence, type TeamGameLog } from "./scouting.js";
import { gamePlanPrior, type GamePlan, type TeamMatchInputs } from "./team-inputs.js";
import type { DefenseShout, RiskShout, Shouts, TempoShout } from "./manager.js";
import { DEFAULT_MAP_POOL } from "./veto.js";

// ── plan ─────────────────────────────────────────────────────────────────────────────────────

/** Plant spot kinds (engine-truth plant-plans API, shared notes `plant-plans-api.md`). */
export type PlantSpotKind = "auto" | "default" | "safe" | "open" | "cover" | "near";
/**
 * Options other sessions are adding to the engine. Shapes mirror theirs so wiring is a copy into
 * TeamMatchInputs once the fields exist there. Not applied today.
 */
export interface PendingPlanOptions {
  readonly plantPreference?: Readonly<Partial<Record<"A" | "B" | "C", PlantSpotKind>>>;
  readonly postPlantPlans?: Readonly<Partial<Record<"A" | "B" | "C", {
    readonly hold?: "auto" | "onSpike" | "offSpike";
    readonly flankWatch?: "auto" | boolean;
    readonly utility?: "auto" | "savePostPlant" | "spend";
    readonly outnumbered?: "auto" | "hold" | "retreat";
  }>>>;
  readonly retakePlans?: Readonly<Partial<Record<"A" | "B" | "C", {
    readonly approach?: "auto" | "stack" | "split";
    readonly save?: "auto" | "never";
  }>>>;
  /** Mid control (maps-data session) — shape not published yet; a free-form choice until then. */
  readonly midControl?: "auto" | "contest" | "concede";
}

export interface MatchPlan {
  /** Standing attack lean (0–10 strength = standing pseudo-observations; 0 / null = none). */
  readonly attackLean?: { readonly site: SiteKey; readonly strength: number } | null;
  /** Standing defensive lean: expect their attack on this site. */
  readonly defenseLean?: { readonly site: SiteKey; readonly strength: number } | null;
  readonly tempo?: TempoShout;
  readonly risk?: RiskShout;
  readonly defense?: DefenseShout;
  /** Pistol-round calls (rounds 1 and 13). */
  readonly pistol?: { readonly attack?: AttackStrategyOrder; readonly defense?: DefenseStrategyOrder };
  /** Economy call for the round after a lost pistol (rounds 2 and 14). */
  readonly afterPistolLoss?: Extract<EconomyCall, "save" | "force">;
  /** Seed the opponent model with the report's prior (needs report logs). */
  readonly useScouting?: boolean;
  readonly pending?: PendingPlanOptions;
}

/** The standing shouts a plan starts the match with. */
export function planShouts(plan: MatchPlan | undefined): Shouts {
  return { tempo: plan?.tempo ?? "normal", risk: plan?.risk ?? "normal", defense: plan?.defense ?? "normal" };
}

/** The match-long engine inputs a plan amounts to (merged into MatchConfig.teamInputs). */
export function planTeamInputs(plan: MatchPlan | undefined, scoutLogs: readonly TeamGameLog[] = [], map = "Ascent", uptake = 1): TeamMatchInputs {
  if (!plan) return {};
  const gp: GamePlan = {
    ...(plan.attackLean && plan.attackLean.strength > 0 ? { attack: plan.attackLean } : {}),
    ...(plan.defenseLean && plan.defenseLean.strength > 0 ? { defense: plan.defenseLean } : {}),
  };
  const standing = gamePlanPrior(gp);
  const prior: OpponentPrior | undefined = plan.useScouting && scoutLogs.length
    ? opponentPriorFromLogs(scoutLogs.map((log) => ({ log, weight: uptake })), map)
    : undefined;
  return { ...(standing ? { standingPrior: standing } : {}), ...(prior ? { opponentPrior: prior } : {}) };
}

/** Plan options chosen but not applied by the engine yet (for the UI and the post-match summary). */
export function planPending(plan: MatchPlan | undefined): string[] {
  const p = plan?.pending;
  if (!p) return [];
  const out: string[] = [];
  if (p.plantPreference && Object.values(p.plantPreference).some((v) => v && v !== "auto")) out.push("plantPreference");
  if (p.postPlantPlans && Object.keys(p.postPlantPlans).length) out.push("postPlantPlans");
  if (p.retakePlans && Object.keys(p.retakePlans).length) out.push("retakePlans");
  if (p.midControl && p.midControl !== "auto") out.push("midControl");
  return out;
}

// ── film ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A team's scoutable film: its last `n` games against other simulatable teams, simulated here
 * (the data has no real per-round history). Deterministic from the seed.
 */
export function scoutingFilm(team: TeamRef, exclude: readonly string[], n: number, seed: number, pool: readonly string[] = DEFAULT_MAP_POOL): TeamGameLog[] {
  const others = listSimulatableTeams().filter((t) => t.teamId !== team.id && !exclude.includes(t.teamId));
  const logs: TeamGameLog[] = [];
  for (let k = 0; k < Math.max(0, n) && others.length > 0; k++) {
    const opp = others[(seed * 7 + k * 3) % others.length]!;
    const r = runMatch({ teamA: team, teamB: { id: opp.teamId, name: opp.name ?? opp.teamId }, map: pool[(k + seed) % pool.length]!, seed: seed * 31 + k });
    logs.push(teamGameLog(r, "A"));
  }
  return logs;
}

// ── report ───────────────────────────────────────────────────────────────────────────────────

export interface Rate { readonly n: number; readonly rate: number | null }
const rate = (num: number, den: number): Rate => ({ n: den, rate: den > 0 ? num / den : null });

export interface OpponentReport {
  readonly us: TeamRef;
  readonly them: TeamRef;
  readonly map: string;
  readonly gamesReviewed: number;
  readonly analyst: number;
  /** Where they attack / where their defenders are met — this map first, then all maps. */
  readonly sites: { readonly map: { readonly attack: SiteEvidence; readonly defense: SiteEvidence }; readonly all: { readonly attack: SiteEvidence; readonly defense: SiteEvidence } };
  readonly pistol: {
    readonly won: Rate;
    /** Pistol attack rounds: share planted / first met on A. */
    readonly attackSiteA: Rate;
    /** After losing a pistol: share of next rounds they forced (force / half) instead of saving. */
    readonly forceAfterLoss: Rate;
  };
  readonly eco: {
    /** After a lost (non-pistol) round: share of next rounds bought force / half. */
    readonly forceAfterLoss: Rate;
    /** Share of their buy rounds that were full buys. */
    readonly fullBuy: Rate;
  };
  readonly players: ScoutingReport["players"];
  readonly maps: ReadonlyArray<{ readonly map: string; readonly theirs: number; readonly ours: number; readonly games: number; readonly wins: number | null; readonly verdict: "strong" | "average" | "weak" }>;
  /** A plan the report suggests (the manager can take or change it). */
  readonly suggestedPlan: MatchPlan;
  readonly logs: readonly TeamGameLog[];
}

/**
 * Build the pre-match report on `them` for a game on `map`. `logs` = their observable games
 * (most recent last); the analyst quality decides how many are reviewed (scouting.ts).
 */
export function buildOpponentReport(args: {
  readonly us: TeamRef;
  readonly them: TeamRef;
  readonly map: string;
  readonly logs: readonly TeamGameLog[];
  readonly analyst: number;
  readonly seed: number;
  readonly pool?: readonly string[];
}): OpponentReport {
  const pool = args.pool ?? DEFAULT_MAP_POOL;
  const reference = leagueMasteryReference(pool);
  const theirMastery: Record<string, MapMastery> = Object.fromEntries(pool.map((m) => [m, mapMastery({ teamId: args.them.id, map: m })]));
  const scouting = buildScoutingReport({ by: args.us.id, of: args.them.id, logs: args.logs, pool, opponentMastery: theirMastery, reference, analyst: args.analyst, seed: args.seed });
  const reviewed = scouting.reviewed;
  const logs = reviewed.map((r) => r.log);

  let pistols = 0, pistolsWon = 0, pAtk = 0, pAtkA = 0, afterPLoss = 0, afterPLossForce = 0, afterLoss = 0, afterLossForce = 0, buys = 0, full = 0;
  for (const log of logs) {
    log.rounds.forEach((r, i) => {
      const prev = log.rounds[i - 1];
      if (r.pistol) {
        pistols++; if (r.won) pistolsWon++;
        if (r.side === "attack") {
          const site = r.plantSite ?? r.firstContactSite;
          if (site) { pAtk++; if (site === "A") pAtkA++; }
        }
      }
      if (!r.pistol && prev && !prev.won) {
        const forced = r.buyTier === "force" || r.buyTier === "half";
        if (prev.pistol) { afterPLoss++; if (forced) afterPLossForce++; }
        else { afterLoss++; if (forced) afterLossForce++; }
      }
      if (!r.pistol && r.buyTier !== "eco") { buys++; if (r.buyTier === "full") full++; }
    });
  }
  const mapSites = siteEvidence(reviewed, args.map);
  const allSites = siteEvidence(reviewed.map((r) => ({ ...r, weight: 1 })), null);
  const maps = pool.map((m) => {
    const sm = scouting.maps.find((x) => x.map === m)!;
    return { map: m, theirs: sm.estimatedMastery, ours: mapMastery({ teamId: args.us.id, map: m }).value, games: sm.games, wins: sm.wins, verdict: sm.verdict };
  });

  // Suggested plan: lean only on evidence that is there (≥ 8 rounds, a 60/40 split or more).
  const lean = (e: SiteEvidence): { site: SiteKey; strength: number } | null => {
    if (e.rounds < 8) return null;
    const a = e.share.A;
    if (a >= 0.6) return { site: "A", strength: Math.round(10 * (a - 0.5) * 2) };
    if (a <= 0.4) return { site: "B", strength: Math.round(10 * (0.5 - a) * 2) };
    return null;
  };
  const atk = lean(mapSites.attackSite.rounds >= 8 ? mapSites.attackSite : allSites.attackSite); // where they attack → our defensive lean
  const def = lean(mapSites.defenseSite.rounds >= 8 ? mapSites.defenseSite : allSites.defenseSite); // where they defend → attack the other site
  const pForce = rate(afterPLossForce, afterPLoss);
  const suggestedPlan: MatchPlan = {
    ...(atk ? { defenseLean: atk } : {}),
    ...(def ? { attackLean: { site: def.site === "A" ? "B" : "A", strength: def.strength } } : {}),
    useScouting: logs.length > 0,
    // They force after a lost pistol → expect guns on round 2: save ours for round 3 rather than force into rifles.
    ...(pForce.rate !== null && pForce.n >= 2 ? { afterPistolLoss: pForce.rate >= 0.5 ? "save" as const : "force" as const } : {}),
  };

  return {
    us: args.us,
    them: args.them,
    map: args.map,
    gamesReviewed: logs.length,
    analyst: args.analyst,
    sites: { map: { attack: mapSites.attackSite, defense: mapSites.defenseSite }, all: { attack: allSites.attackSite, defense: allSites.defenseSite } },
    pistol: { won: rate(pistolsWon, pistols), attackSiteA: rate(pAtkA, pAtk), forceAfterLoss: pForce },
    eco: { forceAfterLoss: rate(afterLossForce, afterLoss), fullBuy: rate(full, buys) },
    players: scouting.players,
    maps,
    suggestedPlan,
    logs,
  };
}
