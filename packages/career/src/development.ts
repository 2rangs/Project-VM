// Development drivers beyond age, playing time, coach and training (docs/GENERATED_PEOPLE.md §10):
// personality (hidden, fixed per player), morale and mentors (the manager pairs a young player with
// an experienced one).
//
// MORALE IS ONE MODEL (docs/handoff/career-quicksim-morale.md). There is a single morale value per
// player, 0..1, neutral 0.5:
//   • the club tracks it week by week for the manager's squad (club/people.ts: moraleOf / moraleWeek
//     drifting to moraleTarget from results, playing time, pay and the coach, plus the ±moraleSeries
//     swing after each series). That tracked value is canonical — it is what the UI shows, what
//     renewals read, and (with CLUB_FLAGS.moraleInMatch, default off) what reaches the match roster.
//   • for everyone the club does not track (AI clubs, free agents, and any world with no club at all)
//     there is no stored value, so `developmentMorale` falls back to a MODEL of the same quantity
//     from the season's form and the player's role against their ambition.
// `developmentMorale` is the one getter season development reads: it returns the tracked value when
// the club has one for the player, otherwise the model. So career development uses the very morale
// the club tracked and showed, not a second, disconnected season-end number.
//
//   growth multiplier   D = Pers · Mor · Ment
//     Pers = persBase + persSpan · professionalism                        (0.5 → 1)
//     Mor  = morBase  + morSpan  · morale                                 (0.5 → 1)
//     Ment = 1 + mentSpan · leadership(mentor) · fit                      (mentee ≤ menteeMaxAge;
//            fit = 1 same role, sameRoleElse otherwise; mentor ≥ mentorMinAge, same club, CA ≥ mentee's)
//   decline multiplier  (declineBase − declineSpan · professionalism)     (0.5 → 1)
//
//   morale m = clamp(0.5 + s · (formW · (form − 0.5) + roleW · (R − R*)), 0, 1)
//     R  = role now: starter 1, rotation 0.35, academy 0.1, no club 0   (club layer's expectedRole scale)
//     R* = wantBase + wantSpan · ambition                                 (what the player expects)
//     s  = swingBase − swingSpan · temperament                           (a calm player swings less)
//
//   leadership(t) = leadership₀ · (leadBase + leadSpan · clamp((t − leadStartAge)/(leadFullAge − leadStartAge), 0, 1))
//     — grows late: the attribute group that peaks last.
import { ambitionOf } from "./club/market.ts";
import { moraleOf } from "./club/people.ts";
import { CLUB_MODEL } from "./club/constants.ts";
import type { World, WorldPlayer } from "./model.ts";
import { clamp, streamFor } from "./rng.ts";

export const DEVELOPMENT_MODEL = {
  persBase: 0.8,
  persSpan: 0.4,
  morBase: 0.9,
  morSpan: 0.2,
  mentSpan: 0.2,
  sameRoleElse: 0.5,
  menteeMaxAge: 23,
  mentorMinAge: 24,
  declineBase: 1.2,
  declineSpan: 0.4,
  formW: 0.6,
  roleW: 0.5,
  wantBase: 0.35,
  wantSpan: 0.65,
  swingBase: 1.2,
  swingSpan: 0.4,
  leadBase: 0.4,
  leadSpan: 0.6,
  leadStartAge: 17,
  leadFullAge: 30,
} as const;

const DM = DEVELOPMENT_MODEL;

export interface Personality {
  /** Works on their game: speeds growth, slows decline. */
  readonly professionalism: number;
  /** Composure: how much morale swings. */
  readonly temperament: number;
  /** Leadership at full experience (grows with age, see leadership()). */
  readonly leadership: number;
  /** Hidden ambition (the club layer's value, club/market.ts ambitionOf). */
  readonly ambition: number;
}

/** Fixed per player (seeded by world seed and id): uniform 0..1 traits, ambition from the club layer. */
export function personalityOf(w: Pick<World, "seed">, playerId: string): Personality {
  const rng = streamFor(w.seed, `personality:${playerId}`);
  return { professionalism: rng(), temperament: rng(), leadership: rng(), ambition: ambitionOf(w, playerId) };
}

