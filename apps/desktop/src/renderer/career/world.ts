// Career world for the desktop: built from the copied dataset fixtures (ratings, names, teams,
// rosters) with @pv/career — the real players and teams plus generated prospects and staff, and
// the season loop that brings new ones in. The package is pure TS and imported by relative path
// so the node:test unit tests can load this module without the Vite alias.
import {
  createWorld, deserializeWorld, serializeWorld, toScale200, estimateAbility, teamScout,
  type RealPlayerInput, type RealTeamInput, type World, type WorldPlayer,
} from '../../../../../packages/career/src/index.ts';

export * from '../../../../../packages/career/src/index.ts';

/** The season the dataset describes; a fresh world opens here. */
export const START_SEASON = 2026;
/** World seed of a fresh desktop career (fixed so every fresh world is the same). */
export const DESKTOP_SEED = 2026;
export const STORE_KEY = 'pv-career-world-v1';

export interface DesktopFixtures {
  ratings: Array<{ playerId: string; role: string; agentPool: string[]; attributes: unknown; seasons?: number[] }>;
  names: { players: Array<{ playerId: string; handle: string; country: string | null }> };
  teams: { teams: Array<{ teamId: string; name: string; country: string | null }> };
  rosters: Record<string, Array<{ playerId: string }>>;
  /** Every real handle in the dataset (normalised), including players the desktop has no ratings for. */
  reservedHandles: { handles: string[] };
}

export function buildDesktopWorld(f: DesktopFixtures, seed = DESKTOP_SEED): World {
  const nameById = new Map(f.names.players.map((p) => [p.playerId, p]));
  const players: RealPlayerInput[] = f.ratings.map((r) => ({
    playerId: r.playerId,
    handle: nameById.get(r.playerId)?.handle ?? null,
    country: nameById.get(r.playerId)?.country ?? null,
    role: r.role,
    attributes: r.attributes,
    hasRatings: true,
    agentPool: r.agentPool,
    seasons: r.seasons ?? null,
  }));
  const teams: RealTeamInput[] = f.teams.teams.map((t) => ({
    teamId: t.teamId, name: t.name, country: t.country,
    roster: (f.rosters[t.teamId] ?? []).map((r) => r.playerId),
  }));
  return createWorld({ seed, season: START_SEASON, players, teams, reservedHandles: f.reservedHandles.handles });
}

/** A saved world, or null when there is none / it does not load. */
export function loadSavedWorld(text: string | null | undefined): World | null {
  if (!text) return null;
  try { return deserializeWorld(text); } catch { return null; }
}

export { serializeWorld };

/** CA / PA as the viewer's scouts see them, on the 1–200 scale. */
export function scoutedAbility(w: World, viewerTeamId: string | null, p: WorldPlayer) {
  const e = estimateAbility(w, teamScout(w, viewerTeamId), p);
  return {
    ca: toScale200(e.ca)!, caLo: toScale200(e.caLo)!, caHi: toScale200(e.caHi)!,
    pa: toScale200(e.pa)!, paLo: toScale200(e.paLo)!, paHi: toScale200(e.paHi)!,
  };
}
