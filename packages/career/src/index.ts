// @pv/career — generated players and staff ("regens") and the season loop that brings them into
// the world. Pure TS (no Node APIs) so the desktop renderer can run it; `@pv/career/game-data`
// builds the starting world from @pv/game-data under Node. See docs/GENERATED_PEOPLE.md.
export * from "./model.ts";
export * from "./regions.ts";
export { CAREER_MODEL, maturity, closingRate, declineLoss, playTimeFactor, coachFactor, uncertaintyAfter, impliedPeak } from "./ability.ts";
export { deriveCalibration, compositeOf, attrValue, type Calibration, type RealPlayerInput } from "./calibration.ts";
export { generatePlayer, generateStaff, peakProfile, staffQuality, STAFF_MODEL, type PlayerGenRequest, type StaffGenRequest } from "./generate.ts";
export { generateHandle, generatePersonName, normalizeHandle, isBlockedHandle, type PersonName } from "./names.ts";
export { estimateAbility, teamScout, toScale200, SCOUT_MODEL, UNRATED_ABILITY, type AbilityEstimate } from "./scouting.ts";
export { advanceSeason, type AdvanceOptions, openSeason, developPlayer, retirementHazard, staffRetirementHazard, seasonMaps, caOf, regionPopulation, SEASON_MODEL, type AdvanceSeasonOptions } from "./season.ts";
export {
  createWorld, estimateRealAge, listPlayers, freeAgents, generatedPlayers, newProspects, newStaff,
  startingFive, teamStaffInputs, scoutView, teamOf, populationSummary,
  type CreateWorldOptions, type RealTeamInput,
} from "./world.ts";
export { serializeWorld, deserializeWorld, SAVE_FORMAT } from "./save.ts";
export { mulberry32, deriveSeed } from "./rng.ts";
export * from "./club/index.ts";
// --- Career mode: calendar, competition, inbox, extension hooks (docs/CAREER_MODE.md) ---
export * from "./career/calendar.ts";
export * from "./career/inbox.ts";
export * from "./career/hooks.ts";
export type * from "./career/types.ts";
export * from "./career/schedule.ts";
export * from "./career/career.ts";
export * from "./career/quick-sim.ts";
export * from "./career/save.ts";
// Both the club layer (club/types.ts) and career mode (career/inbox.ts) define an `InboxItem`. Name the
// export explicitly (an explicit export wins over the two `export *`): career mode's is the inbox the app
// shows; the club layer's own message record is `ClubInboxItem`.
export type { InboxItem } from "./career/inbox.ts";
export type { InboxItem as ClubInboxItem } from "./club/types.ts";
// Same names in the club layer and career mode (both use ISO-date strings): career mode's are the plain
// names; the club layer's are re-exported with a `club` prefix.
export { addDays, daysBetween } from "./career/calendar.ts";
export { teamStrength } from "./career/schedule.ts";
export { addDays as clubAddDays, daysBetween as clubDaysBetween } from "./club/calendar.ts";
export { teamStrength as clubTeamStrength } from "./club/market.ts";
