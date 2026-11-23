// Every constant of the club-operations layer (contracts, finance, valuation, transfers, training),
// named and in one place. Money is in US dollars per year unless a name says otherwise. These are
// design values: there is no public data on esports wages, sponsorship or transfer fees beyond
// press reports (docs/CLUB_OPERATIONS.md §1 lists each one, what it does and why it has its size).
import type { Region } from "../regions.ts";

export const CLUB_MODEL = {
  // --- ability index -------------------------------------------------------------------------------
  /**
   * The ability index e ∈ [0,1] that wages and values read:
   *   v(x) = clamp((x − caMin)/(caMax − caMin), 0, 1)          (calibration range of real players)
   *   w(t) = clamp((potentialAgeEnd − t)/(potentialAgeEnd − potentialAgeStart), 0, 1)
   *   e    = v(CA) + w(t) · share · (v(PA) − v(CA))
   * so potential counts for the young and fades out by potentialAgeEnd.
   */
  potentialAgeStart: 18,
  potentialAgeEnd: 25,
  /** Share of the CA→PA gap a wage pays for (a club pays for what a player is). */
  wagePotentialShare: 0.3,
  /** Share of the CA→PA gap a transfer value pays for (a fee buys the future too). */
  valuePotentialShare: 0.6,

  // --- player wages -------------------------------------------------------------------------------
  /** Market wage W(e) = (wageFloor + wageSpan · e^wageExp) · regionMarket[team region]. */
  wageFloor: 30_000,
  wageSpan: 330_000,
  wageExp: 2.2,
  /** Salary at signing = W · (1 + teamPayPremium · (reputation − 0.5)): bigger clubs pay more. */
  teamPayPremium: 0.3,
  /** Academy players are on a flat stipend-sized wage. */
  academyWage: 12_000,
  /** Real players' starting contract length: 1 + floor(u · 3) seasons, +1 at or under youngContractAge (max 4). */
  youngContractAge: 21,
  maxContractYears: 4,
  /** Buyout (release clause) = buyoutValueMult · value at signing, never below one season's salary. */
  buyoutValueMult: 1.5,
  /** Severance on releasing a player = severanceShare · remaining salary. */
  severanceShare: 0.5,

  // --- staff wages ----------------------------------------------------------------------------------
  /** Staff wage = (floor[role] + span[role] · quality^staffWageExp) · regionMarket. */
  staffWageFloor: { headCoach: 60_000, analyst: 35_000, scout: 30_000 },
  staffWageSpan: { headCoach: 160_000, analyst: 70_000, scout: 60_000 },
  staffWageExp: 1.5,

  /** Market size per region: scales wages, sponsorship (design; Americas and EMEA pay most). */
  regionMarket: { americas: 1.1, emea: 1.0, pacific: 0.85, china: 0.8 } as Record<Region, number>,

  // --- player value (transfer fee basis) ------------------------------------------------------------
  /** Value = valueScale · e^valueExp · A(t) · K(yearsLeft). */
  valueScale: 2_000_000,
  valueExp: 2.5,
  /** Age factor A(t) = (1 − valueAgeDecay)^max(0, t − valueAgePeak). */
  valueAgePeak: 25,
  valueAgeDecay: 0.12,
  /** Contract factor K = clamp(floor + (1 − floor) · yearsLeft / fullYears, floor, 1); yearsLeft = endSeason − season. */
  contractValueFloor: 0.3,
  contractFullYears: 2,
  /** Fees, wages and values are rounded to these steps for display and offers. */
  feeStep: 5_000,
  wageStep: 1_000,

  // --- income -------------------------------------------------------------------------------------
  /** League revenue share every team receives (flat, paid monthly). */
  leagueStipend: 600_000,
  /**
   * Sponsorship (annual, re-signed at each season start, paid monthly):
   *   S = sponsorBase · regionMarket · (sponsorFloor + (1 − sponsorFloor) · fanbase) · (1 + sponsorResultSlope · (r − 0.5))
   * r = last season's result score (1 = won the region, 0 = last).
   */
  sponsorBase: 2_000_000,
  sponsorFloor: 0.2,
  sponsorResultSlope: 0.4,
  /** Fanbase: starts at fanBase0 + fanRepSlope · reputation; each season f' = f + fanRate · (r − f). */
  fanBase0: 0.2,
  fanRepSlope: 0.8,
  fanRate: 0.3,
  /** Prize money by regional placement p (1 = first): prizeTop · prizeDecay^(p − 1). */
  prizeTop: 500_000,
  prizeDecay: 0.75,
  /** Without standings from the season loop, placement is the strength order plus noise of this σ (CA units). */
  placementNoise: 0.02,

  // --- costs --------------------------------------------------------------------------------------
  /** Operations (facilities, travel, content): opsFixed + opsIncomeShare · expected income, per year. */
  opsFixed: 250_000,
  opsIncomeShare: 0.1,
  /**
   * Reinvestment: a club holding more than its reserve target spends reinvestShare of the excess
   * per year (facilities, academy, content) — the sink that keeps rich clubs from piling up cash.
   * Reserve target = reserveYears · annual costs.
   */
  reserveYears: 1,
  reinvestShare: 0.6,
  /**
   * Owner support: when the balance falls below −debtLimitShare · expected income, the owner
   * covers the gap back to zero (and the board says so). The floor that keeps clubs from going
   * infinitely broke.
   */
  debtLimitShare: 0.25,
  /** Starting balance = initialReserveYears · annual costs. */
  initialReserveYears: 0.5,

  // --- board --------------------------------------------------------------------------------------
  /** Wage budget = wageShare · expected income (players + staff wages). */
  wageShare: 0.6,
  /** Transfer budget = transferShare · max(0, balance − transferReserveYears · annual costs). */
  transferShare: 0.5,
  transferReserveYears: 0.25,
  /** The board warns when the wage bill exceeds the wage budget by this much (once a month at most). */
  wageTolerance: 0.05,

  // --- transfers ----------------------------------------------------------------------------------
  /** Transfer windows within a season year (MM-DD, inclusive). */
  windows: [
    { id: "preseason", from: "01-01", to: "02-15" },
    { id: "midseason", from: "06-01", to: "06-30" },
    // The offseason after the season ends on 1 September (continues into the preseason window).
    { id: "offseason", from: "09-02", to: "12-31" },
  ] as ReadonlyArray<{ id: string; from: string; to: string }>,
  /** Seller's asking price = value · (1 + starterPremium · [starter] + shortPremium · [would leave fewer than five]). */
  starterPremium: 0.35,
  shortPremium: 0.5,
  /** A bid at or above counterShare · asking gets a counter-offer at the asking price; below it, a refusal. */
  counterShare: 0.6,
  /**
   * Player's utility of a move (accept when U ≥ 0):
   *   U = wWage · ln(wage / ref) + wAmbition · ambition · (S_to − S_from) + wRole · (R_to − R_from) + wLength · L
   *   ref = max(current salary, refMarketShare · market wage)  (free agent: freeAgentRefShare · market wage)
   *   S   = team strength (mean CA of the top five, on the calibration scale)
   *   R   = expected role: starter 1, rotation roleRotation, academy roleAcademy, no club 0
   *   L   = −|years − L*(age)| / 3,  L* = clamp(1 + (age − 20)/4, 1, 3)  (older players want security)
   */
  wWage: 1.0,
  wAmbition: 1.2,
  wRole: 0.6,
  wLength: 0.15,
  refMarketShare: 0.8,
  freeAgentRefShare: 0.7,
  roleRotation: 0.35,
  roleAcademy: 0.1,
  /** A player whose utility is short asks for the wage that makes U = acceptMargin, if within maxCounterRaise × the offer. */
  acceptMargin: 0.02,
  maxCounterRaise: 2.0,
  /** Hidden ambition ∈ [ambitionMin, ambitionMax] (uniform, seeded per player). */
  ambitionMin: 0.2,
  ambitionMax: 1.0,
  /** Loans: the parent club accepts for a non-starter when the borrower pays at least this share of the wage. */
  loanMinWageShare: 0.5,
  /** Incoming offers for the user's players stay open this many days. */
  offerExpiryDays: 7,
  /** AI market: one round per week in a window; each AI club buys at most this many players per window. */
  aiBuysPerWindow: 2,
  /** AI buys only an upgrade on its weakest starter by at least this much (scout estimate, CA 0–1). */
  aiUpgradeMargin: 0.03,
  /** AI bids its own estimated value times (1 + aiBidMarkup). */
  aiBidMarkup: 0.1,
  /** An AI club re-signs an expiring player when the scout rates him within its top aiRenewTop and under aiRenewMaxAge. */
  aiRenewTop: 6,
  aiRenewMaxAge: 32,

  // --- training -----------------------------------------------------------------------------------
  /** Weekly exposure = (teamWeight · team vector + indivWeight · individual vector) · (1 − fatiguePenalty · max(0, fatigue − fatigueFree)). */
  teamWeight: 0.7,
  indivWeight: 0.3,
  /**
   * Development focus factor for attribute k in group g:  F_k = (1 − focusBeta) + focusBeta · 3 · x_g
   * x_g = mean weekly exposure to g over the season. Balanced training (x = 1/3 each) gives F = 1,
   * the existing development; the mean of F over the groups is 1 whenever the week is fully spent
   * on the three groups, so focus moves development between groups rather than adding to it.
   */
  focusBeta: 0.45,
  /** Fatigue f ∈ [0,1]: f' = clamp(f + load − recovery); rest weeks recover restRecovery instead. */
  loadTraining: 0.12,
  loadTactics: 0.1,
  recoveryPerWeek: 0.08,
  restRecovery: 0.35,
  fatiguePenalty: 0.5,
  /** Fatigue up to this level costs nothing (a schedule with a rest week every 6–8 weeks stays under it). */
  fatigueFree: 0.3,
  fatigueStart: 0.2,
  /** Map practice: a tactics week adds scrimMapsPerWeek · scrimWeight official-game equivalents per starter pair on the map. */
  scrimMapsPerWeek: 6,
  scrimWeight: 0.25,
  /** Practice playerGames carried into the next season (the rest is forgotten). */
  practiceCarry: 0.5,

  // --- calendar (career mode owns it: career/schedule.ts SCHEDULE_MODEL) ----------------------------
  /** A career's first day of a season and the season's last day (month, day) — career mode's dates. */
  seasonStart: [1, 5] as readonly [number, number],
  seasonEnd: [9, 1] as readonly [number, number],
  /** The month a "contracts expiring" notice goes out (the season ends on 1 September). */
  expiryNoticeMonth: 7,
  /** Ledger entries kept per team, monthly summaries kept for AI clubs. */
  maxLedger: 400,
  maxMonthly: 24,
  maxOfferHistory: 80,
} as const;

export type ClubModel = typeof CLUB_MODEL;
