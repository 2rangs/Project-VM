// Per-map knowledge for the series layer (match-runner mastery / scouting / veto):
//   - map comps:   per-map agent pick rates, role templates and top comps (map-comps.json)
//   - agent pools: which agents each player has played (agent-pools.json)
//   - map history: a team's record per map (map-history.json when built from the VCT Reference
//                  DuckDB; otherwise only the games-played counts in teams.json `mapPool`)
// Regenerate the first two with tools/catalog-builder/build_map_data.py.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeAgentSlug, normalizeId } from "./normalize.ts";
import type { RosterEntry, Team } from "./types.ts";

const DATA = new URL("../data/", import.meta.url);
function loadOptional<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL(name, DATA)), "utf8")) as T;
  } catch {
    return null;
  }
}

export interface MapComp {
  /** Five agent slugs, sorted. */
  readonly comp: readonly string[];
  /** Team-maps the comp was played on. */
  readonly maps: number;
  /** Raw map win rate of the comp (small samples — shrink before use). */
  readonly mapWinRate: number;
}
export interface MapCompData {
  /** Team-maps in the sample. */
  readonly teamMaps: number;
  /** Attack-side round win rate on the map. */
  readonly atkRoundWR: number;
  readonly roleTemplates: ReadonlyArray<{ readonly template: Readonly<Record<string, number>>; readonly maps: number; readonly share: number }>;
  readonly pickRate: ReadonlyArray<{ readonly agent: string; readonly role: string; readonly pickRate: number; readonly maps: number }>;
  readonly topComps: readonly MapComp[];
}

/** One team's record on one map. `wins` / `playerGames` are null when only the count is known. */
export interface TeamMapRecord {
  /** Maps played. */
  readonly games: number;
  /** Maps won, or null when results are not in the data. */
  readonly wins: number | null;
  /** Games each player has played on this map WITH this team, or null when not in the data. */
  readonly playerGames: Readonly<Record<string, number>> | null;
}

/** Shape of the optional data/map-history.json (built from the VCT Reference DuckDB). */
export interface TeamMapHistoryBundle {
  readonly teams: Readonly<Record<string, Readonly<Record<string, TeamMapRecord>>>>;
  readonly provenance?: unknown;
}

let _comps: Record<string, MapCompData> | null = null;
let _pools: Record<string, string[]> | null = null;
let _history: TeamMapHistoryBundle | null | undefined;
let _teams: Map<string, Team> | null = null;
let _rosters: Record<string, RosterEntry[]> | null = null;

const key = (map: string): string => map.trim().toLowerCase();

function comps(): Record<string, MapCompData> {
  if (_comps) return _comps;
  const raw = loadOptional<{ maps: Record<string, MapCompData> }>("map-comps.json");
  _comps = {};
  for (const [name, data] of Object.entries(raw?.maps ?? {})) _comps[key(name)] = data;
  return _comps;
}

/** Comp statistics for a map (case-insensitive), or undefined when none have been built for it. */
export function getMapComps(map: string): MapCompData | undefined {
  return comps()[key(map)];
}
/** Maps that have comp statistics. */
export function listMapsWithComps(): string[] {
  return Object.keys(loadOptional<{ maps: Record<string, unknown> }>("map-comps.json")?.maps ?? {});
}

/** Agents a player has played (normalized slugs), or null when the player has no record. */
export function getAgentPool(playerId: string): readonly string[] | null {
  if (!_pools) {
    const raw = loadOptional<{ pools: Record<string, string[]> }>("agent-pools.json");
    _pools = {};
    for (const [id, list] of Object.entries(raw?.pools ?? {})) _pools[normalizeId(id)] = list.map(normalizeAgentSlug);
  }
  return _pools[normalizeId(playerId)] ?? null;
}

function teams(): Map<string, Team> {
  if (_teams) return _teams;
  _teams = new Map((loadOptional<Team[]>("teams.json") ?? []).map((t) => [normalizeId(t.teamId), t]));
  return _teams;
}
function rosters(): Record<string, RosterEntry[]> {
  if (!_rosters) _rosters = loadOptional<Record<string, RosterEntry[]>>("rosters.json") ?? {};
  return _rosters;
}

/** Whether per-map results (wins, per-player games) are available, or only games-played counts. */
export function hasMapResults(): boolean {
  if (_history === undefined) _history = loadOptional<TeamMapHistoryBundle>("map-history.json");
  return _history !== null;
}

/**
 * A team's record per map (map name → record). With data/map-history.json present this is the
 * full record; without it only `games` is known (teams.json `mapPool`) and `wins` / `playerGames`
 * are null — consumers must treat those as unknown, not as zero.
 */
export function getTeamMapRecords(teamId: string): Readonly<Record<string, TeamMapRecord>> {
  const id = normalizeId(teamId);
  if (hasMapResults()) {
    const full = _history!.teams[id];
    if (full) return full;
  }
  const pool = teams().get(id)?.mapPool ?? {};
  const out: Record<string, TeamMapRecord> = {};
  for (const [map, games] of Object.entries(pool)) out[map] = { games, wins: null, playerGames: null };
  return out;
}

/** Every team's games-played count on every map it has played (for league-level reference values). */
export function listTeamMapGames(): Array<{ readonly teamId: string; readonly map: string; readonly games: number }> {
  const out: Array<{ teamId: string; map: string; games: number }> = [];
  for (const t of teams().values()) {
    if ((rosters()[normalizeId(t.teamId)]?.length ?? 0) < 5) continue;
    for (const [map, rec] of Object.entries(getTeamMapRecords(t.teamId))) out.push({ teamId: t.teamId, map, games: rec.games });
  }
  return out;
}