/** Leadership at age t. */
export function leadership(w: Pick<World, "seed">, p: Pick<WorldPlayer, "playerId" | "age">): number {
  const base = personalityOf(w, p.playerId).leadership;
  return base * (DM.leadBase + DM.leadSpan * clamp((p.age - DM.leadStartAge) / (DM.leadFullAge - DM.leadStartAge), 0, 1));
}

/** Role now on the club layer's expected-role scale. */
export function roleNow(w: World, p: WorldPlayer): number {
  if (!p.teamId) return 0;
  if (p.status === "academy") return CLUB_MODEL.roleAcademy;
  const roster = w.teams[p.teamId]?.roster ?? [];
  return roster.indexOf(p.playerId) < 5 ? 1 : CLUB_MODEL.roleRotation;
}

/**
 * The one morale a player develops under. When the club tracks this player (the manager's squad:
 * an entry in `club.morale`), that tracked value is canonical — the same morale the club drifts
 * week by week and the UI shows. Otherwise it is modelled from the season's form (0.5 = par) and the
 * player's role against what their ambition wants. `isTracked` distinguishes "tracked at neutral 0.5"
 * from "not tracked" (both would read 0.5 through `moraleOf`).
 */
export function isTrackedMorale(w: World, playerId: string): boolean {
  return w.club?.morale?.[playerId] !== undefined;
}

/** Morale modelled from form and role against ambition (the club-untracked estimate). */
export function modelMorale(w: World, p: WorldPlayer, form = 0.5): number {
  const pers = personalityOf(w, p.playerId);
  const want = DM.wantBase + DM.wantSpan * pers.ambition;
  const s = DM.swingBase - DM.swingSpan * pers.temperament;
  return clamp(0.5 + s * (DM.formW * (form - 0.5) + DM.roleW * (roleNow(w, p) - want)), 0, 1);
}

export function developmentMorale(w: World, p: WorldPlayer, form = 0.5): number {
  if (isTrackedMorale(w, p.playerId)) return moraleOf(w.club, p.playerId);
  return modelMorale(w, p, form);
}

export interface DevelopmentState {
  readonly version: 1;
  /** menteeId → mentorId (the manager's pairings). */
  mentors: Record<string, string>;
}

export type MentorError = "notOurPlayer" | "mentorTooYoung" | "menteeTooOld" | "samePlayer" | "mentorWeaker";

/** Why a mentor pairing is not allowed (null: it is). `teamId`: the club making it. */
export function mentorBlocker(w: World, teamId: string, menteeId: string, mentorId: string): MentorError | null {
  const a = w.players[menteeId];
  const b = w.players[mentorId];
  if (!a || !b || a.teamId !== teamId || b.teamId !== teamId) return "notOurPlayer";
  if (menteeId === mentorId) return "samePlayer";
  if (a.age > DM.menteeMaxAge) return "menteeTooOld";
  if (b.age < DM.mentorMinAge) return "mentorTooYoung";
  if ((b.ca ?? 0) < (a.ca ?? 0)) return "mentorWeaker";
  return null;
}

export function setMentorMut(w: World, teamId: string, menteeId: string, mentorId: string | null): MentorError | null {
  w.development ??= { version: 1, mentors: {} };
  if (mentorId === null) { delete w.development.mentors[menteeId]; return null; }
  const err = mentorBlocker(w, teamId, menteeId, mentorId);
  if (err) return err;
  w.development.mentors[menteeId] = mentorId;
  return null;
}

/** Ment for a mentee (1 without a valid mentor). */
export function mentorFactor(w: World, mentee: WorldPlayer, mentorId: string | undefined): number {
  if (!mentorId || !mentee.teamId) return 1;
  if (mentorBlocker(w, mentee.teamId, mentee.playerId, mentorId)) return 1;
  const m = w.players[mentorId]!;
  const fit = m.role && m.role === mentee.role ? 1 : DM.sameRoleElse;
  return 1 + DM.mentSpan * leadership(w, m) * fit;
}

/** The growth multiplier D and the decline multiplier for one player this season. */
export function developmentFactors(w: World, p: WorldPlayer, morale: number, mentorId?: string): { growth: number; decline: number } {
  const pers = personalityOf(w, p.playerId);
  const growth = (DM.persBase + DM.persSpan * pers.professionalism) * (DM.morBase + DM.morSpan * morale) * mentorFactor(w, p, mentorId);
  return { growth, decline: DM.declineBase - DM.declineSpan * pers.professionalism };
}
