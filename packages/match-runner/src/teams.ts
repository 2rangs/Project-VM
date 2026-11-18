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
import { getTeam, getPlayer } from "@pv/game-data";
import { AVERAGE_SKILLS, type CombatSkills } from "@pv/combat-engine";
import type { TeamRef } from "./match.js";

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

/** Whether game-data knows this team (has a roster). */
export function isKnownTeam(id: string): boolean {
  return getTeam(id) !== undefined;
}

function attrValue(attrs: unknown, key: string): number | null {
  const a = attrs as Record<string, unknown> | null;
  const slot = a?.[key] as { value?: number } | undefined;
  return typeof slot?.value === "number" ? slot.value : null;
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
