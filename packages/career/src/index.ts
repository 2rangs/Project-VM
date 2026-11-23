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
export { advanceSeason, openSeason, developPlayer, retirementHazard, staffRetirementHazard, seasonMaps, caOf, regionPopulation, SEASON_MODEL } from "./season.ts";
export {
  createWorld, estimateRealAge, listPlayers, freeAgents, generatedPlayers, newProspects, newStaff,
  startingFive, teamStaffInputs, scoutView, teamOf, populationSummary,
  type CreateWorldOptions, type RealTeamInput,
} from "./world.ts";
export { serializeWorld, deserializeWorld, SAVE_FORMAT } from "./save.ts";
export { mulberry32, deriveSeed } from "./rng.ts";
