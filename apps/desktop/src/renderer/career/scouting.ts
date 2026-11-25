// Scouting knowledge, scout reports, shortlist, development and the academy as the desktop shows
// them (pure helpers over @pv/career; screens/scouting/* draws them). docs/GENERATED_PEOPLE.md §9–12.
import {
  assignScoutMut, clubScouts, demoteMut, inviteToAcademyMut, knowledgeOf, latestReport, leadership, loanOutMut, loanTargets,
  moraleOf, trackedMorale, personalityOf, promoteMut, reportList, setMentorMut, toScale200, viewPlayer, mentorBlocker, SEASON_MODEL,
  type AcademyError, type AssignmentKind, type MentorError, type PlayerView, type Range, type ScoutAssignment, type ScoutReport,
  type World, type WorldPlayer, type WorldStaff,
} from './world.ts';

/** The fog applies: a career world with the manager's scouting state. */
export const fogged = (w: World): boolean => !!w.scouting;
export const managerTeam = (w: World): string | null => w.scouting?.teamId ?? w.club?.userTeamId ?? null;

const clone = (w: World): World => structuredClone(w);
const to20 = (v: number): number => Math.max(1, Math.min(20, Math.round(1 + v * 19)));

export interface Range20 { est: number; lo: number; hi: number }
export const range20 = (r: Range): Range20 => ({ est: to20(r.est), lo: to20(r.lo), hi: to20(r.hi) });
export const range200 = (r: Range): Range20 => ({ est: toScale200(r.est)!, lo: toScale200(r.lo)!, hi: toScale200(r.hi)! });
export const rangeText = (r: Range20): string => (r.lo === r.hi ? String(r.est) : `${r.lo}–${r.hi}`);

export function playerView(w: World, p: WorldPlayer, date?: string): PlayerView { return viewPlayer(w, p, date); }

/** Knowledge as a whole percent (own players 100). */
export const knowledgePct = (w: World, p: WorldPlayer, date?: string): number => Math.round(100 * knowledgeOf(w, p, date));

// --- assignments ------------------------------------------------------------------------------------

export interface ScoutRow { scout: WorldStaff; assignment: ScoutAssignment | null }

export function scoutRows(w: World): ScoutRow[] {
  const tid = managerTeam(w);
  if (!tid || !w.scouting) return [];
  return clubScouts(w, tid).map((s) => ({ scout: s, assignment: w.scouting!.assignments.find((a) => a.scoutId === s.staffId) ?? null }));
}

export function assign(w: World, scoutId: string, kind: AssignmentKind, target: string | null, date: string): World {
  const n = clone(w);
  return assignScoutMut(n, scoutId, kind, target, date) ? w : n;
}

// --- reports ----------------------------------------------------------------------------------------

export interface ReportRow { report: ScoutReport; player: WorldPlayer; ca: Range20; pa: Range20 }

const toRow = (w: World, r: ScoutReport): ReportRow | null => {
  const p = w.players[r.playerId];
  if (!p) return null;
  const s = (lo: number, hi: number): Range20 => ({ est: toScale200((lo + hi) / 2)!, lo: toScale200(lo)!, hi: toScale200(hi)! });
  return { report: r, player: p, ca: s(r.ca[0], r.ca[1]), pa: s(r.pa[0], r.pa[1]) };
};

export function reportRows(w: World): ReportRow[] {
  return reportList(w).map((r) => toRow(w, r)).filter((x): x is ReportRow => !!x);
}
export function lastReportRow(w: World, playerId: string): ReportRow | null {
  const r = latestReport(w, playerId);
  return r ? toRow(w, r) : null;
}
/** A player's report history (for the scouted-player chart). */
export function reportHistory(w: World, playerId: string): ReportRow[] {
  return (w.scouting?.reports[playerId] ?? []).map((r) => toRow(w, r)).filter((x): x is ReportRow => !!x);
}

export function shortlistPlayers(w: World): WorldPlayer[] {
  return (w.club?.shortlist ?? []).map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p);
}

// --- development ------------------------------------------------------------------------------------

