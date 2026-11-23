// Training: a weekly team focus and a per-player individual focus. Training adds nothing to a
// rating. It changes two inputs the existing formulas read (docs/CLUB_OPERATIONS.md §5):
//
//   1. the development formula (season.ts): growth of attribute k is multiplied by its focus factor
//        F_k = (1 − focusBeta) + focusBeta · 3 · x_g(k)
//      x_g = mean weekly exposure to group g. Balanced training gives x = 1/3 → F = 1 (the existing
//      development); a fully used week has Σx = 1, so the mean F over the groups stays 1 and focus
//      only moves growth between groups. Tactics and rest weeks spend the week elsewhere (Σx < 1),
//      and fatigue lowers the exposure a week yields.
//   2. map mastery (match-runner mastery.ts, M = 0.5H + 0.3C + 0.2F): a tactics week on a map adds
//      practice game-equivalents to the starters' playerGames on that map, which is what the
//      continuity component C reads (pairs familiar with each other on the map).
//
// Groups and the attributes they move:
//   mechanics → aim, crosshairPlacement, firstBulletAccuracy, reaction, tracking
//   utility   → impact (→ engine gameSense / decisionMaking; utilityUsage itself is not rated)
//   teamplay  → trading, consistency
import type { AbilityKey, World } from "../model.ts";
import { CLUB_MODEL } from "./constants.ts";
import type { Exposure, FocusGroup, IndivFocus, TeamFocus, TrainingPlan, TrainingState } from "./types.ts";

const M = CLUB_MODEL;
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;

export const FOCUS_GROUPS: readonly FocusGroup[] = ["mechanics", "utility", "teamplay"];
export const TEAM_FOCI: readonly TeamFocus[] = ["balanced", "mechanics", "utility", "teamplay", "tactics", "rest"];
export const INDIV_FOCI: readonly IndivFocus[] = ["balanced", "mechanics", "utility", "teamplay"];

export const GROUP_OF: Readonly<Record<AbilityKey, FocusGroup>> = {
  aim: "mechanics", crosshairPlacement: "mechanics", firstBulletAccuracy: "mechanics", reaction: "mechanics", tracking: "mechanics",
  impact: "utility",
  trading: "teamplay", consistency: "teamplay",
};

export function emptyTraining(): TrainingState {
  return { plans: {}, exposure: {}, mapPractice: {}, lastTick: null };
}

export function defaultPlan(): TrainingPlan {
  return { teamFocus: "balanced", map: null, individual: {} };
}

const third = 1 / 3;
function vec(f: TeamFocus | IndivFocus): Record<FocusGroup, number> {
  if (f === "mechanics" || f === "utility" || f === "teamplay") return { mechanics: 0, utility: 0, teamplay: 0, [f]: 1 } as Record<FocusGroup, number>;
  if (f === "balanced") return { mechanics: third, utility: third, teamplay: third };
  return { mechanics: 0, utility: 0, teamplay: 0 }; // tactics, rest
}

/** One week's exposure vector for a player (before fatigue). */
export function weeklyVector(team: TeamFocus, indiv: IndivFocus): Record<FocusGroup, number> {
  const a = vec(team);
  const b = vec(indiv);
  // Individual work happens in training weeks only (not in a rest week).
  const iw = team === "rest" ? 0 : M.indivWeight;
  return { mechanics: M.teamWeight * a.mechanics + iw * b.mechanics, utility: M.teamWeight * a.utility + iw * b.utility, teamplay: M.teamWeight * a.teamplay + iw * b.teamplay };
}

/** Fatigue after a week: f' = clamp(f + load − recovery) (rest: f − restRecovery). */
export function nextFatigue(f: number, team: TeamFocus): number {
  const v = team === "rest" ? f - M.restRecovery : f + (team === "tactics" ? M.loadTactics : M.loadTraining) - M.recoveryPerWeek;
  return Math.min(1, Math.max(0, v));
}

/**
 * The weekly training tick for every team with a plan: accumulate each squad player's exposure,
 * update fatigue, and add map practice for the starters in a tactics week.
 */
