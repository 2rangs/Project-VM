// Data access for the manager UI. Loads the copied PV-1/PV-2 fixtures, joins
// ids→names, and exposes helpers. All values are SYNTHETIC/ESTIMATED (see
// src/data/README.md). Real VCT names are shown by user decision (pre-launch).
import playerRatings from '../data/player_ratings.json';
import playerNames from '../data/player_names.json';
import ratingsMeta from '../data/ratings_meta.json';
import teamNames from '../data/team_names.json';
import teamProfiles from '../data/team_profiles.json';
import ascentTactics from '../data/ascent-tactics.json';
import ascentComps from '../data/ascent-comps.json';

export interface Attr { value: number | null; uncertainty: number | null; nMaps?: number; proxyConfidence?: number; shrunkToward?: string }
export interface RatingRow {
  playerId: string; maps: number; role: string; agentPool: string[];
  lowSample: boolean; attributes: Record<string, Attr>;
}
export interface JoinedPlayer extends RatingRow { handle: string; country: string | null }

const nameById = new Map<string, { handle: string; country: string | null }>(
  (playerNames as { players: Array<{ playerId: string; handle: string; country: string | null }> }).players
    .map((p) => [p.playerId, { handle: p.handle, country: p.country }]),
);
const teamNameById = new Map<string, { name: string; country: string | null }>(
  (teamNames as { teams: Array<{ teamId: string; name: string; country: string | null }> }).teams
    .map((t) => [t.teamId, { name: t.name, country: t.country }]),
);

export const RATINGS_DISCLAIMER = (playerNames as { meta: { disclaimer: string } }).meta.disclaimer;
export const TEAMS_DISCLAIMER = (teamNames as { meta: { disclaimer: string } }).meta.disclaimer;
export const RATINGS_META = ratingsMeta as Record<string, unknown>;

/** 0..1 estimate → manager-convention 1..20 scale. Documented conversion. */
export function toScale20(v: number | null): number | null {
  return v == null ? null : Math.max(1, Math.min(20, Math.round(1 + v * 19)));
}

export function players(): JoinedPlayer[] {
  return (playerRatings as unknown as RatingRow[]).map((r) => ({
    ...r,
    handle: nameById.get(r.playerId)?.handle ?? `#${r.playerId}`,
    country: nameById.get(r.playerId)?.country ?? null,
  }));
}

export function playerById(id: string): JoinedPlayer | undefined {
  return players().find((p) => p.playerId === id);
}

// Attribute groups (README §23.1). Keys that are absent on a player simply skip.
export const ATTR_GROUPS: Record<string, string[]> = {
  Mechanical: ['aim', 'crosshairPlacement', 'firstBulletAccuracy', 'reaction', 'tracking', 'movement', 'weaponControl'],
  Tactical: ['positioning', 'utilityUsage', 'entryAggression', 'trading', 'mapAwareness', 'rotations'],
  Mental: ['impact', 'clutch', 'consistency'],
  Team: ['communication', 'teamworkDiscipline'],
  Specialization: ['lurking', 'anchoring', 'weaponPreference', 'agentMastery'],
};

export interface TeamProfile {
  teamId: string; maps: number; mapPool: Record<string, number>; lowSample: boolean;
  economy: Record<string, { value: number | null; n?: number; uncertainty?: number | null }>;
}
export interface JoinedTeam extends TeamProfile { name: string; country: string | null }

export function teams(): JoinedTeam[] {
  return (teamProfiles as unknown as TeamProfile[]).map((t) => ({
    ...t,
    name: teamNameById.get(t.teamId)?.name ?? `Team ${t.teamId}`,
    country: teamNameById.get(t.teamId)?.country ?? null,
  })).filter((t) => teamNameById.has(t.teamId)); // only teams we have names for
}

export const tactics = ascentTactics as unknown as {
  map: string;
  attack: unknown; defense: unknown;
  provenanceLegend: Record<string, string>;
  caveats: string[];
};
export const comps = ascentComps as unknown as {
  map: string; topComps?: unknown[]; pickRate?: Record<string, unknown>;
  roleTemplates?: unknown; provenance?: Record<string, unknown>; sampleCaveats?: string[];
};
