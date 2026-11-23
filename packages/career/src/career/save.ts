// Career save / load: the whole CareerState (world, calendar, results, inbox, hook state) as JSON
// with a format tag. Loading gives back exactly the state that was saved, so Continue from a load
// plays out the same as Continue from the live state.
import type { CareerState } from "./types.ts";

export const CAREER_SAVE_FORMAT = "pv-career";

export interface CareerSaveMeta {
  readonly manager: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly date: string;
  readonly season: number;
  readonly savedAt: string;
}

export function careerMeta(state: CareerState, savedAt = new Date().toISOString()): CareerSaveMeta {
  return { manager: state.manager.name, teamId: state.userTeamId, teamName: state.world.teams[state.userTeamId]?.name ?? state.userTeamId, date: state.date, season: state.season.season, savedAt };
}

export function serializeCareer(state: CareerState, savedAt?: string): string {
  return JSON.stringify({ format: CAREER_SAVE_FORMAT, meta: careerMeta(state, savedAt), career: state });
}

export function deserializeCareer(text: string): CareerState {
  const parsed = JSON.parse(text) as { format?: unknown; career?: CareerState };
  if (parsed.format !== CAREER_SAVE_FORMAT || !parsed.career) throw new Error("not a PROJECT V career save");
  if (parsed.career.version !== 1) throw new Error(`unsupported career save version ${String(parsed.career.version)}`);
  return parsed.career;
}

/** Just the header of a save (for the save-slot list) without keeping the whole world. */
export function readCareerMeta(text: string): CareerSaveMeta | null {
  try {
    const parsed = JSON.parse(text) as { format?: unknown; meta?: CareerSaveMeta };
    return parsed.format === CAREER_SAVE_FORMAT && parsed.meta ? parsed.meta : null;
  } catch { return null; }
}
