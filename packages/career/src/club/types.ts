// Club-operations state. It lives in `World.club` (optional), so a save carries it and
// `advanceSeason` (which clones the world) keeps it. All plain data.
import type { StaffRole } from "../model.ts";

/** A bilingual string (the desktop shows `ko` or `en`). */
export interface Text { readonly ko: string; readonly en: string }

export type InboxKind = "finance" | "board" | "transfer" | "contract" | "training";

/** An inbox item. Posted through the shell's inbox hook and kept in `club.messages`. */
export interface InboxItem {
  readonly id: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly kind: InboxKind;
  readonly title: Text;
  readonly body: Text;
  /** Optional link target for the shell (e.g. "transfers", "finance"). */
  readonly route?: string;
}

export type SquadRole = "starter" | "rotation" | "academy" | "staff";

export interface Contract {
  readonly personId: string;
  readonly kind: "player" | "staff";
  teamId: string;
  /** Annual salary, USD. */
  salary: number;
  startSeason: number;
  /** Last season covered: the contract expires at the end of this season. */
  endSeason: number;
  /** Release clause (players): a fee at or above it must be accepted. Null for staff / academy. */
  buyout: number | null;
  /** Role promised at signing (staff: "staff"). */
  squadRole: SquadRole;
  staffRole?: StaffRole;
  /** YYYY-MM-DD of signing. */
  signedOn: string;
}

export type LedgerKind =
  | "stipend" | "sponsorship" | "prize" | "wages" | "staffWages" | "operations" | "reinvestment"
  | "transferIn" | "transferOut" | "severance" | "ownerSupport" | "loanWages";

export interface LedgerEntry {
  readonly date: string;
  readonly kind: LedgerKind;
  /** + income, − cost. */
  readonly amount: number;
  readonly note?: string;
}

export interface MonthSummary { readonly month: string; readonly income: number; readonly costs: number; readonly balance: number }

export interface TeamFinance {
  balance: number;
  /** 0..1. */
  fanbase: number;
  /** Annual sponsorship signed for the current season. */
  sponsorship: number;
  /** Expected income for the current season (the board's planning figure). */
  expectedIncome: number;
  wageBudget: number;
  transferBudget: number;
  /** Last season's result score r (1 = won the region). */
  lastResult: number;
  /** Detailed ledger (the user's club; AI clubs keep `monthly` only). */
  ledger: LedgerEntry[];
  monthly: MonthSummary[];
  /** Running season totals by kind. */
  season: Partial<Record<LedgerKind, number>>;
  /** YYYY-MM of the last board warning (one a month at most). */
  lastWarning: string | null;
}

export type OfferKind = "transfer" | "loan" | "free" | "renewal";
export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired" | "completed";

export interface OfferTerms {
  /** Fee to the selling club (0 for free agents and renewals). */
  fee: number;
  /** Annual wage offered to the player. */
  wage: number;
  /** Contract length in seasons (including the current one). Loans run to the season's end. */
  years: number;
  /** Loans: share of the wage the borrower pays. */
  wageShare?: number;
}

export interface TransferOffer {
  readonly id: string;
  readonly kind: OfferKind;
  readonly playerId: string;
  /** Selling club (null: free agent). For a renewal, the player's own club. */
  readonly fromTeamId: string | null;
  readonly toTeamId: string;
  terms: OfferTerms;
  status: OfferStatus;
  /** Who must answer next: the selling club, the player, or the buyer (after a counter). */
  stage: "club" | "player" | "buyer" | "done";
  /** The counter-terms when status is "countered". */
  counter?: OfferTerms;
  /** Who made the counter. */
  counterFrom?: "club" | "player";
  /** Why the last answer was what it was (bilingual, for the UI). */
  reason?: Text;
  readonly created: string;
  updated: string;
  /** Incoming offers (to the user) expire on this date. */
  expires?: string;
  /** Utility breakdown of the player's last decision (for the UI and tests). */
  utility?: PlayerUtility;
}

export interface PlayerUtility {
  readonly total: number;
  readonly wage: number;
  readonly ambition: number;
  readonly role: number;
  readonly length: number;
  readonly ref: number;
}

export interface Loan {
  readonly playerId: string;
  readonly fromTeamId: string;
  readonly toTeamId: string;
  readonly wageShare: number;
  readonly endSeason: number;
}

export interface TransferRecord {
  readonly date: string;
  readonly season: number;
  readonly playerId: string;
  readonly fromTeamId: string | null;
  readonly toTeamId: string | null;
  readonly fee: number;
  readonly kind: OfferKind | "release" | "expiry";
}

export type TeamFocus = "balanced" | "mechanics" | "utility" | "teamplay" | "tactics" | "rest";
export type IndivFocus = "balanced" | "mechanics" | "utility" | "teamplay";
export type FocusGroup = "mechanics" | "utility" | "teamplay";

export interface TrainingPlan {
  teamFocus: TeamFocus;
  /** The map practised in tactics weeks. */
  map: string | null;
  individual: Record<string, IndivFocus>;
}

export interface Exposure {
  mechanics: number;
  utility: number;
  teamplay: number;
  weeks: number;
  fatigue: number;
}

export interface TrainingState {
  plans: Record<string, TrainingPlan>;
  exposure: Record<string, Exposure>;
  /** teamId → map → playerId → practice game-equivalents. */
  mapPractice: Record<string, Record<string, Record<string, number>>>;
  /** YYYY-MM-DD of the last weekly tick. */
  lastTick: string | null;
}

export interface ClubState {
  readonly version: 1;
  /** Current club date, YYYY-MM-DD (the shell's calendar date). */
  date: string;
  userTeamId: string | null;
  contracts: Record<string, Contract>;
  finances: Record<string, TeamFinance>;
  offers: TransferOffer[];
  loans: Loan[];
  transfers: TransferRecord[];
  shortlist: string[];
  training: TrainingState;
  messages: InboxItem[];
  /** AI purchases per team in the current window: `${windowKey}` → teamId → count. */
  aiBuys: Record<string, Record<string, number>>;
  nextId: number;
}
