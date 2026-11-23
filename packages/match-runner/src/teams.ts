/**
 * Real team & player data from @pv/game-data (PV-1), wired into the match.
 *
 * - `resolveTeamRef(id)` → the real display name for a team id (falls back to the id).
 * - `teamSkills(id)` → a team-aggregate CombatSkills built by averaging the roster's real
 *   player ratings (game-data attributes map 1:1 onto CombatSkills keys); players without
 *   ratings (`hasRatings:false`) and unknown teams fall back to AVERAGE_SKILLS. This feeds the
 *   round-simulator's per-side skill, so stronger rosters shoot better — a real-data signal
 *   without touching PV-4's SimState (per-player skills are a later, finer pass).
 */
import { getTeam, getPlayer, listSimulatableTeams, type Player } from "@pv/game-data";
import { AVERAGE_SKILLS, type CombatSkills } from "@pv/combat-engine";
import { AVERAGE_TRAITS, type TacticalTraits } from "@pv/round-simulator";
import { NEUTRAL_PROFILE, type PlayerProfile } from "@pv/shared-types";
import type { TeamRef } from "./match.js";

/**
 * A player the match can field instead of the team's game-data roster (MatchConfig.rosters): any
 * game-data-shaped player — e.g. a generated prospect from a career world (@pv/career).
 */
export type RosterPlayer = Pick<Player, "playerId" | "attributes" | "hasRatings">;

const SKILL_KEYS: ReadonlyArray<keyof CombatSkills> = [
  "aim",
  "reaction",
  "tracking",
  "firstBulletAccuracy",
  "crosshairPlacement",
  "movement",
  "weaponControl",
];

/** Resolve a team id to its real name via game-data; fall back to the id when unknown. */
export function resolveTeamRef(id: string): TeamRef {
  const team = getTeam(id);
  return { id, name: team?.name ?? id };
}

/**
 * Every game-data team with a full roster, as the `TeamRef` a MatchConfig takes. game-data keys
 * teams by `teamId` (there is no `id` field): reading `t.id` gives `undefined`, which resolves to
 * no team and silently plays both sides with league-average players. Build team refs here.
 */
export function simulatableTeamRefs(): TeamRef[] {
  return listSimulatableTeams().map((t) => ({ id: t.teamId, name: t.name ?? t.teamId }));
}

/** Whether game-data knows this team (has a roster). */
export function isKnownTeam(id: string): boolean {
  return getTeam(id) !== undefined;
}

function attrValue(attrs: unknown, key: string): number | null {
  const a = attrs as Record<string, unknown> | null;
  const slot = a?.[key] as { value?: number } | undefined;
  return typeof slot?.value === "number" ? slot.value : null;
}

function skillsFromAttributes(attrs: unknown, hasRatings: boolean): CombatSkills {
  const out = {} as Record<keyof CombatSkills, number>;
  for (const key of SKILL_KEYS) {
    const v = hasRatings ? attrValue(attrs, key) : null;
    out[key] = v !== null ? v : AVERAGE_SKILLS[key];
  }
  return out;
}

/**
 * Team-aggregate CombatSkills from the roster's real ratings. Each skill is the mean of the
 * rostered players' values for that attribute; missing values fall back to AVERAGE_SKILLS.
 */
export function teamSkills(id: string): CombatSkills {
  const team = getTeam(id);
  if (!team) return AVERAGE_SKILLS;
  const players = team.roster.map((r) => getPlayer(r.playerId)).filter((p): p is NonNullable<typeof p> => !!p);
  if (players.length === 0) return AVERAGE_SKILLS;

  const out = {} as Record<keyof CombatSkills, number>;
  for (const key of SKILL_KEYS) {
    const vals = players
      .map((p) => (p.hasRatings ? attrValue(p.attributes, key) : null))
      .filter((v): v is number => v !== null);
    out[key] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : AVERAGE_SKILLS[key];
  }
  return out;
}

/**
 * Per-player CombatSkills for the first `count` roster players (real ratings, AVERAGE fallback
 * for players without ratings or beyond the roster). Feeds runMatchRound's per-player `skills`.
 */
export function rosterSkills(id: string, count: number, override?: readonly RosterPlayer[]): CombatSkills[] {
  const players = override ?? gameDataRoster(id);
  const out: CombatSkills[] = [];
  for (let i = 0; i < count; i++) {
    const p = players[i];
    out.push(p ? skillsFromAttributes(p.attributes, p.hasRatings) : AVERAGE_SKILLS);
  }
  return out;
}

/** A team's game-data roster (empty for an unknown team). */
function gameDataRoster(id: string): RosterPlayer[] {
  const team = getTeam(id);
  return team ? team.roster.map((r) => getPlayer(r.playerId)).filter((p): p is NonNullable<typeof p> => !!p) : [];
}

