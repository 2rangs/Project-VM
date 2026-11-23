// Club operations: contracts, finance, transfers and free agency, training. docs/CLUB_OPERATIONS.md.
export * from "./types.ts";
export { CLUB_MODEL } from "./constants.ts";
export { addDays, daysBetween, dayOfWeek, windowStatus, windowOpen, seasonStartDate, seasonEndDate, type WindowStatus } from "./calendar.ts";
export {
  abilityIndex, abilityScale, potentialWeight, marketWage, marketWageFromIndex, staffWage, valueFrom, playerValue, contractFactor,
  ageValueFactor, teamStrength, reputations, clubSalary, ambitionOf, expectedRole, startingYears, roundTo,
} from "./market.ts";
export {
  book, wageBill, annualCosts, operationsCost, prizeFor, resultScore, regionOrder, placements, sponsorshipFor,
  setSeasonBudgets, monthlyFinance, seasonEndFinance,
} from "./finance.ts";
export { money, MSG } from "./messages.ts";
export {
  askingPrice, clubAnswer, playerUtility, playerAnswer, preferredYears, offerBlocker, makeOffer, submitOfferMut, answerCounter,
  answerIncoming, releasePlayer, suggestedTerms, aiMarketRound, joinRoster,
  type OfferRequest, type OfferError, type ClubAnswer, type PlayerAnswer,
} from "./transfers.ts";
export {
  FOCUS_GROUPS, TEAM_FOCI, INDIV_FOCI, GROUP_OF, weeklyVector, nextFatigue, trainingWeek, exposureShares, focusFactors, seasonFocus,
  setTrainingPlan, setIndividualFocus, practiceAdjustedRecords, defaultPlan, type MapRecordLike,
} from "./training.ts";
export {
  initClub, reconcileContracts, clubOnDay, clubOnMonth, clubSeasonEnd, clubBeforeSeasonEnd, clubAfterSeasonAdvance,
  type InitClubOptions, type SeasonEndContext,
} from "./ops.ts";
export { registerClubOps, createLocalDriver, type CareerHooks, type DayHandler, type SeasonEndHandler, type LocalDriver } from "./hooks.ts";
