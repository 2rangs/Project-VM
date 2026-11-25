// Node-only: the starting world from @pv/game-data (real players, teams, rosters, agent pools)
// plus each player's seasons from the derived ratings dataset (for the age estimate).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentPool, getTeam, getTeamMapRecords, listPlayers, listTeams } from "@pv/game-data";
import type { RealPlayerInput } from "./calibration.ts";
import type { World } from "./model.ts";
import { createWorld, type RealTeamInput } from "./world.ts";
import { newCareer } from "./career/career.ts";
import { regionTeams } from "./career/schedule.ts";
import { lineupStrength, mapShare, setMapRecords } from "./career/quick-sim.ts";
import type { FitSeries } from "./career/quick-fit.ts";
import type { CareerState, SeriesRequest } from "./career/types.ts";

const RATINGS = new URL("../../../datasets/derived/ratings/player_ratings.json", import.meta.url);

function seasonsById(): Map<string, number[]> {
  try {
    const rows = JSON.parse(readFileSync(fileURLToPath(RATINGS), "utf8")) as Array<{ playerId: string; seasons?: number[] }>;
    return new Map(rows.map((r) => [String(r.playerId), r.seasons ?? []]));
  } catch {
    return new Map();
  }
}

/** Real players as calibration / world input. */
export function realPlayersFromGameData(): RealPlayerInput[] {
  const seasons = seasonsById();
  return listPlayers().map((p) => ({
    playerId: p.playerId,
    handle: p.handle,
    country: p.country,
    role: p.role,
    attributes: p.attributes,
    hasRatings: p.hasRatings,
    agentPool: getAgentPool(p.playerId) ?? [],
    seasons: seasons.get(p.playerId) ?? null,
  }));
}

export function realTeamsFromGameData(): RealTeamInput[] {
  return listTeams().map((t) => ({
    teamId: t.teamId,
    name: t.name,
    country: t.country,
    roster: (getTeam(t.teamId)?.roster ?? []).map((r) => r.playerId),
  }));
}

/** The dataset's current season (rosters are "recent seasons ≥ 2025"; ratings run through 2026). */
export const DATASET_SEASON = 2026;

export function worldFromGameData(seed: number, opts: { season?: number; initialIntake?: boolean } = {}): World {
  return createWorld({ seed, season: opts.season ?? DATASET_SEASON, players: realPlayersFromGameData(), teams: realTeamsFromGameData(), initialIntake: opts.initialIntake });
}

/** Real map records (`[games, wins]` per team and map since 2025) for `setMapRecords`, for every team of the world. */
export function mapRecordsFromGameData(): Record<string, Record<string, [number, number]>> {
  const out: Record<string, Record<string, [number, number]>> = {};
  for (const t of listTeams()) {
    const rec = getTeamMapRecords(t.teamId);
    const row: Record<string, [number, number]> = {};
    for (const [map, r] of Object.entries(rec)) if (r.wins !== null) row[map] = [r.games, r.wins];
    if (Object.keys(row).length) out[t.teamId] = row;
  }
  return out;
}

// The committed small calibration set, or a larger regenerated one when PV_CALIBRATION_DATA points
// at it (an absolute path or one relative to the repo root; tools/career/refit-quick-sim.sh sets it).
const CALIBRATION = process.env.PV_CALIBRATION_DATA
  ? new URL(`file://${resolve(process.env.PV_CALIBRATION_DATA)}`)
  : new URL("../../../tools/career/calibration-data.json", import.meta.url);

/** One engine-played Bo3 of the calibration set: the request that was simulated and its map scores (A = home). */
export interface CalibrationSeries {
  readonly a: string; readonly b: string; readonly winA: number;
  readonly req: SeriesRequest;
  readonly games: ReadonlyArray<{ map: string; A: number; B: number }>;
}

/**
 * The cached engine series (tools/career/calibration-data.json, played by match-runner `runSeries`
 * between random teams of the four regions with their career fives) as likelihood data, with the
 * career state their lineups are read from and the real map records registered for the map pools.
 */
export function loadCalibration(): { seed: number; played: CalibrationSeries[]; series: FitSeries[]; career: CareerState } {
  const cached = JSON.parse(readFileSync(fileURLToPath(CALIBRATION), "utf8")) as { seed: number; played: CalibrationSeries[] };
  setMapRecords(mapRecordsFromGameData());
  const w = worldFromGameData(cached.seed);
  const career = newCareer(w, { seed: cached.seed, manager: { name: "cal", nationality: "kr" }, userTeamId: regionTeams(w, "pacific")[0]! });
  const series: FitSeries[] = cached.played.map((p) => ({
    d: lineupStrength(career, p.req.home.lineup) - lineupStrength(career, p.req.away.lineup),
    winA: p.winA,
    maps: p.games.map((g) => {
      const ma = mapShare(p.a, g.map); const mb = mapShare(p.b, g.map);
      return { a: g.A, b: g.B, m: ma !== null && mb !== null ? ma - mb : 0 };
    }),
  }));
  return { seed: cached.seed, played: cached.played, series, career };
}