/**
 * The first `count` players of a team (undefined beyond the roster / unknown team): the override
 * when one is given (MatchConfig.rosters), else the game-data roster.
 */
function rosterPlayers(id: string, count: number, override?: readonly RosterPlayer[]): Array<RosterPlayer | undefined> {
  const players = override ?? gameDataRoster(id);
  return Array.from({ length: count }, (_, i) => players[i]);
}

/** A rated attribute in [0,1], or the fallback when the player/attribute has no rating. */
function rated(p: ReturnType<typeof rosterPlayers>[number], key: string, fallback: number): number {
  const v = p?.hasRatings ? attrValue(p.attributes, key) : null;
  return v !== null ? v : fallback;
}

/**
 * Per-player TacticalTraits (the duel-situation ratings; docs/STAT_OUTCOME_MATRIX.md):
 *   gameSense ← impact   (round impact is the available proxy for reading the fight)
 *   trading   ← trading
 *   clutch    ← clutch
 * Unrated players get the league-average trait.
 */
export function rosterTraits(id: string, count: number, override?: readonly RosterPlayer[]): TacticalTraits[] {
  return rosterPlayers(id, count, override).map((p) => ({
    gameSense: rated(p, "impact", AVERAGE_TRAITS.gameSense),
    trading: rated(p, "trading", AVERAGE_TRAITS.trading),
    clutch: rated(p, "clutch", AVERAGE_TRAITS.clutch),
  }));
}

/** Decision tendencies without the (side-dependent) sim player id. */
export type RosterProfile = Omit<PlayerProfile, "playerId">;

/**
 * Per-player decision profile (drives throws / save-vs-hero calls in the TeamDecisionPolicy):
 *   aggression     ← entryAggression
 *   discipline     ← consistency       (teamworkDiscipline has no rating yet)
 *   decisionMaking ← mean(impact, clutch)
 *   teamwork       ← trading
 * Unrated players get NEUTRAL_PROFILE.
 */
export function rosterProfiles(id: string, count: number, override?: readonly RosterPlayer[]): RosterProfile[] {
  return rosterPlayers(id, count, override).map((p) => ({
    aggression: rated(p, "entryAggression", NEUTRAL_PROFILE.aggression),
    discipline: rated(p, "consistency", NEUTRAL_PROFILE.discipline),
    decisionMaking: (rated(p, "impact", NEUTRAL_PROFILE.decisionMaking) + rated(p, "clutch", NEUTRAL_PROFILE.decisionMaking)) / 2,
    teamwork: rated(p, "trading", NEUTRAL_PROFILE.teamwork),
  }));
}

/** Per-player consistency rating (league average 0.6 when unrated) — sizes the round-form swing. */
export function rosterConsistency(id: string, count: number, override?: readonly RosterPlayer[]): number[] {
  return rosterPlayers(id, count, override).map((p) => rated(p, "consistency", 0.6));
}

/** Form standard deviation for a player with consistency 0 (σ = FORM_SIGMA_MAX × (1 − consistency)). */
export const FORM_SIGMA_MAX = 0.08;
/** Form shift per clutch rating point in a pressure round (clutch 1.0 → +2%, 0.2 → −2%). */
export const PRESSURE_FORM_PER_POINT = 0.05;

/**
 * Round form (Football-Manager style hidden attributes): an inconsistent player has hot and cold
 * rounds, and big rounds separate the composed from the nervous. Form is normally distributed:
 *     k = 1 + σ · z + nerve,   σ = FORM_SIGMA_MAX × (1 − consistency),   z ~ N(0,1) clamped to ±2
 *     nerve = (clutch − 0.6) × PRESSURE_FORM_PER_POINT   (pressure rounds only: match point / overtime)
 * `u1`,`u2` are two uniform (0,1) draws for this player/round (Box–Muller → z). Every mechanical
 * skill is multiplied by k and clamped to [0,1]. consistency 1.0 → always exactly on level.
 */
export function applyRoundForm(skills: CombatSkills, consistency: number, u1: number, u2: number, pressure?: { readonly clutch: number }, sigmaMax: number = FORM_SIGMA_MAX): CombatSkills {
  const z = Math.max(-2, Math.min(2, Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2)));
  const sigma = sigmaMax * (1 - Math.min(1, Math.max(0, consistency)));
  const nerve = pressure ? (pressure.clutch - 0.6) * PRESSURE_FORM_PER_POINT : 0;
  const k = 1 + sigma * z + nerve;
  const out = {} as Record<keyof CombatSkills, number>;
  for (const key of SKILL_KEYS) out[key] = Math.min(1, Math.max(0, skills[key] * k));
  return out;
}

/** game-data player ids of the first `count` rostered players (null beyond the roster / unknown team). */
export function rosterPlayerIds(id: string, count: number, override?: readonly RosterPlayer[]): Array<string | null> {
  return rosterPlayers(id, count, override).map((p) => p?.playerId ?? null);
}
