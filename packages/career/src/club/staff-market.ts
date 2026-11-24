// The staff market (docs/CLUB_OPERATIONS.md §12): head coaches, analysts, scouts and physios. A
// staff member feeds the existing systems only through formulas that already read them:
//   headCoach.development   → coach factor C of the development formula (season.ts), with facilities
//   headCoach.motivation    → the morale target (club/people.ts)
//   analyst.analysis        → series scouting / opponent read (match-runner via teamStaffInputs)
//   scout.judging*          → the error of every CA/PA estimate the club sees (scouting.ts)
//   physio.physiotherapy    → weekly fatigue recovery (club/training.ts): × (physioBase + physioSlope · p)
//
// Demand: wage = staffWage · (1 + staffStatureSpan · (quality − club reputation)); a good coach asks a
// small club for more. Hiring replaces the current holder of the post (severance, he joins the pool).
import { staffQuality } from "../generate.ts";
import type { StaffRole, World, WorldStaff } from "../model.ts";
import { CLUB_MODEL, DEPTH_MODEL } from "./constants.ts";
import { book, wageBill } from "./finance.ts";
import { reputations, roundTo, staffContract, staffWage } from "./market.ts";
import type { Text } from "./types.ts";

const D = DEPTH_MODEL;
const M = CLUB_MODEL;
const T = (ko: string, en: string): Text => ({ ko, en });
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;

/** Weekly recovery multiplier of a club's physio (1 without one: physiotherapy 0.5). */
export function physioFactor(w: World, teamId: string): number {
  const id = w.teams[teamId]?.staff.physio;
  const p = id ? w.staff[id]?.attributes.physiotherapy ?? 0.5 : 0.5;
  return D.physioBase + D.physioSlope * p;
}

/** Wage a staff member asks of a club. */
export function staffDemand(w: World, s: WorldStaff, teamId: string): number {
  const rep = reputations(w)[teamId] ?? 0.5;
  return roundTo(staffWage(s, w.teams[teamId]!.region) * (1 + D.staffStatureSpan * (staffQuality(s) - rep)), M.wageStep);
}

export interface StaffRow { staff: WorldStaff; quality: number; demand: number; current: boolean }

/** Free staff of a role (or every role), best first, with what they would ask of `teamId`. */
export function staffMarket(w: World, teamId: string, role?: StaffRole): StaffRow[] {
  return Object.values(w.staff)
    .filter((s) => (!role || s.role === role) && (!s.teamId || s.teamId === teamId))
    .map((s) => ({ staff: s, quality: staffQuality(s), demand: s.teamId === teamId ? w.club?.contracts[s.staffId]?.salary ?? staffDemand(w, s, teamId) : staffDemand(w, s, teamId), current: s.teamId === teamId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.quality - a.quality || a.staff.staffId.localeCompare(b.staff.staffId));
}

export type StaffError = "notFree" | "lowWage" | "overBudget" | "unknown";

function dismiss(w: World, staffId: string, date: string): void {
  const club = w.club!;
  const s = w.staff[staffId];
  if (!s || !s.teamId) return;
  const t = w.teams[s.teamId];
  const c = club.contracts[staffId];
  if (c) {
    book(club, s.teamId, date, "severance", -M.severanceShare * c.salary * Math.max(0, c.endSeason - w.season + 1), s.name);
    Reflect.deleteProperty(club.contracts, staffId);
  }
  if (t && t.staff[s.role] === staffId) Reflect.deleteProperty(t.staff, s.role);
  s.teamId = null;
}

/** Hire a free staff member at `wage` (≥ his demand) for 2 seasons, replacing the holder of the post. */
export function hireStaffMut(w: World, teamId: string, staffId: string, wage: number, date: string): StaffError | null {
  const club = w.club!;
  const s = w.staff[staffId];
  const t = w.teams[teamId];
  if (!s || !t) return "unknown";
  if (s.teamId) return "notFree";
  const demand = staffDemand(w, s, teamId);
  if (wage < demand) return "lowWage";
  const prev = t.staff[s.role];
  const prevSalary = prev ? club.contracts[prev]?.salary ?? 0 : 0;
  const f = club.finances[teamId]!;
  if (wageBill(w, teamId).total - prevSalary + wage > f.wageBudget * (1 + M.wageTolerance)) return "overBudget";
  if (prev) dismiss(w, prev, date);
  s.teamId = teamId;
  t.staff[s.role] = staffId;
  club.contracts[staffId] = { ...staffContract(w, s, teamId, 2, date), salary: wage };
  return null;
}

export function hireStaff(world: World, teamId: string, staffId: string, wage: number, date = world.club!.date): { world: World; error: StaffError | null; reason: Text } {
  const w = clone(world);
  const error = hireStaffMut(w, teamId, staffId, wage, date);
  const reason = error === null ? T("계약했습니다.", "Hired.")
    : error === "lowWage" ? T("요구 연봉보다 낮습니다.", "Below the wage asked.")
    : error === "overBudget" ? T("연봉 예산을 넘습니다.", "Over the wage budget.")
    : T("고용할 수 없습니다.", "Cannot be hired.");
  return { world: error === null ? w : world, error, reason };
}

/** Let a staff member go (severance on the rest of the contract). */
export function fireStaff(world: World, staffId: string, date = world.club!.date): World {
  const w = clone(world);
  dismiss(w, staffId, date);
  return w;
}
