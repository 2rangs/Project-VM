// Building the starting world from the real dataset, and queries over a world.
import { CAREER_MODEL, impliedPeak } from "./ability.ts";
import { deriveCalibration, type RealPlayerInput } from "./calibration.ts";
import { generateStaff } from "./generate.ts";
import {
  ABILITY_KEYS, ROLES, STAFF_ROLES,
  type AbilityKey, type AttrSlot, type Role, type World, type WorldPlayer, type WorldStaff, type WorldTeam,
} from "./model.ts";
import { normalizeHandle } from "./names.ts";
import { regionOf, type Region } from "./regions.ts";
import { estimateAbility, teamScout } from "./scouting.ts";
import { caOf, emptyRecord, openSeason, regionPopulation, SEASON_MODEL } from "./season.ts";
import { streamFor } from "./rng.ts";

export interface RealTeamInput {
  readonly teamId: string;
  readonly name: string | null;
  readonly country: string | null;
  /** Rostered player ids, most-played first. */
  readonly roster: readonly string[];
}

export interface CreateWorldOptions {
  readonly seed: number;
  /** The season the world opens in (the dataset's current season). */
  readonly season: number;
  readonly players: readonly RealPlayerInput[];
  readonly teams: readonly RealTeamInput[];
  /** Open the first season with a prospect intake (default true). */
  readonly initialIntake?: boolean;
  /** More real handles no generated player may take (players not in `players`), any casing. */
  readonly reservedHandles?: readonly string[];
}

const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

/**
 * A real player's estimated age: debut at CAREER_MODEL.debutAge in their first dataset season;
 * players already present in the dataset's first season (left-censored) get 0–3 extra years;
 * players with no season record are 2–5 years past a debut.
 */
export function estimateRealAge(seed: number, p: RealPlayerInput, season: number): number {
  const m = CAREER_MODEL;
  const u = streamFor(seed, `age:${p.playerId}`)();
  const seasons = (p.seasons ?? []).filter((s) => Number.isFinite(s));
  if (seasons.length === 0) return m.debutAge + 2 + Math.floor(u * 4);
  const first = Math.min(...seasons);
  const censored = first <= m.datasetFirstSeason ? Math.floor(u * 4) : 0;
  return m.debutAge + Math.max(0, season - first) + censored;
}

function realPlayer(w: World, p: RealPlayerInput, season: number, region: Region): WorldPlayer {
  const role = isRole(p.role) ? p.role : null;
  const attributes = p.hasRatings && p.attributes ? (JSON.parse(JSON.stringify(p.attributes)) as Record<string, AttrSlot>) : null;
  const age = estimateRealAge(w.seed, p, season);
  const base = { attributes, role, hasRatings: p.hasRatings && !!attributes };
  const ca = caOf(w, base);
  let peak: Partial<Record<AbilityKey, number>> | null = null;
  if (base.hasRatings && attributes) {
    peak = {};
    for (const k of ABILITY_KEYS) {
      const v = (attributes[k] as { value?: number | null } | undefined)?.value;
      if (typeof v === "number") peak[k] = Math.round(impliedPeak(v, age, k, w.calibration.min[k], w.calibration.max[k]) * 10000) / 10000;
    }
  }
  const pa = peak ? caOf(w, { attributes: Object.fromEntries(ABILITY_KEYS.map((k) => [k, { value: peak![k] ?? null, uncertainty: 0 }])) as Record<string, AttrSlot>, role, hasRatings: true }) : null;
  return {
    playerId: p.playerId,
    handle: p.handle,
    country: p.country,
    role,
    attributes,
    hasRatings: base.hasRatings,
    name: null,
    region,
    agentPool: [...(p.agentPool ?? [])],
    origin: "real",
    generated: false,
    age,
    ageEstimated: true,
    debutSeason: season,
    peak,
    ca,
    pa: pa !== null && ca !== null ? Math.max(pa, ca) : pa,
    teamId: null,
    status: "free",
    careerMaps: 0,
  };
}

