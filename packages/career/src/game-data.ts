// Node-only: the starting world from @pv/game-data (real players, teams, rosters, agent pools)
// plus each player's seasons from the derived ratings dataset (for the age estimate).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAgentPool, getTeam, getTeamMapRecords, listPlayers, listTeams } from "@pv/game-data";
import type { RealPlayerInput } from "./calibration.ts";
import type { World } from "./model.ts";
import { createWorld, type RealTeamInput } from "./world.ts";

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
