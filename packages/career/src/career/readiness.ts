// Match readiness: how fit and sharp a player is on a match day, and how that reaches the match.
//
//   fatigue f   the club layer's training fatigue (club/training.ts, weekly) plus match load:
//               every map played adds MATCH_READINESS.mapLoad (capped at 1); training weeks
//               recover it as before
//   sharpness s 0..1, from playing: each map played moves it toward 1,
//                 s ← s + sharpGain · (1 − s)
//               and it fades with days without a match,
//                 s(t) = s_last · exp(−days / sharpTau)
//   readiness R = (1 − fatigueCost · max(0, f − fatigueFree)) · (1 − sharpCost · (1 − s))
//
// R scales a player's ability attributes toward the league floor for that match only:
//   x' = min_k + R · (x − min_k)                (min_k = the calibration's real minimum)
// so a tired or rusty player plays below their rating in proportion to how good they are — no flat
// bonus. The engine (match-runner rosters) and the quick estimate (lineup ability) both read x'.
import type { AttrSlot, World, WorldPlayer } from "../model.ts";
import { ABILITY_KEYS } from "../model.ts";
import { CLUB_MODEL } from "../club/constants.ts";
import { daysBetween, type IsoDate } from "./calendar.ts";
import type { CareerState } from "./types.ts";

export const MATCH_READINESS = {
  /** Fatigue a map adds. */
  mapLoad: 0.03,
  /** Fatigue below this costs nothing (the training model's fatigueFree). */
  fatigueFree: CLUB_MODEL.fatigueFree,
  /** Ability lost per unit of fatigue above fatigueFree. */
  fatigueCost: 0.25,
  /** Sharpness gained per map: s ← s + sharpGain · (1 − s). */
  sharpGain: 0.2,
  /** Days for sharpness to fall to 1/e without matches. */
  sharpTau: 30,
  /** Ability lost at zero sharpness. */
  sharpCost: 0.08,
  /** Sharpness of a player who has not played yet in the career. */
  sharpStart: 0.6,
} as const;

const M = MATCH_READINESS;

export function fatigueOf(w: World, playerId: string): number {
  return w.club?.training.exposure[playerId]?.fatigue ?? CLUB_MODEL.fatigueStart;
}

export function sharpnessOf(state: CareerState, playerId: string, date: IsoDate = state.date): number {
  const line = state.stats[playerId];
  const s = line?.sharpness ?? M.sharpStart;
  const last = line?.lastPlayed;
  return last ? s * Math.exp(-Math.max(0, daysBetween(last, date)) / M.sharpTau) : s;
}

export function readiness(state: CareerState, playerId: string): number {
  const f = fatigueOf(state.world, playerId);
  const s = sharpnessOf(state, playerId);
  return Math.max(0, (1 - M.fatigueCost * Math.max(0, f - M.fatigueFree)) * (1 - M.sharpCost * (1 - s)));
}

/** A player's attributes for today's match (ability attributes pulled toward the floor by R). */
export function matchAttributes(state: CareerState, p: WorldPlayer): Record<string, AttrSlot> | null {
  if (!p.attributes) return null;
  const R = readiness(state, p.playerId);
  const min = state.world.calibration.min;
  const out: Record<string, AttrSlot> = {};
  for (const [k, slot] of Object.entries(p.attributes)) {
    if (slot.value === null || !(ABILITY_KEYS as readonly string[]).includes(k)) { out[k] = slot; continue; }
    const lo = min[k as keyof typeof min] ?? 0;
    out[k] = { ...slot, value: Math.round((lo + R * (slot.value - lo)) * 10000) / 10000 };
  }
  return out;
}

/** Today's five as match-runner roster players (game-data shape) with readiness applied. */
export function matchRoster(state: CareerState, lineup: readonly string[]): Array<{ playerId: string; attributes: Record<string, AttrSlot> | null; hasRatings: boolean }> {
  return lineup.map((id) => state.world.players[id]).filter((p): p is WorldPlayer => !!p)
    .map((p) => ({ playerId: p.playerId, attributes: matchAttributes(state, p), hasRatings: p.hasRatings }));
}

/** After a series: match load on fatigue and sharpness for the players who played `maps` maps. */
export function applyMatchLoad(state: CareerState, lineup: readonly string[], maps: number): void {
  const ex = state.world.club?.training.exposure;
  for (const id of lineup) {
    const line = state.stats[id];
    if (line) {
      let s = sharpnessOf(state, id);
      for (let i = 0; i < maps; i++) s += M.sharpGain * (1 - s);
      line.sharpness = Math.round(s * 10000) / 10000;
      line.lastPlayed = state.date;
    }
    if (ex) {
      const e = (ex[id] ??= { mechanics: 0, utility: 0, teamplay: 0, weeks: 0, fatigue: CLUB_MODEL.fatigueStart });
      e.fatigue = Math.round(Math.min(1, e.fatigue + M.mapLoad * maps) * 10000) / 10000;
    }
  }
}
