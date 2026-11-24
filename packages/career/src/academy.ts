// The manager's academy (second team): invite a prospect, promote to the main roster, send back
// down, release (club/transfers.ts releasePlayer), and loan out to another club for minutes.
// docs/GENERATED_PEOPLE.md §11. AI clubs keep the season loop's academy (season.ts).
//
//   invite     a free agent aged ≤ academyMaxAge joins the academy on the academy wage
//              (CLUB_MODEL.academyWage) for min(3, academyMaxAge + 1 − age) seasons
//   promote    academy → main roster (roster < maxRoster); contract becomes a rotation/starter
//              contract at the next reconcile (club/ops.ts)
//   demote     main roster → academy (age ≤ academyMaxAge, academy has room)
//   loan out   a borrowing club takes the player when ITS scout rates him at least
//              loanAcceptGap below its weakest starter, or it is short of five; the player
//              accepts by the club layer's loan utility (more minutes). Wage share: the
//              borrower pays CLUB_MODEL.loanMinWageShare. An academy player returns to the academy.

import { windowStatus } from "./club/calendar.ts";
import { CLUB_MODEL } from "./club/constants.ts";
import { answerIncomingMut, submitOfferMut } from "./club/transfers.ts";
import type { World, WorldPlayer } from "./model.ts";
import { estimateAbility, teamScout, UNRATED_ABILITY } from "./scouting.ts";
import { SEASON_MODEL } from "./season.ts";

export const ACADEMY_MODEL = {
  /** A borrower takes a loanee its scout rates no further than this below its weakest starter. */
  loanAcceptGap: 0.03,
} as const;

export type AcademyError =
  | "noClub" | "notOurPlayer" | "notFree" | "tooOld" | "academyFull" | "rosterFull" | "notInAcademy" | "notOnRoster"
  | "windowClosed" | "borrowerDeclined" | "playerDeclined" | "loanFailed";

const userTeam = (w: World): string | null => w.club?.userTeamId ?? w.scouting?.teamId ?? null;

/** Sign a free prospect to the academy. */
export function inviteToAcademyMut(w: World, playerId: string, date: string): AcademyError | null {
  const tid = userTeam(w);
  const p = w.players[playerId];
  if (!tid || !w.teams[tid]) return "noClub";
  if (!p || p.status !== "free" || p.teamId) return "notFree";
  if (p.age > SEASON_MODEL.academyMaxAge) return "tooOld";
  const t = w.teams[tid]!;
  if (t.academy.length >= SEASON_MODEL.academySize) return "academyFull";
  p.teamId = tid;
  p.status = "academy";
  t.academy.push(playerId);
  if (w.club) {
    const years = Math.max(1, Math.min(3, SEASON_MODEL.academyMaxAge + 1 - p.age));
    w.club.contracts[playerId] = {
      personId: playerId, kind: "player", teamId: tid, salary: CLUB_MODEL.academyWage,
      startSeason: w.season, endSeason: w.season + years - 1, buyout: null, squadRole: "academy", signedOn: date,
    };
    w.club.transfers.push({ date, season: w.season, playerId, fromTeamId: null, toTeamId: tid, fee: 0, kind: "free" });
  }
  return null;
}

export function promoteMut(w: World, playerId: string): AcademyError | null {
  const tid = userTeam(w);
  const t = tid ? w.teams[tid] : undefined;
  const p = w.players[playerId];
  if (!t || !p || p.teamId !== tid) return "notOurPlayer";
  if (!t.academy.includes(playerId)) return "notInAcademy";
  if (t.roster.length >= SEASON_MODEL.maxRoster) return "rosterFull";
  t.academy = t.academy.filter((id) => id !== playerId);
  t.roster.push(playerId);
  p.status = "rostered";
  const c = w.club?.contracts[playerId];
  if (c) c.squadRole = t.roster.indexOf(playerId) < 5 ? "starter" : "rotation";
  return null;
}

export function demoteMut(w: World, playerId: string): AcademyError | null {
  const tid = userTeam(w);
  const t = tid ? w.teams[tid] : undefined;
  const p = w.players[playerId];
  if (!t || !p || p.teamId !== tid) return "notOurPlayer";
  if (!t.roster.includes(playerId)) return "notOnRoster";
  if (p.age > SEASON_MODEL.academyMaxAge) return "tooOld";
  if (t.academy.length >= SEASON_MODEL.academySize) return "academyFull";
  t.roster = t.roster.filter((id) => id !== playerId);
  t.academy.push(playerId);
  p.status = "academy";
  const c = w.club?.contracts[playerId];
  if (c) c.squadRole = "academy";
  return null;
}

/** Would `teamId` take this player on loan? (its own scout's view) */
export function borrowerWants(w: World, teamId: string, p: WorldPlayer): boolean {
  const t = w.teams[teamId];
  if (!t || t.roster.length >= SEASON_MODEL.maxRoster) return false;
  if (t.roster.length < 5) return true;
  const scout = teamScout(w, teamId);
  const weakest = Math.min(...t.roster.slice(0, 5).map((id) => {
    const q = w.players[id];
    return q ? estimateAbility(w, scout, q).ca : UNRATED_ABILITY;
  }));
  return estimateAbility(w, scout, p).ca >= weakest - ACADEMY_MODEL.loanAcceptGap;
}

/** Clubs that would take the player on loan (same region first, then by team id). */
export function loanTargets(w: World, playerId: string): string[] {
  const tid = userTeam(w);
  const p = w.players[playerId];
  if (!p || !tid) return [];
  const region = w.teams[tid]?.region;
  return Object.values(w.teams)
    .filter((t) => t.teamId !== tid && borrowerWants(w, t.teamId, p))
    .sort((a, b) => Number(b.region === region) - Number(a.region === region) || a.teamId.localeCompare(b.teamId))
    .map((t) => t.teamId);
}

/** Loan one of the manager's players out until the season's end (needs an open window). */
export function loanOutMut(w: World, playerId: string, toTeamId: string, date: string): AcademyError | null {
  const tid = userTeam(w);
  const p = w.players[playerId];
  if (!tid || !w.club) return "noClub";
  if (!p || p.teamId !== tid) return "notOurPlayer";
  if (!windowStatus(date).open) return "windowClosed";
  if (!borrowerWants(w, toTeamId, p)) return "borrowerDeclined";
  const fromAcademy = p.status === "academy";
  const wage = w.club.contracts[playerId]?.salary ?? CLUB_MODEL.academyWage;
  const offer = submitOfferMut(w, { playerId, toTeamId, kind: "loan", terms: { fee: 0, wage, years: 1, wageShare: CLUB_MODEL.loanMinWageShare } }, date);
  if (typeof offer === "string") return offer === "windowClosed" ? "windowClosed" : "loanFailed";
  answerIncomingMut(w, offer.id, true, date);
  if (offer.status !== "completed") return "playerDeclined";
  if (fromAcademy) {
    const i = w.club.loans.findIndex((l) => l.playerId === playerId && l.toTeamId === toTeamId);
    if (i >= 0) w.club.loans[i] = { ...w.club.loans[i]!, returnTo: "academy" };
  }
  // The bid notice the club layer queued for "an incoming bid" is moot: the manager initiated it.
  w.club.outbox = w.club.outbox.filter((m) => !(m.ref?.offerId === offer.id));

  return null;
}

export function academyOf(w: World, teamId: string): WorldPlayer[] {
  return (w.teams[teamId]?.academy ?? []).map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p);
}