export function createWorld(opts: CreateWorldOptions): World {
  const calibration = deriveCalibration(opts.players);
  const w: World = {
    version: 1,
    seed: opts.seed >>> 0,
    startSeason: opts.season,
    season: opts.season,
    players: {},
    staff: {},
    teams: {},
    regionTargets: { americas: 0, emea: 0, pacific: 0, china: 0 },
    staffTarget: 0,
    calibration,
    reservedHandles: [],
    nextGenId: 0,
    history: [],
    retired: [],
  };

  // Teams and their rosters (a player listed by two teams belongs to the first by team id).
  const teamRegion = new Map<string, Region>();
  const rosterOf = new Map<string, string>();
  for (const t of [...opts.teams].sort((a, b) => a.teamId.localeCompare(b.teamId))) {
    const region = regionOf(t.country);
    teamRegion.set(t.teamId, region);
    w.teams[t.teamId] = { teamId: t.teamId, name: t.name ?? t.teamId, country: t.country, region, roster: [], academy: [], staff: {} };
    for (const id of t.roster) if (!rosterOf.has(id)) rosterOf.set(id, t.teamId);
  }
  for (const p of opts.players) {
    const teamId = rosterOf.get(p.playerId) ?? null;
    const known = p.country && /^[a-z]{2}$/i.test(p.country) && !["un", "eu"].includes(p.country.toLowerCase());
    const region = known ? regionOf(p.country) : teamId ? teamRegion.get(teamId)! : "emea";
    const wp = realPlayer(w, p, opts.season, region);
    if (teamId) { wp.teamId = teamId; wp.status = "rostered"; }
    w.players[wp.playerId] = wp;
  }
  for (const t of [...opts.teams].sort((a, b) => a.teamId.localeCompare(b.teamId))) {
    w.teams[t.teamId]!.roster = t.roster.filter((id) => rosterOf.get(id) === t.teamId && w.players[id]);
  }
  for (const p of opts.players) if (p.handle) w.reservedHandles.push(normalizeHandle(p.handle));
  for (const h of opts.reservedHandles ?? []) w.reservedHandles.push(normalizeHandle(h));
  w.reservedHandles = [...new Set(w.reservedHandles)].sort();
  const pop = regionPopulation(w);
  (w as { regionTargets: Record<Region, number> }).regionTargets = pop;

  // Founding staff: the dataset has none, so every team's staff is generated.
  const teams = Object.values(w.teams).sort((a, b) => a.teamId.localeCompare(b.teamId));
  for (const t of teams) {
    for (const role of STAFF_ROLES) {
      const id = `gs-${opts.season}-${w.nextGenId.toString(36).padStart(4, "0")}`;
      w.nextGenId += 1;
      const s = generateStaff({ seed: w.seed, id, region: t.region, role, season: opts.season, calibration, founding: true });
      s.teamId = t.teamId;
      w.staff[id] = s;
      t.staff[role] = id;
    }
  }
  (w as { staffTarget: number }).staffTarget = Math.round(teams.length * STAFF_ROLES.length * (1 + SEASON_MODEL.freeStaffPerTeamRole));

  const rec = emptyRecord(w, opts.season);
  if (opts.initialIntake !== false) openSeason(w, opts.season, rec);
  w.history.push(rec);
  return w;
}

// --- Queries --------------------------------------------------------------------------------------

export function listPlayers(w: World, filter?: (p: WorldPlayer) => boolean): WorldPlayer[] {
  return Object.values(w.players).filter((p) => !filter || filter(p)).sort((a, b) => a.playerId.localeCompare(b.playerId));
}

export const freeAgents = (w: World): WorldPlayer[] => listPlayers(w, (p) => p.status === "free");
export const generatedPlayers = (w: World): WorldPlayer[] => listPlayers(w, (p) => p.generated);

/** The prospects that entered the world in a season (default: the current one), still active. */
export function newProspects(w: World, season = w.season): WorldPlayer[] {
  const rec = w.history.find((h) => h.season === season);
  return (rec?.newPlayers ?? []).map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p);
}

export function newStaff(w: World, season = w.season): WorldStaff[] {
  const rec = w.history.find((h) => h.season === season);
  return (rec?.newStaff ?? []).map((id) => w.staff[id]).filter((s): s is WorldStaff => !!s);
}

/**
 * A team's starting five for a match, as game-data-shaped players (for match-runner
 * `MatchConfig.rosters`). Strongest by CA first; fewer than five when the roster is short.
 */
export function startingFive(w: World, teamId: string): WorldPlayer[] {
  const t = w.teams[teamId];
  if (!t) return [];
  return t.roster.map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p).slice(0, SEASON_MODEL.starters);
}

/** Staff values for the series layer's pre-match options (match-runner SeriesTeamConfig.staff). */
export function teamStaffInputs(w: World, teamId: string): { analyst: number } {
  const id = w.teams[teamId]?.staff.analyst;
  return { analyst: id ? w.staff[id]?.attributes.analysis ?? 0 : 0 };
}

/** Scout-eye view of a player from a team's perspective (no team / no scout → widest bands). */
export function scoutView(w: World, viewerTeamId: string | null, p: WorldPlayer) {
  return estimateAbility(w, teamScout(w, viewerTeamId), p);
}

export function teamOf(w: World, p: WorldPlayer): WorldTeam | null {
  return p.teamId ? w.teams[p.teamId] ?? null : null;
}

/** Population per region plus the totals (for the stability check and UI). */
export function populationSummary(w: World): { players: number; generated: number; staff: number; byRegion: Record<Region, number> } {
  const byRegion = regionPopulation(w);
  const all = Object.values(w.players);
  return { players: all.length, generated: all.filter((p) => p.generated).length, staff: Object.keys(w.staff).length, byRegion };
}