export function trainingWeek(w: World, date: string): void {
  const tr = w.club!.training;
  tr.lastTick = date;
  for (const [teamId, plan] of Object.entries(tr.plans).sort(([a], [b]) => a.localeCompare(b))) {
    const t = w.teams[teamId];
    if (!t) continue;
    for (const id of [...t.roster, ...t.academy]) {
      const e: Exposure = (tr.exposure[id] ??= { mechanics: 0, utility: 0, teamplay: 0, weeks: 0, fatigue: M.fatigueStart });
      const v = weeklyVector(plan.teamFocus, plan.individual[id] ?? "balanced");
      const eff = 1 - M.fatiguePenalty * Math.max(0, e.fatigue - M.fatigueFree);
      e.mechanics += v.mechanics * eff;
      e.utility += v.utility * eff;
      e.teamplay += v.teamplay * eff;
      e.weeks += 1;
      e.fatigue = nextFatigue(e.fatigue, plan.teamFocus);
    }
    if (plan.teamFocus === "tactics" && plan.map) {
      const byMap = (tr.mapPractice[teamId] ??= {});
      const games = (byMap[plan.map] ??= {});
      for (const id of t.roster.slice(0, 5)) games[id] = Math.round(((games[id] ?? 0) + M.scrimMapsPerWeek * M.scrimWeight) * 100) / 100;
    }
  }
}

/** Mean weekly exposure x_g of a player this season (null: not trained under a plan → F = 1). */
export function exposureShares(e: Exposure | undefined): Record<FocusGroup, number> | null {
  if (!e || e.weeks <= 0) return null;
  return { mechanics: e.mechanics / e.weeks, utility: e.utility / e.weeks, teamplay: e.teamplay / e.weeks };
}

/** Focus factor F_k for every ability attribute. */
export function focusFactors(x: Record<FocusGroup, number> | null): Partial<Record<AbilityKey, number>> | undefined {
  if (!x) return undefined;
  const out: Partial<Record<AbilityKey, number>> = {};
  for (const [k, g] of Object.entries(GROUP_OF) as Array<[AbilityKey, FocusGroup]>) out[k] = Math.max(0, (1 - M.focusBeta) + M.focusBeta * 3 * x[g]);
  return out;
}

/** Focus factors for every player trained this season (for advanceSeason's development step). */
export function seasonFocus(w: World): Record<string, Partial<Record<AbilityKey, number>>> {
  const out: Record<string, Partial<Record<AbilityKey, number>>> = {};
  for (const [id, e] of Object.entries(w.club?.training.exposure ?? {})) {
    const f = focusFactors(exposureShares(e));
    if (f) out[id] = f;
  }
  return out;
}

/** Season end: exposure resets (fatigue carries), practice decays to practiceCarry. */
export function resetTrainingSeason(tr: TrainingState): void {
  for (const e of Object.values(tr.exposure)) { e.mechanics = 0; e.utility = 0; e.teamplay = 0; e.weeks = 0; }
  for (const byMap of Object.values(tr.mapPractice)) for (const games of Object.values(byMap)) for (const id of Object.keys(games)) games[id] = Math.round(games[id]! * M.practiceCarry * 100) / 100;
}

/** Set a team's weekly plan (team focus, map, individual foci). */
export function setTrainingPlan(world: World, teamId: string, patch: Partial<TrainingPlan>): World {
  const w = clone(world);
  const tr = w.club!.training;
  const cur = tr.plans[teamId] ?? defaultPlan();
  tr.plans[teamId] = { ...cur, ...patch, individual: { ...cur.individual, ...(patch.individual ?? {}) } };
  return w;
}

export function setIndividualFocus(world: World, teamId: string, playerId: string, focus: IndivFocus): World {
  return setTrainingPlan(world, teamId, { individual: { [playerId]: focus } });
}

/** Structural copy of game-data's TeamMapRecord (kept local so this module stays dependency-free). */
export interface MapRecordLike { readonly games: number; readonly wins: number | null; readonly playerGames: Readonly<Record<string, number>> | null }

/**
 * A team's map records with practice added to the players' playerGames — pass the result as
 * `MasteryRequest.records` (match-runner mapMastery) so continuity C reads the practice.
 * Measured playerGames get the practice added; a map with no record gets {games 0, wins null,
 * playerGames: practice}; a record whose playerGames are allocated (null) is left as it is.
 */
export function practiceAdjustedRecords(w: World, teamId: string, base: Readonly<Record<string, MapRecordLike>>): Record<string, MapRecordLike> {
  const out: Record<string, MapRecordLike> = { ...base };
  const practice = w.club?.training.mapPractice[teamId] ?? {};
  for (const [map, games] of Object.entries(practice)) {
    const key = Object.keys(out).find((m) => m.toLowerCase() === map.toLowerCase());
    const rec = key ? out[key]! : undefined;
    if (!rec) { out[map] = { games: 0, wins: null, playerGames: { ...games } }; continue; }
    if (!rec.playerGames) continue;
    const pg: Record<string, number> = { ...rec.playerGames };
    for (const [id, g] of Object.entries(games)) pg[id] = (pg[id] ?? 0) + g;
    out[key!] = { ...rec, playerGames: pg };
  }
  return out;
}