export interface DevPoint200 { season: number; age: number; ca: number; maps: number }
export function devSeries(p: WorldPlayer): DevPoint200[] {
  return (p.history ?? []).map((h) => ({ season: h.season, age: h.age, ca: toScale200(h.ca)!, maps: h.maps }));
}

/** Personality traits as words: low / mid / high (i18n `dev.trait.<level>`). */
export type Level = 'low' | 'mid' | 'high';
export const level = (v: number): Level => (v < 0.34 ? 'low' : v < 0.67 ? 'mid' : 'high');

export interface OwnPanel {
  morale: number;
  moraleLevel: Level;
  /** True when the club tracks this player's morale week by week; false: derived from form and role. */
  moraleTracked: boolean;
  traits: { professionalism: Level; temperament: Level; leadership: Level; ambition: Level };
  mentorId: string | null;
  mentorOptions: WorldPlayer[];
  canBeMentored: boolean;
}

/** What the manager sees of an own player beyond attributes. `form` from the season stats (0.5 par). */
export function ownPanel(w: World, p: WorldPlayer, form = 0.5): OwnPanel {
  const pers = personalityOf(w, p.playerId);
  // The one morale model (development.ts moraleOf): tracked for the manager's squad, else derived.
  const m = moraleOf(w, p, form);
  const tid = managerTeam(w)!;
  const squad = [...(w.teams[tid]?.roster ?? []), ...(w.teams[tid]?.academy ?? [])].map((id) => w.players[id]).filter((x): x is WorldPlayer => !!x);
  const options = squad.filter((x) => mentorBlocker(w, tid, p.playerId, x.playerId) === null);
  return {
    morale: Math.round(m * 100), moraleLevel: level(m), moraleTracked: trackedMorale(w, p.playerId) !== undefined,
    traits: { professionalism: level(pers.professionalism), temperament: level(pers.temperament), leadership: level(leadership(w, p)), ambition: level((pers.ambition - 0.2) / 0.8) },
    mentorId: w.development?.mentors[p.playerId] ?? null,
    mentorOptions: options,
    canBeMentored: options.length > 0 || !!w.development?.mentors[p.playerId],
  };
}

export function setMentor(w: World, menteeId: string, mentorId: string | null): { world: World; error: MentorError | null } {
  const n = clone(w);
  const error = setMentorMut(n, managerTeam(w)!, menteeId, mentorId);
  return { world: error ? w : n, error };
}

// --- academy ----------------------------------------------------------------------------------------

export function academyAction(w: World, kind: 'invite' | 'promote' | 'demote', playerId: string, date: string): { world: World; error: AcademyError | null } {
  const n = clone(w);
  const error = kind === 'invite' ? inviteToAcademyMut(n, playerId, date) : kind === 'promote' ? promoteMut(n, playerId) : demoteMut(n, playerId);
  return { world: error ? w : n, error };
}

export function loanOut(w: World, playerId: string, toTeamId: string, date: string): { world: World; error: AcademyError | null } {
  const n = clone(w);
  const error = loanOutMut(n, playerId, toTeamId, date);
  return { world: error ? w : n, error };
}
export { loanTargets };

/** What academy actions apply to a player for the manager (for the buttons). */
export function academyActions(w: World, p: WorldPlayer): Array<'invite' | 'promote' | 'demote' | 'loan'> {
  const tid = managerTeam(w);
  if (!tid) return [];
  const t = w.teams[tid];
  if (!t) return [];
  const out: Array<'invite' | 'promote' | 'demote' | 'loan'> = [];
  if (p.status === 'free' && !p.teamId && p.age <= SEASON_MODEL.academyMaxAge) out.push('invite');
  if (p.teamId === tid && t.academy.includes(p.playerId)) out.push('promote');
  if (p.teamId === tid && t.roster.includes(p.playerId) && p.age <= SEASON_MODEL.academyMaxAge) out.push('demote');
  if (p.teamId === tid && !(w.club?.loans ?? []).some((l) => l.playerId === p.playerId)) out.push('loan');
  return out;
}

export type { AssignmentKind, ScoutReport };
